// Separar voz: lo que se baja aparte a <datos>/modelos/separar-voz, verificado por huella: el modelo (MDX-Net Inst_HQ_3, de
// UVR, licencia MIT, pide crédito) y onnxruntime-node (Microsoft, MIT), el motor que lo corre en el procesador. De
// onnxruntime-node se saca solo lo de este sistema, sin DirectML (no hace falta): unos 30 MB de los 114 que pesa el paquete.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { textos } from '@paila/shared/idioma'

export const STEMS_DIR = 'separar-voz'
export const STEMS_MODEL = 'UVR-MDX-NET-Inst_HQ_3.onnx'
const ORT = 'onnxruntime-node'
const NAPI = `bin/napi-v6/${process.platform}/${process.arch}/`
/** Lo de onnxruntime-node que no hace falta (la placa de video por DirectML, en Windows). */
const SOBRA = /^(DirectML|dxcompiler|dxil)\.dll$/i

export interface StemsFile {
  file: string
  url: string
  bytes: number
  sha256: string
  /** Es un paquete de npm (.tgz): se abre en npm/node_modules/<paquete> y el .tgz se borra. */
  paquete?: string
}

/** Lo que se baja, con su tamaño y su huella. Las versiones son fijas: si cambia la huella, no se usa. El primero es el modelo. */
export const STEMS_FILES: StemsFile[] = [
  { file: STEMS_MODEL, url: 'https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR-MDX-NET-Inst_HQ_3.onnx', bytes: 66759214, sha256: '317554b07fe1ea5279a77f2b1520a41ea4b93432560c4ffd08792c30fddf9adc' },
  { file: 'onnxruntime-node-1.30.0.tgz', url: 'https://registry.npmjs.org/onnxruntime-node/-/onnxruntime-node-1.30.0.tgz', bytes: 113507888, sha256: '6e3390d6b783e7be946fad629292799da28d0b42f84856e50d2c1b0383291e75', paquete: ORT },
  { file: 'onnxruntime-common-1.30.0.tgz', url: 'https://registry.npmjs.org/onnxruntime-common/-/onnxruntime-common-1.30.0.tgz', bytes: 66795, sha256: '7906c439e0d3e0f4048caa23b64cdfadc0f455c377f579ce1ab2a4b778f07d5f', paquete: 'onnxruntime-common' },
]

/** Lo que se baja en total (para el botón "Bajar"). */
export const STEMS_BYTES = STEMS_FILES.reduce((s, f) => s + f.bytes, 0)

/**
 * Separar en 4 (opcional, aparte): HT-Demucs v4 (Meta, MIT) en un solo ONNX con los pesos en fp16 (adowu/htdemucs-onnx, MIT).
 * Usa el mismo onnxruntime-node: si ya se bajó para Separar voz, solo se baja el modelo.
 */
export const CUATRO_MODEL = 'htdemucs_fp16weights.onnx'
export const CUATRO_FILES: StemsFile[] = [
  { file: CUATRO_MODEL, url: 'https://huggingface.co/adowu/htdemucs-onnx/resolve/main/htdemucs_fp16weights.onnx', bytes: 165612636, sha256: 'd05c269d0178d2a72ad484b10b11dd370193fc923201c3b27a99f848745db70a' },
  ...STEMS_FILES.slice(1),
]
export const CUATRO_BYTES = CUATRO_FILES.reduce((s, f) => s + f.bytes, 0)

/** Máxima calidad (opcional, aparte): los cuatro especialistas de htdemucs_ft (StemSplitio/htdemucs-ft-onnx, MIT), en el orden de DEMUCS_PARTES. */
const FT = 'https://huggingface.co/StemSplitio/htdemucs-ft-onnx/resolve/main/'
export const MAX_MODELS = ['htdemucs_ft_drums.onnx', 'htdemucs_ft_bass.onnx', 'htdemucs_ft_other.onnx', 'htdemucs_ft_vocals.onnx']
export const MAX_FILES: StemsFile[] = [
  { file: MAX_MODELS[0], url: FT + MAX_MODELS[0], bytes: 316446953, sha256: 'f76b68af36066e38885b369299b5032a861038f9b49da5aa6cf1c31cfa69cf27' },
  { file: MAX_MODELS[1], url: FT + MAX_MODELS[1], bytes: 316446953, sha256: '2a74d9283fc2336fcc58d50f87a7080aff57aea372f65cfe3f0211ea1ff16182' },
  { file: MAX_MODELS[2], url: FT + MAX_MODELS[2], bytes: 316446953, sha256: '90e11806c1bb558ca9d9c7e909d28a2854f7f217982e90482dbed6442513daad' },
  { file: MAX_MODELS[3], url: FT + MAX_MODELS[3], bytes: 316446953, sha256: '8c5d5e2da1f27050240bb80236673307ee3b40d4b064066d9350f4d64bfd544d' },
  ...STEMS_FILES.slice(1),
]

const T = textos({
  distinto: { es: (f: string) => `${f} no llegó igual al original (la huella no coincide): no se usa`, en: (f: string) => `${f} didn't arrive identical to the original (the fingerprint doesn't match): it isn't used` },
  noSePudo: { es: (f: string, st: number) => `No se pudo bajar ${f} (${st})`, en: (f: string, st: number) => `Couldn't download ${f} (${st})` },
  cortado: { es: 'Se cortó la descarga', en: 'The download was stopped' },
  sinSistema: { es: 'Separar voz todavía no anda en este sistema', en: "Voice separation doesn't work on this system yet" },
})

/** Qué guardar de cada paquete (la ruta adentro de su carpeta, o null). */
function guardar(paquete: string, entry: string): string | null {
  const rel = entry.replace(/^package\//, '')
  if (rel.includes('..') || rel.startsWith('/')) return null
  if (rel === 'package.json' || rel === 'LICENSE') return rel
  if (paquete === ORT) {
    if (/^dist\/[^/]+\.js$/.test(rel)) return rel
    if (rel.startsWith(NAPI) && !rel.slice(NAPI.length).includes('/') && !SOBRA.test(rel.slice(NAPI.length))) return rel
    return null
  }
  return /^dist\/cjs\/.+\.(js|json)$/.test(rel) ? rel : null
}

/** El binario de onnxruntime-node para este sistema (si el paquete no lo trae, Separar voz no anda acá). */
const binding = (dir: string) => path.join(dir, 'npm', 'node_modules', ORT, ...NAPI.split('/').filter(Boolean), 'onnxruntime_binding.node')

/** ¿Está el motor (onnxruntime-node) para este sistema? */
export const motorListo = (dir: string) => fs.existsSync(binding(dir)) && fs.existsSync(path.join(dir, 'npm', 'node_modules', 'onnxruntime-common', 'package.json'))

/** ¿Falta bajar algo? (cada modelo con su tamaño justo, y el motor) */
export function stemsToDownload(dir: string, files: StemsFile[] = STEMS_FILES): boolean {
  for (const f of files.filter((x) => !x.paquete)) { try { if (fs.statSync(path.join(dir, f.file)).size !== f.bytes) return true } catch { return true } }
  return !fs.existsSync(binding(dir)) || !fs.existsSync(path.join(dir, 'npm', 'node_modules', 'onnxruntime-common', 'package.json'))
}

/** Saca de un .tgz lo que diga `keep` (null = no), sin juntarlo entero en memoria. Lee las rutas largas (ustar y pax). */
export async function sacarTgz(file: string, dest: string, keep: (entry: string) => string | null): Promise<string[]> {
  const out: string[] = []
  let buf: Buffer = Buffer.alloc(0)
  let cur: { left: number; pad: number; fd: number | null; pax: Buffer[] | null } | null = null
  let paxPath: string | null = null
  const str = (h: Buffer, a: number, b: number) => { const s = h.subarray(a, b).toString('utf8'); const z = s.indexOf('\0'); return z < 0 ? s : s.slice(0, z) }
  try {
    for await (const chunk of fs.createReadStream(file).pipe(zlib.createGunzip()) as AsyncIterable<Buffer>) {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk
      for (;;) {
        if (!cur) {
          if (buf.length < 512) break
          const h = buf.subarray(0, 512)
          buf = buf.subarray(512)
          if (h.every((b) => b === 0)) continue
          const size = parseInt(str(h, 124, 136).trim() || '0', 8)
          const type = String.fromCharCode(h[156] || 48)
          const prefix = str(h, 345, 500), name = paxPath ?? (prefix ? `${prefix}/${str(h, 0, 100)}` : str(h, 0, 100))
          if (type !== 'x' && type !== 'g') paxPath = null
          let fd: number | null = null
          const rel = type === '0' ? keep(name) : null
          if (rel) {
            const to = path.join(dest, ...rel.split('/'))
            fs.mkdirSync(path.dirname(to), { recursive: true })
            fd = fs.openSync(to, 'w')
            out.push(rel)
          }
          cur = { left: size, pad: (512 - (size % 512)) % 512, fd, pax: type === 'x' ? [] : null }
        }
        const take = Math.min(cur.left, buf.length)
        if (take) {
          if (cur.fd != null) fs.writeSync(cur.fd, buf.subarray(0, take))
          if (cur.pax) cur.pax.push(Buffer.from(buf.subarray(0, take)))
          buf = buf.subarray(take); cur.left -= take
        }
        if (cur.left > 0 || buf.length < cur.pad) break
        buf = buf.subarray(cur.pad)
        if (cur.fd != null) fs.closeSync(cur.fd)
        if (cur.pax) paxPath = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(Buffer.concat(cur.pax).toString('utf8'))?.[1] ?? null
        cur = null
      }
    }
  } finally {
    if (cur?.fd != null) fs.closeSync(cur.fd)
  }
  return out
}

/** Lo mínimo de fetch que se usa (en la app, el `net.fetch` de Electron; en los tests, uno de mentira). */
export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; body: ReadableStream<Uint8Array> | null }>

/**
 * Baja lo que falta a `dir`, de a un archivo, verificando tamaño y huella antes de usarlo (a una carpeta "-bajando" al lado;
 * a su lugar recién cuando está bien). Lo que ya está bien no se vuelve a bajar.
 */
export async function bajarStems(dir: string, fetch: FetchLike, on: { progress?: (bytes: number, total: number) => void; cancelled?: () => boolean } = {}, files: StemsFile[] = STEMS_FILES): Promise<void> {
  const total = files.reduce((s, f) => s + f.bytes, 0)
  const tmp = `${dir}-bajando`
  fs.mkdirSync(dir, { recursive: true }); fs.mkdirSync(tmp, { recursive: true })
  let hecho = 0
  try {
    for (const f of files) {
      const listo = f.paquete ? fs.existsSync(path.join(dir, 'npm', 'node_modules', f.paquete, 'package.json')) && (f.paquete !== ORT || fs.existsSync(binding(dir)))
        : (() => { try { return fs.statSync(path.join(dir, f.file)).size === f.bytes } catch { return false } })()
      if (listo) { hecho += f.bytes; on.progress?.(hecho, total); continue }
      const r = await fetch(f.url)
      if (!r.ok || !r.body) throw new Error(T.noSePudo(f.file, r.status))
      const part = path.join(tmp, f.file)
      const hash = crypto.createHash('sha256'), fd = fs.openSync(part, 'w')
      let n = 0
      try {
        const reader = r.body.getReader()
        for (;;) {
          if (on.cancelled?.()) { await reader.cancel(); throw new Error(T.cortado) }
          const { done, value } = await reader.read()
          if (done) break
          hash.update(value); fs.writeSync(fd, value); n += value.length
          on.progress?.(hecho + n, total)
        }
      } finally { fs.closeSync(fd) }
      if (n !== f.bytes || hash.digest('hex') !== f.sha256) { fs.rmSync(part, { force: true }); throw new Error(T.distinto(f.file)) }
      if (f.paquete) {
        const to = path.join(dir, 'npm', 'node_modules', f.paquete)
        fs.rmSync(to, { recursive: true, force: true })
        await sacarTgz(part, to, (e) => guardar(f.paquete!, e))
        fs.rmSync(part, { force: true })
        if (f.paquete === ORT && !fs.existsSync(binding(dir))) throw new Error(T.sinSistema)
      } else fs.renameSync(part, path.join(dir, f.file))
      hecho += f.bytes
    }
    // para que createRequire encuentre los paquetes desde esta carpeta
    fs.writeFileSync(path.join(dir, 'npm', 'package.json'), '{"name":"paila-separar-voz","private":true}\n')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

/** Saca solo el modelo de 4 (el motor queda para Separar voz). */
export function quitarCuatro(dir: string) { fs.rmSync(path.join(dir, CUATRO_MODEL), { force: true }) }
/** Saca solo los de máxima calidad. */
export function quitarMax(dir: string) { for (const f of MAX_MODELS) fs.rmSync(path.join(dir, f), { force: true }) }
/** Lo que falta bajar de un juego (el motor puede estar ya, de otro modo). */
export function faltaBajar(dir: string, files: StemsFile[]): number {
  return files.reduce((n, f) => {
    if (f.paquete) return n + (motorListo(dir) ? 0 : f.bytes)
    try { return n + (fs.statSync(path.join(dir, f.file)).size === f.bytes ? 0 : f.bytes) } catch { return n + f.bytes }
  }, 0)
}

/** Saca todo lo bajado (Configuración → Quitar). */
export function quitarStems(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.rmSync(`${dir}-bajando`, { recursive: true, force: true })
}
