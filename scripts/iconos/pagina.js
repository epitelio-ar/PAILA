// Parte "de pantalla" del generador de íconos: recorta el dibujo del fondo crema y arma la figurita grande, el ícono chico y la lámina.
// Corre dentro de una ventana oculta de Electron (canvas); lo llama scripts/iconos/motor.cjs. Sin dependencias.
const CREMA = '#f6ead0', TINTA = '#1b1410'

function cargar(dataUrl) {
  return new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = dataUrl })
}
function lienzo(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c }
function hex(h) { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255] }
function mezcla(a, b, t) { const A = hex(a), B = hex(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('') }

// Recorte: el fondo es crema liso. Se llena desde los bordes lo que se parece al fondo (flood fill), así los blancos de adentro del dibujo no se tocan;
// en el contorno el alfa es suave y se le saca el crema a los colores (para que no quede halo).
// Con cortar = false devuelve el lienzo entero (sin achicarlo al contenido): así varios dibujos con el mismo encuadre siguen alineados.
// Con huecos = false no vacía los huecos cerrados (en las orejas, los brillos blancos grandes se confundían con el fondo).
function recortar(img, cortar = true, huecos = true) {
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height
  const c = lienzo(W, H), g = c.getContext('2d', { willReadFrequently: true })
  g.drawImage(img, 0, 0)
  const im = g.getImageData(0, 0, W, H), p = im.data
  // color de fondo: promedio de cuatro parches de las esquinas
  let br = 0, bg = 0, bb = 0, n = 0
  for (const [x0, y0] of [[0, 0], [W - 40, 0], [0, H - 40], [W - 40, H - 40]]) for (let y = y0; y < y0 + 40; y++) for (let x = x0; x < x0 + 40; x++) { const k = (y * W + x) * 4; br += p[k]; bg += p[k + 1]; bb += p[k + 2]; n++ }
  br /= n; bg /= n; bb /= n
  const dist = new Float32Array(W * H)
  for (let i = 0; i < W * H; i++) { const dr = p[i * 4] - br, dg = p[i * 4 + 1] - bg, db = p[i * 4 + 2] - bb; dist[i] = Math.sqrt(dr * dr + dg * dg + db * db) }
  const T_LLENA = 40
  const fuera = new Uint8Array(W * H), pila = []
  const meter = (i) => { if (!fuera[i] && dist[i] < T_LLENA) { fuera[i] = 1; pila.push(i) } }
  for (let x = 0; x < W; x++) { meter(x); meter((H - 1) * W + x) }
  for (let y = 0; y < H; y++) { meter(y * W); meter(y * W + W - 1) }
  while (pila.length) {
    const i = pila.pop(), x = i % W, y = (i / W) | 0
    if (x > 0) meter(i - 1)
    if (x < W - 1) meter(i + 1)
    if (y > 0) meter(i - W)
    if (y < H - 1) meter(i + W)
  }
  // huecos cerrados que son puro fondo (ej. el ojal entre dos hilos de cera): también se vacían
  const visto = new Uint8Array(W * H)
  for (let s = 0; huecos && s < W * H; s++) {
    if (fuera[s] || visto[s] || dist[s] >= 22) continue
    const comp = [s]; visto[s] = 1
    for (let q = 0; q < comp.length; q++) {
      const i = comp[q], x = i % W, y = (i / W) | 0
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
        if (j < 0 || visto[j] || fuera[j]) continue
        if (dist[j] < 22) { visto[j] = 1; comp.push(j) }
      }
    }
    if (comp.length > 2500) for (const i of comp) fuera[i] = 1
  }
  // anillo de 3 px alrededor del fondo: ahí el alfa es suave
  const anillo = new Uint8Array(W * H)
  for (let pasada = 0; pasada < 3; pasada++) {
    const sig = new Uint8Array(anillo)
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x
      if (fuera[i]) continue
      if (fuera[i - 1] || fuera[i + 1] || fuera[i - W] || fuera[i + W] || anillo[i - 1] || anillo[i + 1] || anillo[i - W] || anillo[i + W]) sig[i] = 1
    }
    anillo.set(sig)
  }
  const T0 = 14, T1 = 70
  for (let i = 0; i < W * H; i++) {
    if (!fuera[i] && !anillo[i]) { p[i * 4 + 3] = 255; continue }
    const t = Math.min(1, Math.max(0, (dist[i] - T0) / (T1 - T0)))
    const a = t * t * (3 - 2 * t)
    if (a <= 0.004) { p[i * 4 + 3] = 0; continue }
    p[i * 4] = Math.max(0, Math.min(255, (p[i * 4] - (1 - a) * br) / a))
    p[i * 4 + 1] = Math.max(0, Math.min(255, (p[i * 4 + 1] - (1 - a) * bg) / a))
    p[i * 4 + 2] = Math.max(0, Math.min(255, (p[i * 4 + 2] - (1 - a) * bb) / a))
    p[i * 4 + 3] = Math.round(a * 255)
  }
  g.putImageData(im, 0, 0)
  if (!cortar) return c
  // recorte al contenido
  let x0 = W, y0 = H, x1 = 0, y1 = 0
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (p[(y * W + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  const m = 6, cw = x1 - x0 + 1 + 2 * m, ch = y1 - y0 + 1 + 2 * m
  const out = lienzo(cw, ch)
  out.getContext('2d').drawImage(c, x0 - m, y0 - m, cw, ch, 0, 0, cw, ch)
  return out
}

// Achica de a mitades (más nítido que un solo salto)
function achicar(src, w, h) {
  let cur = src
  while (cur.width / 2 > w) { const t = lienzo(Math.ceil(cur.width / 2), Math.ceil(cur.height / 2)); const g = t.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(cur, 0, 0, t.width, t.height); cur = t }
  const t = lienzo(w, h); const g = t.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(cur, 0, 0, w, h); return t
}
function dibujarEn(g, arte, x, y, w, h, margen = 0) {
  const k = Math.min((w - 2 * margen) / arte.width, (h - 2 * margen) / arte.height)
  const dw = Math.max(1, Math.round(arte.width * k)), dh = Math.max(1, Math.round(arte.height * k))
  const ch = k < 1 ? achicar(arte, dw, dh) : arte
  g.drawImage(ch, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
}
function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r) }

// Ícono "calcomanía": el dibujo recortado ocupa casi todo el ícono (sin cuadrado) y lleva alrededor de su silueta un borde
// fino crema y, por fuera, una línea del color del programa, como una figurita troquelada. Se ve igual sobre fondo claro u oscuro.
// La silueta sin los detalles finos (pelitos, salpicaduras chicas): se difumina y se corta el borde, así el contorno sigue la
// forma general y no queda borroso alrededor de cada pelito.
function silueta(arte, color) {
  const c = lienzo(arte.width, arte.height), g = c.getContext('2d')
  const r = Math.max(1, arte.width / 90)
  g.filter = `blur(${r}px)`; g.drawImage(arte, 0, 0); g.filter = 'none'
  const d = g.getImageData(0, 0, c.width, c.height), px = d.data
  for (let i = 3; i < px.length; i += 4) px[i] = px[i] > 150 ? 255 : 0
  g.putImageData(d, 0, 0)
  g.globalCompositeOperation = 'source-in'; g.fillStyle = color; g.fillRect(0, 0, c.width, c.height); return c
}
function engordar(g, sil, x, y, w, h, rad) {
  if (rad <= 0) { g.drawImage(sil, x, y, w, h); return }
  const pasos = Math.max(12, Math.ceil(rad * 4))
  for (let i = 0; i < pasos; i++) { const t = (i / pasos) * Math.PI * 2; g.drawImage(sil, x + Math.cos(t) * rad, y + Math.sin(t) * rad, w, h) }
}
function iconoCalco(arte, color, s) {
  const c = lienzo(s, s), g = c.getContext('2d')
  const linea = s <= 16 ? 1 : s <= 32 ? 1.4 : s * 0.028, halo = s <= 24 ? 0 : s <= 48 ? s * 0.03 : s * 0.035
  const pad = linea + halo + (s <= 32 ? 0.3 : s * 0.01)
  const k = Math.min((s - 2 * pad) / arte.width, (s - 2 * pad) / arte.height)
  const w = Math.max(1, Math.round(arte.width * k)), h = Math.max(1, Math.round(arte.height * k)), x = (s - w) / 2, y = (s - h) / 2
  const chico = k < 1 ? achicar(arte, w, h) : arte
  engordar(g, silueta(chico, color), x, y, w, h, halo + linea)
  if (halo > 0) engordar(g, silueta(chico, CREMA), x, y, w, h, halo)
  g.drawImage(chico, x, y, w, h)
  return c
}

// Ícono chico: de fábrica, el dibujo recortado como calcomanía (iconoCalco). Con PAILA_ICONO=cuadrado, el estilo anterior:
// el dibujo sobre un cuadrado redondeado con borde del color del programa (sin cartel)
function icono(arte, color, s) {
  if (globalThis.ESTILO_ICONO !== 'cuadrado') return iconoCalco(arte, color, s)
  const c = lienzo(s, s), g = c.getContext('2d')
  const bw = s <= 16 ? 1.5 : s <= 32 ? Math.max(2, s * 0.07) : s * 0.075, r = s * (s <= 32 ? 0.26 : 0.24), a = 0.5
  const fondo = g.createLinearGradient(0, 0, 0, s); fondo.addColorStop(0, CREMA); fondo.addColorStop(1, mezcla(CREMA, color, 0.38))
  rr(g, a, a, s - 2 * a, s - 2 * a, r); g.fillStyle = fondo; g.fill()
  g.save(); rr(g, a, a, s - 2 * a, s - 2 * a, r); g.clip()
  dibujarEn(g, arte, bw, bw, s - 2 * bw, s - 2 * bw, s <= 32 ? s * 0.015 : s * 0.05)
  g.restore()
  rr(g, a + bw / 2, a + bw / 2, s - 2 * a - bw, s - 2 * a - bw, Math.max(1, r - bw / 2)); g.lineWidth = bw; g.strokeStyle = color; g.stroke()
  if (s >= 48) { rr(g, a + bw + 0.5, a + bw + 0.5, s - 2 * (a + bw + 0.5), s - 2 * (a + bw + 0.5), Math.max(1, r - bw)); g.lineWidth = Math.max(1, s * 0.012); g.strokeStyle = 'rgba(27,20,16,.55)'; g.stroke() }
  return c
}

// Figurita grande: borde grueso del color, marco con el dibujo y cartelito con el nombre
function figurita(arte, color, nombre, numero) {
  const W = 800, H = 1120, c = lienzo(W, H), g = c.getContext('2d')
  rr(g, 3, 3, W - 6, H - 6, 58); g.fillStyle = color; g.fill()
  const luz = g.createLinearGradient(0, 0, 0, H); luz.addColorStop(0, 'rgba(255,255,255,.28)'); luz.addColorStop(0.5, 'rgba(255,255,255,0)'); luz.addColorStop(1, 'rgba(0,0,0,.14)')
  rr(g, 3, 3, W - 6, H - 6, 58); g.fillStyle = luz; g.fill()
  rr(g, 3, 3, W - 6, H - 6, 58); g.lineWidth = 6; g.strokeStyle = TINTA; g.stroke()
  // marco del dibujo
  const fx = 48, fy = 48, fw = W - 96, fh = 850
  const fondo = g.createLinearGradient(0, fy, 0, fy + fh); fondo.addColorStop(0, CREMA); fondo.addColorStop(0.55, CREMA); fondo.addColorStop(1, mezcla(CREMA, color, 0.55))
  rr(g, fx, fy, fw, fh, 26); g.fillStyle = fondo; g.fill()
  g.save(); rr(g, fx, fy, fw, fh, 26); g.clip(); dibujarEn(g, arte, fx, fy, fw, fh, 36); g.restore()
  rr(g, fx, fy, fw, fh, 26); g.lineWidth = 7; g.strokeStyle = TINTA; g.stroke()
  // cartelito
  const px = 70, py = 922, pw = W - 140, ph = 150
  rr(g, px, py + 8, pw, ph, 30); g.fillStyle = TINTA; g.fill() // sombra dura
  rr(g, px, py, pw, ph, 30); g.fillStyle = CREMA; g.fill(); g.lineWidth = 7; g.strokeStyle = TINTA; g.stroke()
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round'
  g.font = '124px Impact, "Arial Black", sans-serif'
  g.lineWidth = 20; g.strokeStyle = TINTA; g.strokeText(nombre, W / 2, py + ph / 2 + 8)
  g.fillStyle = mezcla(color, '#ffffff', 0.12); g.fillText(nombre, W / 2, py + ph / 2 + 8)
  g.font = '30px Impact, "Arial Black", sans-serif'; g.textAlign = 'left'; g.fillStyle = TINTA
  g.fillText(numero, px + 26, py + 28)
  return c
}

// Medidas que van dentro del .ico: Windows elige la justa según la escala de la pantalla (20 y 30 px son las de 125 %, 40 la de 250 %...)
const ICO = [16, 20, 24, 30, 32, 40, 48, 64, 128, 256]
const aB64 = (c) => c.toDataURL('image/png').split(',')[1]

// Lámina de prueba: íconos en todos los tamaños sobre fondo claro y oscuro, ampliados, y las figuritas
function lamina(items) {
  const S = [16, 24, 32, 48, 64, 128, 256], W = 1500, H = 1330, c = lienzo(W, H), g = c.getContext('2d')
  g.fillStyle = '#eceef2'; g.fillRect(0, 0, W / 2, 700); g.fillStyle = '#14171b'; g.fillRect(W / 2, 0, W / 2, 700)
  g.fillStyle = '#d8dbe1'; g.fillRect(0, 700, W, H - 700)
  g.textBaseline = 'alphabetic'; g.textAlign = 'left'
  g.font = '600 20px "Segoe UI", sans-serif'
  g.fillStyle = '#333'; g.fillText('Fondo claro', 24, 34); g.fillStyle = '#ccc'; g.fillText('Fondo oscuro (cabina)', W / 2 + 24, 34)
  items.forEach((it, row) => {
    for (const half of [0, 1]) {
      let x = half * W / 2 + 24; const y = 80 + row * 310
      g.font = '600 16px "Segoe UI", sans-serif'; g.fillStyle = half ? '#ccc' : '#333'; g.fillText(it.nombre, x, y - 12)
      for (const s of S) {
        g.drawImage(it.iconos[s], x, y, s, s)
        g.font = '12px "Segoe UI", sans-serif'; g.fillStyle = half ? '#999' : '#666'; g.fillText(String(s), x, y + 276)
        x += s + 10
        if (s === 48) x = x
      }
    }
  })
  g.font = '600 16px "Segoe UI", sans-serif'; g.fillStyle = '#333'
  g.fillText('Ampliados sin suavizar: 16 px (×8) y 32 px (×4)', 24, 740)
  g.imageSmoothingEnabled = false
  items.forEach((it, i) => { const x = 24 + i * 300; g.drawImage(it.iconos[16], x, 760, 128, 128); g.drawImage(it.iconos[32], x + 148, 760, 128, 128) })
  g.imageSmoothingEnabled = true
  items.forEach((it, i) => { g.drawImage(it.figurita, 640 + i * 400, 730, 380, 380 * 1120 / 800) })
  return c
}

async function generar(cfg) {
  const items = [], res = {}
  for (const p of cfg.programas) {
    const img = await cargar(p.dataUrl)
    const recorte = recortar(img)
    const ic = {}
    for (const s of [...ICO, 512]) ic[s] = icono(recorte, p.color, s)
    const fig = figurita(recorte, p.color, p.nombre, p.numero)
    items.push({ nombre: p.nombre, iconos: ic, figurita: fig })
    res[p.id] = {
      recorte: aB64(recorte), figurita: aB64(fig), icon512: aB64(ic[512]), logo: aB64(ic[256]),
      ico: ICO.map((s) => ({ s, b64: aB64(ic[s]) })),
    }
  }
  res.lamina = aB64(lamina(items))
  return res
}
