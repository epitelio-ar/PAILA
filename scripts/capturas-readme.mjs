// Rehace las capturas del README (docs/capturas/) con la biblioteca de demostración INVENTADA de scripts/demo.ts: nada sale
// de la música de nadie. Abre la app compilada oculta (npm run build antes) con una COPIA de la carpeta de datos de la demo,
// así la demo queda igual y se puede repetir.
//
//   node scripts/capturas-readme.mjs <carpeta de la demo> [es|en] [pantalla…]
//   <carpeta de la demo>: la que armó demo.ts (adentro, datos y datos-en). Ejemplo: node scripts/capturas-readme.mjs C:\PAILA-demo
//   Sin idioma, los dos; sin pantallas, todas (inicio, musica, ficha, ordenar, sonido, espacio).
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..')
// sin animaciones: con la ventana oculta no corren y la pantalla queda en la transparencia del "aparecer" (AGENTS.es.md)
const QUIETA = `document.head.insertAdjacentHTML('beforeend','<style>*{animation:none!important;transition:none!important}</style>');`
const PESTANA = `const pestana=async(id)=>{document.querySelector('.pestana[data-seccion="'+id+'"]')?.click();await esperar(2000)};`

/** Cada pantalla: qué hacer en cada idioma (los textos de los botones cambian) y cuánto esperar al final. */
export const PANTALLAS = {
  inicio: { js: () => 'await esperar(6000)' },
  musica: { js: () => `await pestana('musica'); await esperar(3000); document.querySelector('.tbody')?.scrollTo(0, 55*36); await esperar(800)` },
  ficha: { js: (l) => `await pestana('musica'); await esperar(1500); await buscar('Cometa'); await elegirFila(0); await boton('${l === 'en' ? 'Full screen' : 'En grande'}', 4000)`, espera: 4000 },
  ordenar: { js: (l) => `await esperar(3000); await irA('${l === 'en' ? 'Organize everything' : 'Ordenar todo'}'); await esperar(15000)`, espera: 3000 },
  sonido: { js: (l) => `await esperar(3000); await irA('${l === 'en' ? 'Sound at a glance' : 'Sonido de un vistazo'}'); await esperar(6000)` },
  espacio: { js: (l) => `await esperar(3000); await irA('${l === 'en' ? 'Space' : 'Espacio'}'); await esperar(4000); document.querySelector('.page')?.scrollTo(0, 999); await esperar(500)` },
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [demo, ...resto] = process.argv.slice(2)
  if (!demo || !fs.existsSync(path.join(demo, 'datos'))) { console.error('Uso: node scripts/capturas-readme.mjs <carpeta de la demo> [es|en] [pantalla…] (la carpeta tiene que tener "datos", de scripts/demo.ts)'); process.exit(2) }
  const idiomas = resto.filter((x) => x === 'es' || x === 'en'), pedidas = resto.filter((x) => PANTALLAS[x])
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-capturas-'))
  let fallas = 0
  try {
    for (const l of idiomas.length ? idiomas : ['es', 'en']) {
      const origen = path.join(demo, l === 'en' ? 'datos-en' : 'datos')
      if (!fs.existsSync(origen)) { console.error(`Falta ${origen} (node scripts/run-ts.mjs scripts/demo.ts <carpeta> --en)`); fallas++; continue }
      for (const nombre of pedidas.length ? pedidas : Object.keys(PANTALLAS)) {
        // cada captura con su propia copia: lo que haga una (proponer, escanear) no cambia la siguiente
        const datos = path.join(tmp, `${l}-${nombre}`)
        fs.cpSync(origen, datos, { recursive: true })
        const p = PANTALLAS[nombre], salida = path.join(RAIZ, 'docs', 'capturas', `${nombre}.${l}.png`)
        const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'captura.mjs'), '--datos', datos, '--escribir', '--tamano', '1600x1000', '--limite', '200',
          '--js', `${QUIETA} ${PESTANA} ${p.js(l)}`, '--espera', String(p.espera ?? 2500), '--salida', salida],
        { cwd: RAIZ, encoding: 'utf8', env: { ...process.env, PAILA_IDIOMA: l }, timeout: 300_000 })
        const ok = r.status === 0 && fs.existsSync(salida)
        if (!ok) fallas++
        console.log(`${ok ? 'listo' : 'FALLÓ'} ${nombre}.${l}.png${ok ? '' : `: ${(r.stderr || r.stdout || '').trim().split('\n').pop()}`}`)
      }
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  if (fallas) process.exitCode = 1
}
