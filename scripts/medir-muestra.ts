// Mide qué tan certera es la muestra de NAPIA (packages/core/sockseek/muestra.ts) con música de verdad: toma temas que PAILA ya
// analizó (inflados, sin pérdida falsos, MP3 de 320 buenos y sin pérdida buenos), corta el primer 30 % de cada uno como si
// estuviera a medio bajar y compara lo que dice el pedazo con lo que dice el archivo entero (con la revisión de hoy).
// Solo lee: la base se abre de solo lectura y los temas no se tocan (los pedazos van a una carpeta temporal y se borran).
// Uso: node scripts/run-ts.mjs scripts/medir-muestra.ts <paila.db> <carpeta de la música> [temas por grupo] [salida.json]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import { findFfprobe } from '../packages/core/probe'
import { revisarArchivo } from '../packages/core/sockseek/calidad'
import { MUESTRA, sacarMuestra, truchaEn } from '../packages/core/sockseek/muestra'

const [dbPath, musica, porGrupo = '15', salida] = process.argv.slice(2)
const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const deps = { ffmpeg, ffprobe: findFfprobe()! }
const db = new DatabaseSync(dbPath, { readOnly: true })
const n = Number(porGrupo)

const GRUPOS: Record<string, string> = {
  inflados: "a.flags like '%upscaled%'",
  sinPerdidaFalsos: "a.flags like '%fake_lossless%'",
  mp3Buenos: "f.ext = 'mp3' and a.grade = 'B' and a.flags not like '%upscaled%'",
  sinPerdidaBuenos: "f.ext in ('flac', 'wav') and a.grade in ('A', 'A+') and a.flags not like '%fake%' and a.flags not like '%transcoded%'",
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'medir-muestra-'))
const filas: { grupo: string; tema: string; entero: string | null; pedazo: string | null; notaEntero: string; notaPedazo: string | null; ms: number }[] = []
try {
  for (const [grupo, donde] of Object.entries(GRUPOS)) {
    const temas = db.prepare(`select f.rel_path p, f.ext ext from files f join analysis a on a.file_id = f.id where f.root_id = 1 and f.trashed_at is null and f.missing_at is null and ${donde} order by random() limit ?`).all(n) as { p: string; ext: string }[]
    for (const t of temas) {
      const file = path.join(musica, t.p)
      if (!fs.existsSync(file)) continue
      const t0 = Date.now()
      const entero = await revisarArchivo(file, 'buena', deps)
      const b = fs.readFileSync(file)
      const inc = path.join(tmp, `pedazo.${t.ext}.incomplete`)
      fs.writeFileSync(inc, b.subarray(0, Math.max(MUESTRA.minimo, Math.floor(b.length * MUESTRA.fraccion))))
      const m = await sacarMuestra(ffmpeg, inc, t.ext, tmp)
      const pedazo = m ? await revisarArchivo(m, 'buena', deps) : null
      if (m) fs.rmSync(m, { force: true })
      fs.rmSync(inc, { force: true })
      filas.push({ grupo, tema: path.basename(t.p), entero: truchaEn(entero, t.ext)?.motivo ?? null, pedazo: pedazo ? truchaEn(pedazo, t.ext)?.motivo ?? null : 'sinMuestra', notaEntero: entero.nota, notaPedazo: pedazo?.nota ?? null, ms: Date.now() - t0 })
      const f = filas[filas.length - 1]
      console.log(`${grupo.padEnd(17)} entero: ${(f.entero ?? 'sirve').padEnd(16)} pedazo: ${(f.pedazo ?? 'sirve').padEnd(16)} ${f.tema}`)
    }
  }
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }

// lo que importa: cuántas veces el pedazo dice trucho y el entero no (se cortaría algo bueno), y cuántos truchos ve
const truchoEntero = filas.filter((f) => f.entero), sirveEntero = filas.filter((f) => !f.entero)
const resumen = {
  temas: filas.length,
  truchosEnteros: truchoEntero.length, truchosQueVeElPedazo: truchoEntero.filter((f) => f.pedazo && f.pedazo !== 'sinMuestra').length,
  buenosEnteros: sirveEntero.length, buenosQueElPedazoDaTruchos: sirveEntero.filter((f) => f.pedazo && f.pedazo !== 'sinMuestra').length,
  sinMuestra: filas.filter((f) => f.pedazo === 'sinMuestra').length,
}
console.log(resumen)
if (salida) fs.writeFileSync(salida, JSON.stringify({ resumen, filas }, null, 2))
