// Ensayo general del punto 1 (scripts/ensayo.ts): después de deshacer todo, la copia contra el original, archivo por archivo y sin
// atajos. Lo que cambió (tamaño o fecha) se compara por bytes y, si no son iguales, por sonido (el audio decodificado por ffmpeg),
// tags (también el BPM y el tono), volumen parejo y tapa. Un error al leer se cuenta aparte (no como "distinto"). Cuatro archivos a la
// vez. Solo lee.
//   node scripts/run-ts.mjs scripts/ensayo-verificar.ts --original <Música> --copia <Música-copia> --salida <archivo.md>
import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { findFfmpeg } from '@paila/core/probe'
import { readCover, readReplayGain, readTags } from '@paila/core/tagio'
import { AUDIO_EXT } from '@paila/core/files'
import { readDjTag } from '@paila/core/djtag'

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : '' }
const original = arg('--original'), copia = arg('--copia'), salida = arg('--salida')
const ffmpeg = findFfmpeg()!
const list = (root: string) => {
  const out = new Map<string, fs.Stats>()
  for (const f of fs.readdirSync(root, { recursive: true }) as string[]) { const st = fs.statSync(path.join(root, f)); if (st.isFile()) out.set(f.split(path.sep).join('/'), st) }
  return out
}
const a = list(original), b = list(copia)
const paila = (r: string) => /^_paila\//i.test(r)
const faltan = [...a.keys()].filter((r) => !b.has(r) && !paila(r)), sobran = [...b.keys()].filter((r) => !a.has(r) && !paila(r))
const cambiaron = [...a.keys()].filter((r) => b.has(r) && !paila(r) && (a.get(r)!.size !== b.get(r)!.size || Math.abs(a.get(r)!.mtimeMs - b.get(r)!.mtimeMs) > 2000))
console.log(`Original ${a.size}, copia ${b.size}. Faltan ${faltan.length}, sobran ${sobran.length}, cambiaron ${cambiaron.length} (sin contar _PAILA)`)
const md5 = (f: string) => new Promise<string>((res, rej) => { const h = crypto.createHash('md5'); fs.createReadStream(f).on('data', (c) => h.update(c)).on('end', () => res(h.digest('hex'))).on('error', rej) })
const audio = (f: string) => new Promise<string>((res, rej) => execFile(ffmpeg, ['-v', 'error', '-nostdin', '-i', f, '-map', '0:a:0', '-f', 'md5', '-'], { maxBuffer: 1 << 20, timeout: 600_000 }, (e, out) => (e ? rej(e) : res(String(out).trim()))))
const meta = (f: string) => JSON.stringify({ tags: readTags(f, { exact: true }), dj: readDjTag(f), rg: readReplayGain(f), cover: crypto.createHash('md5').update(readCover(f) ?? '').digest('hex') })
const res = { bytes: 0, igual: 0, distinto: [] as string[], error: [] as string[] }
let next = 0, hechos = 0
async function worker() {
  for (;;) {
    const i = next++
    if (i >= cambiaron.length) return
    const r = cambiaron[i], A = path.join(original, r), B = path.join(copia, r)
    try {
      if (a.get(r)!.size === b.get(r)!.size && await md5(A) === await md5(B)) res.bytes++
      else if (!AUDIO_EXT.has(path.extname(r).slice(1).toLowerCase())) res.distinto.push(`${r} (no es audio)`)
      else {
        const [sa, sb] = [await audio(A), await audio(B)]
        let ma = '', mb = ''
        try { ma = meta(A) } catch (e) { ma = `ilegible: ${(e as Error).message}` }
        try { mb = meta(B) } catch (e) { mb = `ilegible: ${(e as Error).message}` }
        if (sa === sb && ma === mb) res.igual++
        else res.distinto.push(`${r} (${sa === sb ? 'mismo sonido' : 'OTRO SONIDO'}${ma === mb ? '' : `; tags, tapa o volumen: ${ma.slice(0, 200)} → ${mb.slice(0, 200)}`})`)
      }
    } catch (e) { res.error.push(`${r}: ${(e as Error).message}`) }
    if (++hechos % 200 === 0) console.log(`  ${hechos}/${cambiaron.length}`)
  }
}
await Promise.all([worker(), worker(), worker(), worker()])
const md = [`# La copia contra el original (${new Date().toISOString()})`, '',
  `Original ${a.size} archivos, copia ${b.size} (sin contar _PAILA: faltan ${faltan.length}, sobran ${sobran.length}).`,
  `Cambiaron (tamaño o fecha) ${cambiaron.length}: ${res.bytes} con los mismos bytes, ${res.igual} con el mismo sonido, tags, volumen parejo y tapa (los bytes se reacomodaron), ${res.distinto.length} distintos y ${res.error.length} que no se pudieron leer.`, '',
  ...(faltan.length ? ['## Faltan en la copia', ...faltan.map((x) => `- \`${x}\``), ''] : []),
  ...(sobran.length ? ['## Sobran en la copia', ...sobran.map((x) => `- \`${x}\``), ''] : []),
  ...(res.distinto.length ? ['## Distintos', ...res.distinto.map((x) => `- ${x}`), ''] : []),
  ...(res.error.length ? ['## No se pudieron leer', ...res.error.map((x) => `- ${x}`), ''] : [])].join('\n')
fs.writeFileSync(salida, md)
console.log(md.split('\n').slice(0, 4).join('\n'))
