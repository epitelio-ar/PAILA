// Salida "bit perfect" (apagada de fábrica): mpv toca el archivo con la salida exclusiva de Windows (WASAPI exclusivo) o
// de Mac (CoreAudio exclusivo: toma el aparato para él solo y le pone la frecuencia del archivo), así el sonido le llega a
// la placa o al DAC tal como está grabado, sin el mezclador del sistema. Acá está lo que no depende
// de Electron: con qué opciones se abre mpv, leer su lista de salidas y hablarle por su canal de control (JSON por un
// "named pipe"). Lo maneja electron/bitperfect.ts; mpv viaja en el instalador (apps/paila/recursos/mpv, ver su AVISO.txt).
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { textos } from '@paila/shared/idioma'

// Los errores de mpv que pueden llegar a la pantalla (la salida bit perfect avisa y vuelve a la normal).
const T = textos({
  noArranco: { es: (l: string) => `mpv no arrancó: ${l}`, en: (l: string) => `mpv didn't start: ${l}` },
  sinCanal: { es: 'mpv no abrió su canal de control', en: "mpv didn't open its control channel" },
  cerrado: { es: 'mpv se cerró', en: 'mpv closed' },
  noCorre: { es: 'mpv no está corriendo', en: "mpv isn't running" },
  noContesto: { es: 'mpv no contestó', en: "mpv didn't answer" },
})

export interface MpvDevice { id: string; label: string }

/** La salida exclusiva de cada sistema: WASAPI en Windows, CoreAudio exclusivo ("hog mode") en Mac. */
export const EXCLUSIVE_AO = process.platform === 'darwin' ? 'coreaudio_exclusive' : 'wasapi'

/**
 * Las opciones para tocar sin retoques: salida exclusiva en el aparato elegido, volumen al 100 % sin poder subirlo (el
 * volumen se maneja desde el equipo), sin ReplayGain, sin corrección de tono ni mezcla de canales, sin ventana ni consola.
 * Si el aparato no está o no se puede abrir, mpv no cae a otra salida en silencio: avisa, y PAILA vuelve a la normal.
 */
export function mpvArgs(o: { device: string; pipe: string; ao?: string }): string[] {
  return [
    '--no-config', '--no-terminal', '--idle=yes', '--no-video', '--force-window=no', '--audio-display=no', '--keep-open=no',
    `--ao=${o.ao ?? EXCLUSIVE_AO}`, '--audio-exclusive=yes', `--audio-device=${o.device}`, '--audio-fallback-to-null=no',
    '--volume=100', '--volume-max=100', '--replaygain=no', '--audio-pitch-correction=no', '--audio-normalize-downmix=no',
    '--audio-channels=auto', '--af=', '--gapless-audio=no', `--input-ipc-server=${o.pipe}`,
  ]
}

/**
 * Las líneas de "mpv --audio-device=help": "  'wasapi/{…}' (Parlantes (Realtek Audio))" o, en Mac,
 * "  'coreaudio_exclusive/AppleUSBAudioEngine:…' (DAC USB)". Sin la "automática" ni las salidas que no son exclusivas.
 */
export function parseDevices(out: string): MpvDevice[] {
  const r: MpvDevice[] = []
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^\s*'([^']+)'\s+\((.*)\)\s*$/)
    if (m && m[1] !== 'auto' && /^(wasapi|coreaudio_exclusive)\//.test(m[1])) r.push({ id: m[1], label: m[2] })
  }
  return r
}

/** Las salidas que ve mpv por la salida exclusiva (tarda menos de un segundo). Vacío si mpv no está o no anda. */
export function listDevices(exe: string): MpvDevice[] {
  if (!fs.existsSync(exe)) return []
  const r = spawnSync(exe, ['--no-config', `--ao=${EXCLUSIVE_AO}`, '--audio-device=help'], { encoding: 'utf8', timeout: 15_000, windowsHide: true })
  return parseDevices(`${r.stdout ?? ''}\n${r.stderr ?? ''}`)
}

/** Lo que mpv dice que entra y sale: frecuencia, formato y canales (para mostrar que sale igual a como está grabado). */
export interface AudioParams { samplerate: number; format: string; channels: string }
/** ¿Sale tal cual? Misma frecuencia y mismos bits (mpv puede mandar 24 bits dentro de 32 "con relleno": sigue intacto). */
export function sameOut(inp: AudioParams | null, out: AudioParams | null): boolean | null {
  if (!inp || !out) return null
  const bits = (f: string) => (/^(u8)/.test(f) ? 8 : /^s16/.test(f) ? 16 : /^s24/.test(f) ? 24 : /^(s32|float)/.test(f) ? 32 : /^double/.test(f) ? 64 : 0)
  return inp.samplerate === out.samplerate && (bits(out.format) >= bits(inp.format) || /^float/.test(inp.format))
}

export type MpvEvent = { event: string; name?: string; data?: unknown; reason?: string; file_error?: string; id?: number }

/** Una línea JSON del canal de control de mpv: o la respuesta a un pedido o un aviso (evento). */
export function parseLine(line: string): { reply?: { id: number; error: string; data: unknown }; event?: MpvEvent } | null {
  try {
    const j = JSON.parse(line) as Record<string, unknown>
    if (typeof j.request_id === 'number' && 'error' in j) return { reply: { id: j.request_id, error: String(j.error), data: j.data } }
    if (typeof j.event === 'string') return { event: j as unknown as MpvEvent }
    return null
  } catch { return null }
}

/**
 * mpv corriendo por detrás, con su canal de control. `onEvent` recibe los avisos (property-change, end-file…); `onExit`,
 * si mpv se cierra solo (por ejemplo porque el aparato se desconectó).
 */
export class Mpv {
  private proc: ChildProcess | null = null
  private sock: net.Socket | null = null
  private next = 1
  private waiting = new Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void }>()
  private buf = ''
  log = ''

  constructor(private exe: string, private onEvent: (e: MpvEvent) => void, private onExit: (code: number | null) => void) {}

  get running() { return !!this.proc && this.proc.exitCode == null && !!this.sock }

  async start(device: string, opts: { ao?: string; pipe?: string } = {}): Promise<void> {
    await this.stop()
    const pipe = opts.pipe ?? (process.platform === 'win32' ? `\\\\.\\pipe\\paila-mpv-${process.pid}-${Date.now()}` : path.join(process.env.TMPDIR ?? '/tmp', `paila-mpv-${process.pid}-${Date.now()}.sock`))
    const p = spawn(this.exe, mpvArgs({ device, pipe, ao: opts.ao }), { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    this.proc = p
    this.log = ''
    const keep = (d: Buffer) => { this.log = (this.log + d.toString()).slice(-4000) }
    p.stdout?.on('data', keep); p.stderr?.on('data', keep)
    p.on('exit', (code) => { if (this.proc === p) { this.proc = null; this.sock?.destroy(); this.sock = null; this.failAll(T.cerrado); this.onExit(code) } })
    // el canal de control aparece unos milisegundos después de arrancar
    for (let i = 0; i < 100 && !this.sock; i++) {
      if (p.exitCode != null) throw new Error(T.noArranco(this.log.trim().split(/\r?\n/).pop() ?? ''))
      try { this.sock = await connect(pipe) } catch { await new Promise((r) => setTimeout(r, 50)) }
    }
    if (!this.sock) { p.kill(); throw new Error(T.sinCanal) }
    this.sock.on('data', (d) => this.read(d.toString('utf8')))
    this.sock.on('error', () => {})
  }

  private read(s: string) {
    this.buf += s
    for (let i = this.buf.indexOf('\n'); i >= 0; i = this.buf.indexOf('\n')) {
      const line = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1)
      const m = parseLine(line)
      if (m?.reply) { const w = this.waiting.get(m.reply.id); this.waiting.delete(m.reply.id); if (w) m.reply.error === 'success' ? w.ok(m.reply.data) : w.fail(new Error(m.reply.error)) }
      else if (m?.event) this.onEvent(m.event)
    }
  }

  private failAll(why: string) { for (const w of this.waiting.values()) w.fail(new Error(why)); this.waiting.clear() }

  /** Un pedido a mpv ("loadfile", "seek", "set_property"…); devuelve lo que contesta. */
  command(...args: unknown[]): Promise<unknown> {
    const sock = this.sock
    if (!sock) return Promise.reject(new Error(T.noCorre))
    const id = this.next++
    return new Promise((ok, fail) => {
      const t = setTimeout(() => { if (this.waiting.delete(id)) fail(new Error(T.noContesto)) }, 5000)
      this.waiting.set(id, { ok: (v) => { clearTimeout(t); ok(v) }, fail: (e) => { clearTimeout(t); fail(e) } })
      sock.write(JSON.stringify({ command: args, request_id: id }) + '\n')
    })
  }

  async stop(): Promise<void> {
    const p = this.proc
    this.proc = null
    this.sock?.destroy(); this.sock = null
    this.failAll(T.cerrado)
    if (!p || p.exitCode != null) return
    await new Promise<void>((r) => { const t = setTimeout(() => { p.kill(); r() }, 1500); p.once('exit', () => { clearTimeout(t); r() }); try { p.kill() } catch { r() } })
  }
}

const connect = (pipe: string) => new Promise<net.Socket>((ok, fail) => {
  const s = net.connect(pipe)
  s.once('connect', () => { s.removeAllListeners('error'); ok(s) })
  s.once('error', fail)
})
