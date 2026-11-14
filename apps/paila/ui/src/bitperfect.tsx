// Salida "bit perfect" en la pantalla (apagada de fábrica): el interruptor y el aparato elegido (se acuerdan en esta compu),
// y `MpvMotor`, que se maneja como el <audio> del reproductor pero hace sonar a mpv por detrás (electron/bitperfect.ts).
import { useCallback, useEffect, useRef, useState } from 'react'
import { Aviso, Boton, Campo, Casilla } from '@paila/diseno'
import type { BitPerfectEvent, BitPerfectInfo } from '@paila/shared/types'
import { textos, num } from '@paila/shared/idioma'

const T = textos({
  tip: { es: 'Que el archivo le llegue a tu placa de sonido o a tu DAC exactamente como está grabado: sin el mezclador de Windows, que puede cambiar la frecuencia o el volumen. Sirve con equipos de audio buenos. Mientras está prendida, PAILA toma el aparato para ella sola (los demás programas no suenan por ahí) y el volumen se maneja desde el equipo.', en: "Lets the file reach your sound card or DAC exactly as it was recorded: without the Windows mixer, which can change the sample rate or the volume. It's meant for good audio gear. While it's on, PAILA takes the device for itself (other programs can't play through it) and the volume is controlled from the device." },
  bits32dec: { es: '32 bits (decimales)', en: '32 bits (floating point)' },
  mismaFrec: { es: (k: string) => `Sale a ${k}, sin cambiar la frecuencia (un formato con pérdida, como el MP3, se decodifica igual que siempre)`, en: (k: string) => `Plays at ${k}, with no change to the sample rate (a lossy format like MP3 is decoded the same as always)` },
  talCual: { es: (k: string, b: string) => `Sale tal cual: ${k} · ${b}`, en: (k: string, b: string) => `Plays as is: ${k} · ${b}` },
  cambia: { es: (ko: string, bo: string, ki: string, bi: string) => `Sale a ${ko} · ${bo} (el archivo es de ${ki} · ${bi}): tu aparato no acepta el formato original`, en: (ko: string, bo: string, ki: string, bi: string) => `Plays at ${ko} · ${bo} (the file is ${ki} · ${bi}): your device doesn't accept the original format` },
  sinMpv: { es: 'La salida "bit perfect" necesita mpv, que no vino con esta copia de PAILA.', en: 'The "bit perfect" output needs mpv, which did not come with this copy of PAILA.' },
  casilla: { es: 'Salida "bit perfect"', en: '"Bit perfect" output' },
  detalle: { es: 'Apagada, PAILA suena como siempre. Prendida, el volumen se maneja desde tu equipo.', en: "Off, PAILA plays as usual. On, the volume is controlled from your device." },
  aparato: { es: 'Aparato', en: 'Device' },
  aparatoInfo: { es: 'La placa de sonido o el DAC al que le llega el sonido sin retoques. Si no está conectado, PAILA vuelve a la salida normal y te avisa.', en: "The sound card or DAC that receives the sound untouched. If it isn't connected, PAILA goes back to the normal output and lets you know." },
  elegi: { es: 'Elegí uno', en: 'Pick one' },
  usarPc: { es: 'Usar la salida de la PC', en: "Use the PC's output" },
  noConectado: { es: 'El aparato que habías elegido no está conectado: suena por la salida normal.', en: "The device you had chosen isn't connected: it plays through the normal output." },
})

const KEY = 'paila.bitperfect'
const EVENT = 'paila:bitperfect'
export interface BpSetting { on: boolean; device: string | null }
export const readBp = (): BpSetting => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? '{}'); return { on: !!v.on, device: typeof v.device === 'string' ? v.device : null } } catch { return { on: false, device: null } } }
export function saveBp(s: BpSetting) {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* sin almacenamiento */ }
  window.dispatchEvent(new Event(EVENT))
}

/** El interruptor y el aparato, al día entre el reproductor y Configuración. `active`: prendida y con aparato elegido. */
export function useBitPerfect() {
  const [s, setS] = useState(readBp)
  useEffect(() => { const sync = () => setS(readBp()); window.addEventListener(EVENT, sync); return () => window.removeEventListener(EVENT, sync) }, [])
  return { ...s, active: s.on && !!s.device }
}

export const BP_TIP = T.tip

/** Se maneja como un <audio> (play, pause, currentTime…) pero suena por mpv con la salida exclusiva. */
export class MpvMotor extends EventTarget {
  paused = true
  duration = NaN
  volume = 1
  muted = false
  private time = 0
  /** Cómo está grabado y cómo sale lo que suena (null mientras no se sabe). */
  format: Extract<BitPerfectEvent, { type: 'format' }> | null = null

  get currentTime() { return this.time }
  set currentTime(t: number) { this.time = t; void window.paila.bitPerfectSeek(t).catch(() => {}) }

  load(id: number, device: string, at = 0) {
    this.paused = false; this.time = at; this.duration = NaN; this.format = null
    window.paila.bitPerfectLoad(id, device, at).catch((e) => this.lost((e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')))
  }
  play() { this.paused = false; this.emit('play'); return window.paila.bitPerfectPause(false).then(() => {}) }
  pause() { this.paused = true; this.emit('pause'); void window.paila.bitPerfectPause(true).catch(() => {}) }
  release() { this.paused = true; void window.paila.bitPerfectStop() }

  /** Lo que avisa mpv. */
  handle(e: BitPerfectEvent) {
    if (e.type === 'time') { this.time = e.time; this.emit('timeupdate') }
    else if (e.type === 'duration') { this.duration = e.duration; this.emit('loadedmetadata') }
    else if (e.type === 'pause') { if (e.paused !== this.paused) { this.paused = e.paused; this.emit(e.paused ? 'pause' : 'play') } }
    else if (e.type === 'playing') { this.paused = false; this.emit('play'); this.emit('playing') }
    else if (e.type === 'ended') { this.paused = true; this.emit('ended') }
    else if (e.type === 'error') this.emit('error')
    else if (e.type === 'format') { this.format = e; this.emit('format') }
    else if (e.type === 'lost') this.lost(e.message)
  }
  /** El aparato no está o mpv se cerró: el reproductor vuelve a la salida normal (escucha "lost"). */
  lost(message: string) { this.paused = true; this.dispatchEvent(new CustomEvent('lost', { detail: message })) }
  private emit(type: string) { this.dispatchEvent(new Event(type)) }
}

export interface MotorHandlers { play(): void; pause(): void; ended(): void; time(t: number): void; duration(d: number): void; playing(): void; error(): void; lost(message: string): void; format(text: string | null): void }

/** El motor de mpv del reproductor, conectado a lo que avisa el proceso principal. `h` puede cambiar en cada render. */
export function useMpvMotor(h: MotorHandlers): MpvMotor {
  const [m] = useState(() => new MpvMotor())
  const ref = useRef(h); ref.current = h
  useEffect(() => {
    const off = window.paila.onBitPerfect((e) => m.handle(e))
    const on: [string, () => void][] = [
      ['play', () => ref.current.play()], ['pause', () => ref.current.pause()], ['ended', () => ref.current.ended()], ['playing', () => ref.current.playing()],
      ['timeupdate', () => ref.current.time(m.currentTime)], ['loadedmetadata', () => ref.current.duration(m.duration)], ['error', () => ref.current.error()],
      ['format', () => ref.current.format(formatText(m.format))],
    ]
    const lost = (e: Event) => ref.current.lost((e as CustomEvent<string>).detail)
    for (const [k, f] of on) m.addEventListener(k, f)
    m.addEventListener('lost', lost)
    return () => { off(); for (const [k, f] of on) m.removeEventListener(k, f); m.removeEventListener('lost', lost) }
  }, [m])
  return m
}

/** "Sale tal cual: 44,1 kHz · 16 bits" o qué cambió. */
export function formatText(f: MpvMotor['format']): string | null {
  if (!f?.in || !f.out) return null
  const khz = (n: number) => `${num(n / 1000, { maximumFractionDigits: 1 })} kHz`
  const bits = (s: string) => (/^s16/.test(s) ? '16 bits' : /^s24/.test(s) ? '24 bits' : /^s32/.test(s) ? '32 bits' : /^float/.test(s) ? T.bits32dec : s)
  // MP3, AAC, OGG: se decodifican a decimales; lo que importa es que no se cambie la frecuencia
  if (f.same && /^float/.test(f.in.format)) return T.mismaFrec(khz(f.out.samplerate))
  return f.same ? T.talCual(khz(f.out.samplerate), bits(f.in.format)) : T.cambia(khz(f.out.samplerate), bits(f.out.format), khz(f.in.samplerate), bits(f.in.format))
}

/** El interruptor y el aparato, para Configuración y el panel de salida del reproductor. */
export function BitPerfectOutput() {
  const s = useBitPerfect()
  const [info, setInfo] = useState<BitPerfectInfo | null>(null)
  const refresh = useCallback(() => { window.paila.bitPerfectInfo().then(setInfo).catch(() => setInfo({ available: false, devices: [] })) }, [])
  useEffect(() => { refresh(); navigator.mediaDevices?.addEventListener?.('devicechange', refresh); return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refresh) }, [refresh])
  if (!info) return null
  if (!info.available) return <Aviso tone="atencion">{T.sinMpv}</Aviso>
  const device = s.device && info.devices.some((d) => d.id === s.device) ? s.device : null
  const set = (p: Partial<BpSetting>) => saveBp({ on: s.on, device: s.device, ...p })
  return (
    <>
      <Casilla checked={s.on} onChange={(v) => set({ on: v, device: device ?? info.devices[0]?.id ?? null })} label={T.casilla} info={BP_TIP}
        detail={T.detalle} />
      {s.on && (
        <Campo label={T.aparato} info={T.aparatoInfo}>
          <select value={device ?? ''} onChange={(e) => set({ device: e.target.value })} style={{ maxWidth: 420 }}>
            {!device && <option value="">{T.elegi}</option>}
            {info.devices.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </Campo>
      )}
      {s.on && s.device && !device && (
        <Aviso tone="atencion">{T.noConectado}{info.devices.length > 0 && <> <Boton size="sm" onClick={() => set({ device: info.devices[0].id })}>{T.usarPc}</Boton></>}</Aviso>
      )}
    </>
  )
}
