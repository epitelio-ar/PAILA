// Cuánto tarda "Grilla y cues" de verdad (masterplan 3, punto 3: la estimación se quedaba corta en rock y en vivo): abre la app
// armada con una COPIA de la base (solo lectura: nada toca archivos), toma el aviso de medición, calcula la grilla de una playlist
// con la placa de video y anota cada tema (PAILA_GRID_TIEMPOS: cuánto tardó, cuántos pedazos escuchó Beat This!). Al final compara
// con la estimación (core/gridrun.ts, `gridPlan`).
// Uso: node scripts/run-ts.mjs scripts/grilla-tiempos.ts --datos <carpeta de datos de prueba> --playlist 65 [--salida carpeta]
import fs from 'node:fs'
import path from 'node:path'
import { abrirApp } from './conducir'
import { tomarMedicion } from './turnos.mjs'

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }
const datos = arg('datos')
const playlist = Number(arg('playlist', '65'))
if (!datos || !fs.existsSync(path.join(datos, 'paila.db'))) { console.error('Uso: grilla-tiempos.ts --datos <carpeta con una COPIA de paila.db> --playlist N'); process.exit(2) }
if (/[\\/]AppData[\\/]Roaming[\\/]PAILA$/i.test(path.resolve(datos))) { console.error('Esa es la carpeta de la base real: usá una copia.'); process.exit(2) }
const salida = arg('salida', datos)!
const log = path.join(salida, `tiempos-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.jsonl`)
process.env.PAILA_GRID_TIEMPOS = log

const soltar = await tomarMedicion(`grilla y cues, playlist ${playlist}`, { esperar: 60 * 60_000 })
const app = await abrirApp(datos, { soloLectura: true, log: path.join(salida, 'app.log') })
try {
  const plan = await app.js<{ tracks: number; already: number; seconds: number; engine: string }>(`window.paila.gridPlan(${playlist}, true, true)`)
  console.log(`Plan: ${plan.tracks} temas, ${plan.engine}, estimado ${Math.round(plan.seconds / 60)} min (${plan.seconds} s)`)
  if (plan.engine !== 'gpu') console.log('Ojo: no está usando la placa de video')
  const t0 = Date.now()
  await app.js(`(window.__grid = window.paila.gridRun(${playlist}, true, true).then((r) => (window.__done = r), (e) => (window.__done = { error: String(e) })), 1)`)
  let done: unknown = null
  while (!done) {
    await new Promise((r) => setTimeout(r, 5000))
    done = await app.js('window.__done ?? null').catch(() => null)
    const n = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).length : 0
    process.stdout.write(`\r${n}/${plan.tracks} temas · ${Math.round((Date.now() - t0) / 1000)} s   `)
  }
  console.log(`\nTerminó: ${JSON.stringify(done)} · ${Math.round((Date.now() - t0) / 1000)} s (estimado ${plan.seconds} s)`)
} finally {
  await app.cerrar().catch(() => app.matar())
  soltar()
}
