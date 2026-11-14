// Arma la carpeta de Beat This! que llevan el instalador y la portable (extraResources → resources/modelos): apps/paila/recursos/modelos (no va al repositorio: pesa
// ~230 MB). Es una copia MÍNIMA de una carpeta de modelos completa (docs/compartir.md, sección 2): el modelo, su filtro mel y
// solo lo que necesita onnxruntime-web (Node con el procesador, WebGPU con la placa de video), en vez de los ~4,7 GB de un
// npm install entero. Tiene el mismo esquema que la carpeta que PAILA ya sabe leer (beat-this/ y npm/node_modules/…).
// Uso: npm run modelos:armar -- --desde <carpeta de modelos>   (o la variable PAILA_MODELOS)
//      npm run modelos:armar -- --verificar                    (solo comprueba lo ya armado; lo usan dist y pack)
//      npm run modelos:armar -- --bajar                        (lo baja: el modelo de Hugging Face, en una versión fija y
//                                                               con su huella, y onnxruntime-web de npm; lo usa el armado para Mac en GitHub)
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const raiz = path.resolve(import.meta.dirname, '..')
export const DESTINO = path.join(raiz, 'apps', 'paila', 'recursos', 'modelos')
const ORT = ['npm', 'node_modules', 'onnxruntime-web']
const COMMON = ['npm', 'node_modules', 'onnxruntime-common']
const ORT_VERSION = '1.30.0'
const CJS = ['index', 'backend', 'backend-impl', 'env', 'env-impl', 'inference-session', 'inference-session-impl', 'onnx-model', 'onnx-value', 'tensor', 'tensor-conversion', 'tensor-conversion-impl', 'tensor-factory', 'tensor-factory-impl', 'tensor-impl', 'tensor-impl-type-mapping', 'tensor-utils', 'tensor-utils-impl', 'trace', 'type-helper', 'version']
/** Lo que se copia, con la huella de lo que no cambia nunca (el modelo exportado y su filtro; compartir.md). */
export const ARCHIVOS = [
  { ruta: ['beat-this', 'beat_this.onnx'], sha256: '1337dc6c21257ed6b803418efc320df42b5d8eb296ef16648ef60457cd4b9e55' },
  { ruta: ['beat-this', 'mel-filterbank.bin'], sha256: '1ee975d96f44ccf2c3bfe37825c1c1f0b089f5703c7a12a84b1f0a3bce004533' },
  { ruta: [...ORT, 'package.json'] },
  { ruta: [...ORT, 'dist', 'ort.node.min.js'] }, // Node, con el procesador (lo que carga loadBeatThis)
  { ruta: [...ORT, 'dist', 'ort-wasm-simd-threaded.mjs'] },
  { ruta: [...ORT, 'dist', 'ort-wasm-simd-threaded.wasm'] },
  { ruta: [...ORT, 'dist', 'ort.webgpu.min.js'] }, // la ventana oculta, con la placa de video (electron/beatgpu.ts)
  { ruta: [...ORT, 'dist', 'ort-wasm-simd-threaded.asyncify.mjs'] },
  { ruta: [...ORT, 'dist', 'ort-wasm-simd-threaded.asyncify.wasm'] },
  // ort.node.min.js lo pide de afuera: solo su versión para Node (dist/cjs), sin mapas ni tipos
  { ruta: [...COMMON, 'package.json'] },
  { ruta: [...COMMON, 'dist', 'cjs', 'package.json'] },
  ...CJS.map((n) => ({ ruta: [...COMMON, 'dist', 'cjs', `${n}.js`] })),
]

const sha = (f) => new Promise((ok, mal) => {
  const h = createHash('sha256')
  fs.createReadStream(f).on('data', (d) => h.update(d)).on('end', () => ok(h.digest('hex'))).on('error', mal)
})

/** Qué falta o está mal en una carpeta armada (vacío = todo bien). */
export async function problemas(dir, conHuellas = true) {
  const mal = []
  for (const a of ARCHIVOS) {
    const f = path.join(dir, ...a.ruta)
    if (!fs.existsSync(f)) { mal.push(`falta ${a.ruta.join('/')}`); continue }
    if (conHuellas && a.sha256 && (await sha(f)) !== a.sha256) mal.push(`${a.ruta.join('/')} no es el archivo esperado (huella distinta)`)
  }
  const pkg = path.join(dir, ...ORT, 'package.json')
  if (fs.existsSync(pkg) && JSON.parse(fs.readFileSync(pkg, 'utf8')).version !== ORT_VERSION) mal.push(`onnxruntime-web no es la versión ${ORT_VERSION}`)
  return mal
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--verificar')) {
    const mal = await problemas(DESTINO, false)
    if (mal.length) {
      console.error(`Falta Beat This! para el instalador en ${DESTINO}:\n- ${mal.join('\n- ')}\nArmalo con: npm run modelos:armar -- --desde <carpeta de modelos> (cómo se arma esa carpeta: docs/compartir.md, sección 2).`)
      process.exit(1)
    }
    console.log('Beat This! para el instalador: listo.')
    return
  }
  if (args.includes('--bajar')) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-modelos-'))
    try {
      await bajarModelos(tmp)
      const mal = await problemas(tmp)
      if (mal.length) { console.error(`Lo bajado no sirve:\n- ${mal.join('\n- ')}`); process.exit(1) }
      console.log(`Listo: ${DESTINO} (${(armar(tmp) / 1048576).toFixed(0)} MB).`)
    } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
    return
  }
  const desde = args.includes('--desde') ? args[args.indexOf('--desde') + 1] : process.env.PAILA_MODELOS
  if (!desde) { console.error('Decime de dónde: npm run modelos:armar -- --desde <carpeta de modelos> (la que tiene beat-this/ y npm/).'); process.exit(1) }
  const origen = path.resolve(desde)
  const mal = await problemas(origen)
  if (mal.length) { console.error(`${origen} no sirve:\n- ${mal.join('\n- ')}`); process.exit(1) }
  const bytes = armar(origen)
  console.log(`Listo: ${DESTINO} (${ARCHIVOS.length} archivos, ${(bytes / 1048576).toFixed(0)} MB).`)
}

/** De dónde se baja el modelo: musetric/beat-this-onnx en Hugging Face, en esta versión (la de las huellas de ARCHIVOS). */
export const HF = 'https://huggingface.co/musetric/beat-this-onnx/resolve/25308706dda545c0d5950065bb0604ad71bcf1f5'

/** Baja una carpeta de modelos completa en `dir`: el modelo y su filtro (revisados con su huella) y onnxruntime-web de npm. */
export async function bajarModelos(dir) {
  for (const a of ARCHIVOS.filter((x) => x.ruta[0] === 'beat-this')) {
    const f = path.join(dir, ...a.ruta)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    console.log(`Bajando ${a.ruta.join('/')}…`)
    const r = await fetch(`${HF}/${a.ruta[1]}`, { redirect: 'follow' })
    if (!r.ok) throw new Error(`No se pudo bajar ${a.ruta[1]} (${r.status})`)
    fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()))
    if ((await sha(f)) !== a.sha256) throw new Error(`${a.ruta[1]} no es el archivo esperado (huella distinta): no se usa.`)
  }
  // los dos paquetes de npm tal cual los publica Microsoft (npm revisa su huella al bajarlos); no corre nada de ellos
  const nm = path.join(dir, 'npm', 'node_modules')
  fs.mkdirSync(nm, { recursive: true })
  for (const name of ['onnxruntime-web', 'onnxruntime-common']) {
    const r = spawnSync('npm', ['pack', `${name}@${ORT_VERSION}`, '--silent', '--pack-destination', nm], { encoding: 'utf8', shell: process.platform === 'win32', timeout: 300_000 })
    const tgz = path.join(nm, (r.stdout ?? '').trim().split(/\r?\n/).pop() ?? '')
    if (r.status !== 0 || !fs.existsSync(tgz)) throw new Error(`No se pudo bajar ${name} de npm: ${(r.stderr ?? '').trim()}`)
    const out = path.join(nm, name)
    fs.mkdirSync(out, { recursive: true })
    // en Windows, el tar del sistema (el de Git toma "C:" como si fuera otra compu)
    const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
    const t = spawnSync(tar, ['-xzf', tgz, '-C', out, '--strip-components=1'], { encoding: 'utf8', timeout: 300_000 })
    if (t.status !== 0) throw new Error(`No se pudo abrir ${path.basename(tgz)}: ${(t.stderr ?? '').trim()}`)
    fs.rmSync(tgz)
  }
}

/** Copia la carpeta mínima desde `origen` (ya revisada con `problemas`) a `destino`. Devuelve cuántos bytes copió. */
export function armar(origen, destino = DESTINO) {
  fs.rmSync(destino, { recursive: true, force: true })
  let bytes = 0
  for (const a of ARCHIVOS) {
    const f = path.join(destino, ...a.ruta)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.copyFileSync(path.join(origen, ...a.ruta), f)
    bytes += fs.statSync(f).size
  }
  return bytes
}

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) await main()
