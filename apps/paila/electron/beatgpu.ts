// Beat This! con la placa de video (Fase F): una ventana oculta corre el modelo con WebGPU (onnxruntime-web, de la carpeta
// de modelos). La ventana no tiene acceso a Node: pide cada pedazo por `paila://modelo/_entrada/<n>` y devuelve los
// resultados como respuesta de executeJavaScript. Si no hay placa de video que sirva, queda en null (se usa el procesador).
import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow, net } from 'electron'
import { pathToFileURL } from 'node:url'
import { BT_CHUNK, BT_MELS, type BeatModel } from '@paila/core/analysis/beatthis'
import { textos } from '@paila/shared/idioma'

// Por qué no se puede usar la placa de video y cómo se llama si no dice su nombre (se ve en Rekordbox y cabina → grilla).
const T = textos({
  sinWebgpu: { es: 'Esta compu no tiene WebGPU', en: "This computer doesn't have WebGPU" },
  sinPlaca: { es: 'No hay placa de video que sirva', en: "There's no graphics card that works for this" },
  placa: { es: 'placa de video', en: 'graphics card' },
})

const ORT_DIST = ['npm', 'node_modules', 'onnxruntime-web', 'dist']
// la página se arma al servirla: sus avisos van en el idioma de ese momento
const page = () => `<!doctype html><meta charset="utf-8"><title>PAILA Beat This!</title>
<script src="paila://modelo/ort/ort.webgpu.min.js"></script>
<script>
let session = null
async function cargar() {
  if (!navigator.gpu) throw new Error(${JSON.stringify(T.sinWebgpu)})
  const ad = await navigator.gpu.requestAdapter()
  if (!ad) throw new Error(${JSON.stringify(T.sinPlaca)})
  ort.env.wasm.wasmPaths = 'paila://modelo/ort/'
  ort.env.logLevel = 'error'
  const buf = await (await fetch('paila://modelo/beat-this/beat_this.onnx')).arrayBuffer()
  session = await ort.InferenceSession.create(new Uint8Array(buf), { executionProviders: ['webgpu'], logSeverityLevel: 3 })
  const info = ad.info || {}
  const cap = (s) => (s || '').replace(/^./, (c) => c.toUpperCase())
  return [cap(info.vendor), cap(info.architecture), info.description].filter(Boolean).join(' ') || ${JSON.stringify(T.placa)}
}
async function correr(n) {
  const b = await (await fetch('paila://modelo/_entrada/' + n)).arrayBuffer()
  const o = await session.run({ spect: new ort.Tensor('float32', new Float32Array(b), [1, ${BT_CHUNK}, ${BT_MELS}]) })
  return { beat: Array.from(o.beat.data), downbeat: Array.from(o.downbeat.data) }
}
</script>`

export class BeatGpu {
  private win: BrowserWindow | null = null
  private ready: Promise<string> | null = null
  private inputs = new Map<number, Float32Array>()
  private seq = 0
  /** Qué placa se usa (null si todavía no se probó o no hay). */
  gpu: string | null = null
  failure: string | null = null

  constructor(private modelsDir: () => string | null) {}

  /** Lo que sirve `paila://modelo/…`: la página, onnxruntime-web, el modelo y los pedazos que esperan. */
  async serve(url: URL): Promise<Response> {
    const p = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    if (p === 'beat.html') return new Response(page(), { headers: { 'content-type': 'text/html; charset=utf-8' } })
    if (p.startsWith('_entrada/')) {
      const n = Number(p.slice(9))
      const x = this.inputs.get(n)
      this.inputs.delete(n)
      if (!x) return new Response('no está', { status: 404 })
      return new Response(new Uint8Array(x.buffer as ArrayBuffer, x.byteOffset, x.byteLength), { headers: { 'content-type': 'application/octet-stream' } })
    }
    const dir = this.modelsDir()
    if (!dir) return new Response('sin carpeta de modelos', { status: 404 })
    const file = p.startsWith('ort/') ? path.join(dir, ...ORT_DIST, path.basename(p)) : p.startsWith('beat-this/') ? path.join(dir, 'beat-this', path.basename(p)) : null
    if (!file || !fs.existsSync(file)) return new Response('no está', { status: 404 })
    const type = file.endsWith('.mjs') || file.endsWith('.js') ? 'text/javascript' : file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream'
    const r = await net.fetch(pathToFileURL(file).toString())
    return new Response(r.body, { headers: { 'content-type': type } })
  }

  /** Abre la ventana oculta y carga el modelo (una sola vez). Devuelve el nombre de la placa o tira el motivo. */
  start(): Promise<string> {
    if (this.ready) return this.ready
    this.ready = (async () => {
      const w = new BrowserWindow({ show: false, width: 200, height: 200, webPreferences: { backgroundThrottling: false, sandbox: true, contextIsolation: true, nodeIntegration: false } })
      this.win = w
      w.on('closed', () => { this.win = null; this.ready = null })
      await w.loadURL('paila://modelo/beat.html')
      const name = await w.webContents.executeJavaScript('cargar()') as string
      this.gpu = name
      return name
    })().catch((e) => {
      this.failure = String((e as Error).message ?? e).replace(/^Error: /, '')
      this.close()
      throw new Error(this.failure)
    })
    return this.ready
  }

  /** El modelo como función, para el hilo de la grilla. */
  model: BeatModel = async (spect) => {
    await this.start()
    const n = ++this.seq
    this.inputs.set(n, spect)
    const r = await this.win!.webContents.executeJavaScript(`correr(${n})`) as { beat: number[]; downbeat: number[] }
    return { beat: Float32Array.from(r.beat), downbeat: Float32Array.from(r.downbeat) }
  }

  close() {
    const w = this.win
    this.win = null
    this.ready = null
    if (w && !w.isDestroyed()) w.destroy()
  }
}
