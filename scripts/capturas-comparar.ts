// `npm run capturas:comparar -- <carpeta-antes> <carpeta-despues>`: compara dos corridas de `npm run capturas` pantalla por pantalla
// y arma una lámina de antes y después (`lamina.html`, con una imagen de dónde cambió cada una). No hace falta abrir la app.
//
//   npm run capturas:comparar -- capturas/2026-10-22_1500 capturas/2026-10-22_1700
//   --salida <carpeta>   dónde dejar la lámina (por defecto, al lado de la carpeta "después", en comparacion-<antes>-vs-<despues>)
//   --tolerancia 8       cuánto puede variar un color (0–255) para no contarlo como cambio (el suavizado de letras varía un poco)
import fs from 'node:fs'
import path from 'node:path'
import { comparar, escribirPng, leerPng } from './png'

export type Estado = 'igual' | 'cambio' | 'nueva' | 'falta'
export interface Resultado { archivo: string; estado: Estado; cambiado: number; mismoTamano: boolean; diferencia?: string }

/** Todos los PNG de una carpeta de capturas, con la ruta relativa (siempre con /). */
export function listarPng(raiz: string, sub = ''): string[] {
  const dir = path.join(raiz, sub)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = sub ? `${sub}/${e.name}` : e.name
    return e.isDirectory() ? listarPng(raiz, rel) : e.name.toLowerCase().endsWith('.png') ? [rel] : []
  }).sort()
}

/** Compara dos carpetas. Las diferencias se escriben como PNG en `salida/diferencias/`. */
export function compararCarpetas(antes: string, despues: string, salida: string, tolerancia = 8): Resultado[] {
  const a = new Set(listarPng(antes)), d = new Set(listarPng(despues))
  const out: Resultado[] = []
  for (const archivo of [...new Set([...a, ...d])].sort()) {
    if (!a.has(archivo)) { out.push({ archivo, estado: 'nueva', cambiado: 1, mismoTamano: false }); continue }
    if (!d.has(archivo)) { out.push({ archivo, estado: 'falta', cambiado: 1, mismoTamano: false }); continue }
    const bA = fs.readFileSync(path.join(antes, archivo)), bD = fs.readFileSync(path.join(despues, archivo))
    if (bA.equals(bD)) { out.push({ archivo, estado: 'igual', cambiado: 0, mismoTamano: true }); continue }
    const r = comparar(leerPng(bA), leerPng(bD), tolerancia)
    if (!r.diferencia) { out.push({ archivo, estado: 'igual', cambiado: 0, mismoTamano: r.mismoTamano }); continue }
    const dif = path.join('diferencias', archivo)
    fs.mkdirSync(path.dirname(path.join(salida, dif)), { recursive: true })
    fs.writeFileSync(path.join(salida, dif), escribirPng(r.diferencia))
    out.push({ archivo, estado: 'cambio', cambiado: r.cambiado, mismoTamano: r.mismoTamano, diferencia: dif.split(path.sep).join('/') })
  }
  return out
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const pct = (x: number) => `${(x * 100).toFixed(x < 0.01 ? 2 : 1)} %`
const url = (desde: string, hasta: string) => path.relative(desde, hasta).split(path.sep).join('/').split('/').map(encodeURIComponent).join('/')

/** La lámina: primero lo que cambió (antes, después y dónde), después lo nuevo o ausente y, al final, lo que quedó igual. */
export function laminaHtml(r: Resultado[], antes: string, despues: string, salida: string): string {
  const cambios = r.filter((x) => x.estado === 'cambio'), nuevas = r.filter((x) => x.estado === 'nueva'), faltan = r.filter((x) => x.estado === 'falta'), iguales = r.filter((x) => x.estado === 'igual')
  const img = (raiz: string, f: string) => `<a href="${url(salida, path.join(raiz, f))}"><img loading="lazy" src="${url(salida, path.join(raiz, f))}" alt=""></a>`
  const fila = (x: Resultado) => `<section><h3>${esc(x.archivo)} <small>${pct(x.cambiado)} distinto${x.mismoTamano ? '' : ' · cambió el tamaño de la ventana'}</small></h3><div class="tres"><figure><figcaption>Antes</figcaption>${img(antes, x.archivo)}</figure><figure><figcaption>Después</figcaption>${img(despues, x.archivo)}</figure><figure><figcaption>Dónde cambió</figcaption><a href="${x.diferencia}"><img loading="lazy" src="${x.diferencia}" alt=""></a></figure></div></section>`
  const sola = (x: Resultado, raiz: string, que: string) => `<section><h3>${esc(x.archivo)} <small>${que}</small></h3><div class="uno">${img(raiz, x.archivo)}</div></section>`
  return `<!doctype html><html lang="es"><meta charset="utf-8"><title>Capturas: antes y después</title>
<style>body{font:15px system-ui,sans-serif;background:#15171a;color:#e8e6e1;margin:0 auto;max-width:1700px;padding:16px}h1{font-size:22px}h2{margin-top:32px;border-bottom:1px solid #333;padding-bottom:4px}h3{margin:24px 0 8px;font-size:15px}small{color:#9a978f;font-weight:400}.tres{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.uno{max-width:50%}figure{margin:0}figcaption{font-size:12px;color:#9a978f;margin-bottom:2px}img{width:100%;display:block;border:1px solid #333}ul{columns:3;color:#9a978f}</style>
<h1>Capturas: antes y después</h1>
<p>Antes: <code>${esc(antes)}</code><br>Después: <code>${esc(despues)}</code></p>
<p><b>${cambios.length}</b> cambiaron · <b>${nuevas.length}</b> nuevas · <b>${faltan.length}</b> ya no están · <b>${iguales.length}</b> iguales</p>
${cambios.length ? `<h2>Cambiaron</h2>${cambios.sort((a, b) => b.cambiado - a.cambiado).map(fila).join('')}` : ''}
${nuevas.length ? `<h2>Nuevas</h2>${nuevas.map((x) => sola(x, despues, 'no estaba antes')).join('')}` : ''}
${faltan.length ? `<h2>Ya no están</h2>${faltan.map((x) => sola(x, antes, 'no está después')).join('')}` : ''}
${iguales.length ? `<h2>Iguales</h2><ul>${iguales.map((x) => `<li>${esc(x.archivo)}</li>`).join('')}</ul>` : ''}</html>`
}

/** Lo que dice la terminal al terminar. */
export function resumenTexto(r: Resultado[], lamina: string): string {
  const n = (e: Estado) => r.filter((x) => x.estado === e).length
  const top = r.filter((x) => x.estado === 'cambio').sort((a, b) => b.cambiado - a.cambiado).slice(0, 8).map((x) => `  ${pct(x.cambiado).padStart(7)}  ${x.archivo}`)
  return [`${r.length} pantallas: ${n('igual')} iguales · ${n('cambio')} cambiaron · ${n('nueva')} nuevas · ${n('falta')} ya no están`, ...(top.length ? ['Lo que más cambió:', ...top] : []), `Lámina: ${lamina}`].join('\n')
}

function main() {
  const args = process.argv.slice(2)
  const valor = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
  const pos = args.filter((x, i) => !x.startsWith('--') && !['--salida', '--tolerancia'].includes(args[i - 1]))
  if (pos.length !== 2) { console.error('Uso: npm run capturas:comparar -- <carpeta-antes> <carpeta-despues> [--salida <carpeta>] [--tolerancia 8]'); process.exit(2) }
  const [antes, despues] = pos.map((p) => path.resolve(p))
  for (const c of [antes, despues]) if (!fs.existsSync(c)) { console.error(`No existe ${c}`); process.exit(2) }
  const salida = path.resolve(valor('--salida') ?? path.join(path.dirname(despues), `comparacion-${path.basename(antes)}-vs-${path.basename(despues)}`))
  fs.mkdirSync(salida, { recursive: true })
  const r = compararCarpetas(antes, despues, salida, Number(valor('--tolerancia') ?? 8))
  const lamina = path.join(salida, 'lamina.html')
  fs.writeFileSync(lamina, laminaHtml(r, antes, despues, salida))
  fs.writeFileSync(path.join(salida, 'resultado.json'), JSON.stringify(r, null, 1))
  console.log(resumenTexto(r, lamina))
}

if (process.argv[1] && /capturas-comparar(-\d+)?\.m?[jt]s$/.test(process.argv[1])) main()
