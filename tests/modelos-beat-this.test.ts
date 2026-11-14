// Beat This! viaja siempre con PAILA: la carpeta mínima que arma scripts/modelos-beat-this.mjs tiene lo que PAILA necesita
// para usarla, el instalador y la portable la llevan (resources/modelos) y dist/pack la dejan lista antes de armar.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beatThisMissing } from '@paila/core/analysis/beatrun'
// @ts-expect-error el script es .mjs sin tipos
import { ARCHIVOS, problemas } from '../scripts/modelos-beat-this.mjs'

type Archivo = { ruta: string[]; sha256?: string }
const leer = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')

/** Una carpeta con todos los archivos de la lista, vacíos (la versión de onnxruntime-web en su package.json). */
function carpetaFalsa(version = '1.30.0'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-modelos-'))
  for (const a of ARCHIVOS as Archivo[]) {
    const f = path.join(dir, ...a.ruta)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, a.ruta.join('/') === 'npm/node_modules/onnxruntime-web/package.json' ? JSON.stringify({ version }) : '')
  }
  return dir
}

describe('Beat This! en el instalador', () => {
  it('la carpeta armada tiene todo lo que PAILA pide para usar Beat This!', async () => {
    const dir = carpetaFalsa()
    expect(beatThisMissing(dir)).toBeNull()
    expect(await problemas(dir, false)).toEqual([])
  })

  it('dice qué falta, y rechaza otra versión de onnxruntime-web', async () => {
    const dir = carpetaFalsa('1.29.0')
    fs.rmSync(path.join(dir, 'beat-this', 'beat_this.onnx'))
    expect(await problemas(dir, false)).toEqual(['falta beat-this/beat_this.onnx', 'onnxruntime-web no es la versión 1.30.0'])
  })

  it('lleva lo que cargan Node (procesador) y la ventana oculta (placa de video), y la onnxruntime-common que pide el de Node', () => {
    const rutas = (ARCHIVOS as Archivo[]).map((a) => a.ruta.join('/'))
    for (const r of ['dist/ort.node.min.js', 'dist/ort.webgpu.min.js', 'dist/ort-wasm-simd-threaded.wasm', 'dist/ort-wasm-simd-threaded.asyncify.wasm']) {
      expect(rutas).toContain(`npm/node_modules/onnxruntime-web/${r}`)
    }
    expect(rutas).toContain('npm/node_modules/onnxruntime-common/dist/cjs/index.js')
  })

  it('el instalador y la portable llevan la carpeta a resources/modelos, sin casilla', () => {
    const pkg = JSON.parse(leer('apps/paila/package.json'))
    expect(pkg.build.extraResources).toContainEqual({ from: 'recursos/modelos', to: 'modelos' })
    expect(leer('apps/paila/build/instalador.nsh')).not.toMatch(/BEAT|modelos/i)
  })

  it('dist y pack dejan Beat This! armado antes de empezar (scripts/preparar-instalador.mjs), y git no lo guarda', () => {
    const { scripts } = JSON.parse(leer('package.json'))
    expect(scripts.dist).toMatch(/^node scripts\/preparar-instalador\.mjs && /)
    expect(scripts.pack).toMatch(/^node scripts\/preparar-instalador\.mjs && /)
    expect(leer('.gitignore')).toContain('apps/paila/recursos/modelos/')
  })
})
