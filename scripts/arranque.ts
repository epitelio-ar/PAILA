// Cuánto tarda PAILA en abrir: lanza la app COMPILADA varias veces, oculta y en modo solo mirar, con una carpeta de datos
// (una COPIA de la base) y anota cada parte, en ms desde que arrancó el proceso, hasta que la biblioteca se ve (electron/main.ts).
// Toma el aviso de medición y espera a que no haya nada pesado corriendo. Antes: `npm run build`.
//   node scripts/run-ts.mjs scripts/arranque.ts --datos <carpeta con una copia de paila.db> [--veces 6]
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { rutaApp, rutaElectron } from './app-ruta.mjs'
import { pesados, procesosAhora, tomarMedicion } from './turnos.mjs'

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }
const datos = arg('datos'), veces = Number(arg('veces', '6'))
if (!datos || !fs.existsSync(path.join(datos, 'paila.db'))) { console.error('Falta --datos <carpeta con una copia de paila.db>'); process.exit(2) }
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Una apertura: las marcas de main.ts y el tiempo de punta a punta visto desde afuera (hasta que se cierra sola). */
function abrir(): Promise<{ marcas: Record<string, number>; afuera: number }> {
  return new Promise((ok, mal) => {
    const t0 = performance.now()
    const hijo = spawn(rutaElectron(), [rutaApp()], {
      env: { ...process.env, PAILA_USER_DATA: path.resolve(datos!), PAILA_SOLO_LECTURA: '1', PAILA_OCULTA: '1', PAILA_ARRANQUE: '1', ELECTRON_RENDERER_URL: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let marcas: Record<string, number> | null = null, afuera = 0, salida = ''
    hijo.stdout.on('data', (b: Buffer) => {
      salida += b
      const m = salida.match(/\[arranque\] (\{.*\})/)
      if (m && !marcas) { marcas = JSON.parse(m[1]); afuera = Math.round(performance.now() - t0) }
    })
    hijo.stderr.on('data', (b: Buffer) => { salida += b })
    const tope = setTimeout(() => { hijo.kill(); mal(new Error(`No abrió en 60 s:\n${salida.slice(-800)}`)) }, 60_000)
    hijo.on('exit', () => { clearTimeout(tope); marcas ? ok({ marcas, afuera }) : mal(new Error(`Se cerró sin avisar:\n${salida.slice(-800)}`)) })
  })
}

const soltar = await tomarMedicion('arranque de PAILA')
try {
  for (let i = 0; ; i++) {
    const { esperar } = pesados(procesosAhora(), new Set([process.pid]))
    if (!esperar.length) break
    if (i % 6 === 0) console.log(`Esperando a que termine: ${esperar.join(', ')}`)
    await espera(10_000)
  }
  const filas: Record<string, number>[] = []
  for (let i = 0; i < veces; i++) {
    const r = await abrir()
    filas.push({ ...r.marcas, afuera: r.afuera })
    console.log(`${i + 1}. ${Object.entries(r.marcas).map(([k, v]) => `${k} ${v}`).join(' · ')} · desde afuera ${r.afuera} ms`)
  }
  // la primera abre en frío (disco y caché de Windows): la mediana es de las demás
  const resto = filas.length > 1 ? filas.slice(1) : filas
  const mediana = (k: string) => { const v = resto.map((f) => f[k]).filter((x) => x != null).sort((a, b) => a - b); return v[Math.floor(v.length / 2)] }
  console.log(`\nMediana (sin la primera): ${Object.keys(filas[0]).map((k) => `${k} ${mediana(k)}`).join(' · ')} ms`)
} finally { soltar() }
