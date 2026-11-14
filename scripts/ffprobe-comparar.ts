// Compara lo que leen de cada archivo dos ffprobe distintos (lo que PAILA guarda al escanear: formato, calidad, duración y
// tags; y el ISRC). Sirvió para pasar del ffprobe 4.0.2 de ffprobe-static al de gyan.dev 6.1.1 (24/10). Solo lee los archivos.
// Uso: node scripts/run-ts.mjs scripts/ffprobe-comparar.ts <salida.json> <carpeta> [<carpeta>…] [--por-tipo 300]
//      (sin --viejo/--nuevo: el de ffprobe-static contra el de apps/paila/recursos/ffprobe)
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { AUDIO_EXT } from '@paila/core/files'
import { readIsrc } from '@paila/core/isrc'
import { probe, type ProbeResult } from '@paila/core/probe'

const require = createRequire(import.meta.url)
const args = process.argv.slice(2)
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : null }
const porTipo = Number(opt('--por-tipo') ?? 300)
const viejo = opt('--viejo') ?? (require('ffprobe-static').path as string)
const nuevo = opt('--nuevo') ?? path.join(process.cwd(), 'apps/paila/recursos/ffprobe/ffprobe.exe')
const [salida, ...carpetas] = args
if (!salida || !carpetas.length) { console.error('Uso: ffprobe-comparar.ts <salida.json> <carpeta> [<carpeta>…] [--por-tipo 300]'); process.exit(2) }

/** Los archivos de audio de una carpeta (sin entrar a PIONEER ni a los proyectos de Ableton), hasta `porTipo` por extensión, repartidos. */
function archivos(raiz: string): string[] {
  const todos: string[] = []
  const walk = (d: string) => {
    let es: fs.Dirent[] = []
    try { es = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of es) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) { if (!/^(PIONEER|_PAILA)$|Project$/i.test(e.name)) walk(p) } else if (AUDIO_EXT.has(path.extname(e.name).slice(1).toLowerCase()) && !e.name.startsWith('._')) todos.push(p)
    }
  }
  walk(raiz)
  const porExt = new Map<string, string[]>()
  for (const f of todos) { const x = path.extname(f).toLowerCase(); porExt.set(x, [...(porExt.get(x) ?? []), f]) }
  // repartidos a lo largo de la carpeta, no los primeros (que serían de un mismo disco)
  return [...porExt.values()].flatMap((l) => (l.length <= porTipo ? l : Array.from({ length: porTipo }, (_, i) => l[Math.floor((i * l.length) / porTipo)])))
}

type Lectura = (ProbeResult & { isrc: string | null }) | { error: string }
const leer = async (ff: string, f: string): Promise<Lectura> => {
  try { return { ...(await probe(ff, f)), isrc: await readIsrc(ff, f) } } catch (e) { return { error: (e as Error).message } }
}

const lista = carpetas.flatMap(archivos)
console.log(`${lista.length} archivos. Viejo: ${viejo}\nNuevo: ${nuevo}`)
const difs: { archivo: string; campo: string; viejo: unknown; nuevo: unknown }[] = []
const porCampo: Record<string, number> = {}
let hechos = 0
const cola = [...lista]
await Promise.all(Array.from({ length: 4 }, async () => {
  for (let f = cola.shift(); f; f = cola.shift()) {
    const [a, b] = await Promise.all([leer(viejo, f), leer(nuevo, f)])
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const va = (a as Record<string, unknown>)[k] ?? null, vb = (b as Record<string, unknown>)[k] ?? null
      if (JSON.stringify(va) !== JSON.stringify(vb)) { difs.push({ archivo: f, campo: k, viejo: va, nuevo: vb }); porCampo[k] = (porCampo[k] ?? 0) + 1 }
    }
    if (++hechos % 200 === 0) console.log(`${hechos}/${lista.length}…`)
  }
}))
fs.writeFileSync(salida, JSON.stringify({ archivos: lista.length, porCampo, difs }, null, 1))
console.log(`Listo: ${lista.length} archivos, ${new Set(difs.map((d) => d.archivo)).size} con alguna diferencia.`, porCampo)
