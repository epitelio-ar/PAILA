// Motor de íconos de PAILA y NAPIA: a partir de los dibujos originales (build/arte/*-original.jpg) recorta el fondo crema y arma,
// para cada programa, la figurita grande (build/arte/figurita.png), build/icon.png (512), build/icon.ico (16–256, con 20 y 30 para pantallas al 125 %) y el logo de la interfaz.
// Lo llaman apps/*/build/make-icon.cjs. Con --lamina=<archivo.png> también deja la lámina de prueba (todos los tamaños, fondo claro y oscuro).
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs'), path = require('node:path')

const RAIZ = path.resolve(__dirname, '../..')
const PROGRAMAS = {
  paila: { id: 'paila', nombre: 'PAILA', numero: 'N.º 1', color: '#ff9a3c', carpeta: path.join(RAIZ, 'apps/paila'), original: 'oreja-4-bastante.jpg', recorte: 'oreja-recorte.png' },
  napia: { id: 'napia', nombre: 'NAPIA', numero: 'N.º 2', color: '#a78bfa', carpeta: path.join(RAIZ, 'apps/napia'), original: 'napia-nueva.jpg', recorte: 'napia-recorte.png' },
}

// Se arman siempre los dos juntos (que se vean hermanos); `solo` limita qué se escribe.
function correr(solo) {
  const laminaArg = process.argv.find((a) => a.startsWith('--lamina='))
  app.disableHardwareAcceleration()
  app.whenReady().then(async () => {
    const w = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { offscreen: true } })
    await w.loadURL('data:text/html,<body></body>')
    await w.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname, 'pagina.js'), 'utf8'))
    await w.webContents.executeJavaScript('globalThis.ESTILO_ICONO = ' + JSON.stringify(process.env.PAILA_ICONO || ''))
    const programas = Object.values(PROGRAMAS).map((p) => ({
      id: p.id, nombre: p.nombre, numero: p.numero, color: p.color,
      dataUrl: 'data:image/jpeg;base64,' + fs.readFileSync(path.join(p.carpeta, 'build/arte', p.original)).toString('base64'),
    }))
    const r = await w.webContents.executeJavaScript(`generar(${JSON.stringify({ programas })})`)
    const b = (s) => Buffer.from(s, 'base64')
    for (const p of Object.values(PROGRAMAS)) {
      if (solo && solo !== p.id) continue
      const o = r[p.id], build = path.join(p.carpeta, 'build')
      fs.writeFileSync(path.join(build, 'arte', p.recorte), b(o.recorte))
      fs.writeFileSync(path.join(build, 'arte', 'figurita.png'), b(o.figurita))
      fs.writeFileSync(path.join(build, 'icon.png'), b(o.icon512))
      fs.mkdirSync(path.join(p.carpeta, 'ui/src/assets'), { recursive: true })
      fs.writeFileSync(path.join(p.carpeta, 'ui/src/assets/logo.png'), b(o.logo)) // el de la cabecera y las pantallas vacías
      // ICO con PNG adentro (válido desde Windows Vista)
      const pngs = o.ico.map((e) => ({ s: e.s, bytes: b(e.b64) }))
      const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4)
      let off = 6 + 16 * pngs.length; const dir = []
      for (const { s, bytes } of pngs) {
        const e = Buffer.alloc(16); e[0] = s === 256 ? 0 : s; e[1] = s === 256 ? 0 : s; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6)
        e.writeUInt32LE(bytes.length, 8); e.writeUInt32LE(off, 12); off += bytes.length; dir.push(e)
      }
      fs.writeFileSync(path.join(build, 'icon.ico'), Buffer.concat([head, ...dir, ...pngs.map((x) => x.bytes)]))
    }
    if (laminaArg) fs.writeFileSync(laminaArg.slice('--lamina='.length), b(r.lamina))
    app.quit()
  })
}
module.exports = { correr }
