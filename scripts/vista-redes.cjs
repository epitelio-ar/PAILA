// La imagen que GitHub muestra al compartir el repositorio (Settings → Social preview, 1280×640): la oreja, el nombre y una
// línea, con los colores y la letra de @paila/diseno. Sin datos de ninguna biblioteca. Se arma con el Electron del proyecto:
//
//   node_modules/electron/dist/electron.exe scripts/vista-redes.cjs   → docs/capturas/redes.png
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const raiz = path.resolve(__dirname, '..')
// todo adentro de la página: una página data: no puede leer archivos de la compu
const url = (p) => `data:${p.endsWith('.ttf') ? 'font/ttf' : 'image/png'};base64,` + fs.readFileSync(path.join(raiz, p)).toString('base64')
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Anton; src: url('${url('packages/diseno/letras/Anton-Regular.ttf')}'); }
html, body { margin: 0; width: 1280px; height: 640px; overflow: hidden; }
body { background: radial-gradient(circle at 28% 50%, #2a1d12 0%, #17120e 55%, #0e0b08 100%); color: #f3e9d6;
  font-family: "Segoe UI Variable Text", "Segoe UI", sans-serif; display: flex; align-items: center; }
.oreja { width: 400px; height: 400px; margin: 0 40px 0 90px; filter: drop-shadow(10px 12px 0 #000); }
h1 { font: 196px/0.9 Anton, Impact, sans-serif; color: #ff9a3c; margin: 0; letter-spacing: .01em; text-shadow: 7px 7px 0 #000; }
p { font-size: 38px; line-height: 1.25; margin: 22px 0 0; max-width: 640px; }
.chico { font-size: 25px; color: #c4b49c; margin-top: 26px; }
.notas { display: flex; gap: 10px; margin-top: 30px; }
.notas span { font: 30px/1 Anton, Impact, sans-serif; color: #111; padding: 6px 14px; border: 2px solid #000; border-radius: 6px; box-shadow: 3px 3px 0 #000; }
</style></head><body>
<img class="oreja" src="${url('apps/paila/ui/src/assets/logo.png')}">
<div><h1>PAILA</h1>
<p>Tu música ordenada, sin repetidos y sonando como tiene que sonar.</p>
<p class="chico">Your music: tidy, no duplicates, sounding the way it should · libre y de código abierto · free and open source</p>
<div class="notas"><span style="background:#22d3ee">A+</span><span style="background:#34d399">A</span><span style="background:#a3e635">B</span><span style="background:#facc15">C</span><span style="background:#fb923c">D</span><span style="background:#f87171">F</span></div>
</div></body></html>`

app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 1280, height: 640, show: false, useContentSize: true, webPreferences: { offscreen: true } })
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((r) => setTimeout(r, 800))
  const img = await w.webContents.capturePage({ x: 0, y: 0, width: 1280, height: 640 })
  const salida = path.join(raiz, 'docs', 'capturas', 'redes.png')
  fs.writeFileSync(salida, img.resize({ width: 1280, height: 640 }).toPNG())
  console.log('Listo:', salida)
  app.quit()
})
