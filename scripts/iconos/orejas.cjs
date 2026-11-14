// Las 5 orejas del termómetro del Inicio (limpia … desastre): recorta el fondo crema de cada dibujo
// (apps/paila/build/arte/oreja-N-*.jpg) y las deja en apps/paila/ui/src/assets/oreja-N.png, todas con el MISMO encuadre
// (el rectángulo que abarca a las cinco), así la oreja no salta de lugar cuando cambia de nivel.
// Uso: node_modules/electron/dist/electron.exe scripts/iconos/orejas.cjs
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs'), path = require('node:path')

const RAIZ = path.resolve(__dirname, '../..')
const ARTE = path.join(RAIZ, 'apps/paila/build/arte')
const SALIDA = path.join(RAIZ, 'apps/paila/ui/src/assets')
const NIVELES = ['oreja-1-limpia.jpg', 'oreja-2-un-poquito.jpg', 'oreja-3-algo.jpg', 'oreja-4-bastante.jpg', 'oreja-5-desastre.jpg']
const ALTO = 480 // alto final en píxeles (en el Inicio se ve a ~220 px: queda nítida también en pantallas con zoom)

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { offscreen: true } })
  await w.loadURL('data:text/html,<body></body>')
  await w.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname, 'pagina.js'), 'utf8'))
  const datos = NIVELES.map((n) => 'data:image/jpeg;base64,' + fs.readFileSync(path.join(ARTE, n)).toString('base64'))
  const r = await w.webContents.executeJavaScript(`(async () => {
    const LADO = 2000, ALTO = ${ALTO}
    const lienzos = []
    for (const d of ${JSON.stringify(datos)}) {
      const img = await cargar(d)
      const base = lienzo(LADO, LADO); base.getContext('2d').drawImage(img, 0, 0, LADO, LADO) // las que vinieron a 1024 se llevan a 2000
      lienzos.push(recortar(base, false, false))
    }
    // el rectángulo que abarca a las cinco
    let x0 = LADO, y0 = LADO, x1 = 0, y1 = 0
    for (const c of lienzos) {
      const p = c.getContext('2d').getImageData(0, 0, LADO, LADO).data
      for (let y = 0; y < LADO; y++) for (let x = 0; x < LADO; x++) if (p[(y * LADO + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
    }
    const m = 8, cw = x1 - x0 + 1 + 2 * m, ch = y1 - y0 + 1 + 2 * m
    const w = Math.round(cw * ALTO / ch)
    return lienzos.map((c) => { const o = lienzo(cw, ch); o.getContext('2d').drawImage(c, x0 - m, y0 - m, cw, ch, 0, 0, cw, ch); return aB64(achicar(o, w, ALTO)) })
  })()`)
  r.forEach((b64, i) => fs.writeFileSync(path.join(SALIDA, `oreja-${i + 1}.png`), Buffer.from(b64, 'base64')))
  console.log('listas las 5 orejas en', SALIDA)
  app.quit()
})
