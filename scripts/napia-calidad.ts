// Prueba de punta a punta de la calidad real en NAPIA: abre la NAPIA compilada con una carpeta de datos propia, le da una lista
// chica, la baja, espera a que termine (revisión y otras fuentes incluidas), saca capturas de la bajada y del historial, dice
// qué pasó con cada tema y borra todo lo bajado (con --dejar, lo deja).
//   node scripts/run-ts.mjs scripts/napia-calidad.ts --falso         sin Soulseek: el sockseek de mentira "baja" archivos del
//                                                                     laboratorio (MP3 inflados, FLAC falsos y buenos)
//   node scripts/run-ts.mjs scripts/napia-calidad.ts <lista.txt>     de verdad, con sockseek y tu cuenta de Soulseek
// Siempre baja a D:\PAILA-trabajo\napia-calidad-… (o a PAILA_TRABAJO): nunca a la Música ni a la carpeta de Soulseek.
// Las capturas van a docs/pruebas/napia-calidad-<día>/ (--capturas <prefijo>; --calidad buena|sinperdida|cualquiera; --cortar <s>:
// aprieta «Cortar» a los tantos segundos; --reemplazo: con --falso, la lista llega como desde la lista «Faltan o suenan mal» de PAILA, con
// la nota de tu copia de dos temas: uno consigue una mejor y el otro no; --lentas: con --falso, baja 4 a la vez y suma fuentes
// lentísimas: «Roxanne» va lenta y otro usuario la tiene bien; «Yo Ya Sé» llega trucho y su 2.ª fuente va lenta; --uso-real: con
// --falso, lo del 24/10: «Salgo Pa' la Calle» llega primero como la acapella, los archivos se llaman como en Soulseek (llegan con
// el nombre de la lista) y uno con «feat.» no se encuentra (para «Buscar de otra forma» dentro de la lista); --tramos: con --falso, la
// lista de a 2 temas (lo trucho se reemplaza antes del tramo siguiente) y una fuente trucha y lentísima que corta la muestra.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { abrirApp } from './conducir'
import { napiaCsv } from '@paila/core/listexport'
import type { CopiaTuya, EntradaHistorial, RunStatus } from '@paila/shared/napia'

const args = process.argv.slice(2)
const opt = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : null)
const falso = args.includes('--falso')
const lista = args.find((a) => !a.startsWith('--') && a !== opt('--capturas') && a !== opt('--calidad') && a !== opt('--cortar'))
const capturas = opt('--capturas') ?? (falso ? 'falso' : 'real')
const calidad = opt('--calidad') ?? 'buena'
const cortar = Number(opt('--cortar')) || 0
/** Donde van las capturas: docs/pruebas/napia-calidad-<día>/. */
const CARPETA = path.join('docs', 'pruebas', `napia-calidad-${new Date().toISOString().slice(0, 10)}`)
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** Que se vea el paso 3 (las cifras y los temas), no el principio de la pantalla. */
const alPaso3 = "document.querySelector('.cifras')?.scrollIntoView({ block: 'start' }); 0"

const raiz = process.env.PAILA_TRABAJO ?? 'D:\\PAILA-trabajo'
const base = path.join(raiz, `napia-calidad-${Date.now().toString(36)}`)
const prohibidas = ['D:\\Música', 'D:\\Soulseek'].map((p) => p.toLowerCase())
if (prohibidas.some((p) => base.toLowerCase().startsWith(p))) throw new Error(`No se baja a ${base}`)
const datos = path.join(base, 'datos'), destino = path.join(base, 'NAPIA')
fs.mkdirSync(datos, { recursive: true })
fs.writeFileSync(path.join(datos, 'napia.json'), JSON.stringify({ destino, options: { calidad, sacarRemaster: true, primeros: null, saltearTenes: false } }))

// sin Soulseek: cada tema lo "comparten" uno o más usuarios, cada uno con un archivo del laboratorio
const LAB = process.env.PAILA_CORPUS || 'C:\\PAILA-laboratorio'
const L = (f: string) => path.join(LAB, f)
const FUENTES: Record<string, ([string, string] | [string, string, 'lenta' | `como:${string}`])[]> = {
  'Yo Ya Sé': [['ana', L('NO_VOCALS_130BPM_CMajor_DEM4_charly_garc_a___yo_ya_s___official_visualizer_.mp3')], ['beto', L('DISCO CUMPLE/Variete/VARIETE/The Police - Roxanne.flac')]],
  'Big In Japan': [['carlos', L('DISCO CUMPLE/DISCOROCK/DISCOROCK 2/11. Alphaville - Big In Japan.flac')]],
  'Hold the Line': [['dani', L('Musica para acomodar/09 - Hold the Line.flac')]],
  Ella: [['eli', L('FIESTA AMIGOS vol2/FIESTA AMIGOS 2024/Tan Bionica - Ella.wav')], ['fede', L('FIESTA AMIGOS vol2/FIESTA AMIGOS 2024/Tan Bionica - Ella.wav')], ['gabi', L('FIESTA AMIGOS vol2/FIESTA AMIGOS 2024/Tan Bionica - Ella.wav')], ['hugo', L('FIESTA AMIGOS vol2/FIESTA AMIGOS 2024/Tan Bionica - Ella.wav')]],
  'Ojos de video tape': [['ivan', L('Clics modernos/09. Ojos de video tape.flac')]],
}
const ARTISTAS: Record<string, string> = { 'Yo Ya Sé': 'Charly García', 'Big In Japan': 'Alphaville', 'Hold the Line': 'Toto', Ella: 'Tan Biónica', 'Ojos de video tape': 'Soda Stereo', Roxanne: 'The Police', "Salgo Pa' la Calle": 'Daddy Yankee', 'Wadu Wadu (feat. Nadie)': 'Virus' }
if (args.includes('--uso-real')) {
  const bueno = L('Musica para acomodar/09 - Hold the Line.flac')
  FUENTES["Salgo Pa' la Calle"] = [['ana', bueno, 'como:daddy_yankee-salgo_pa_la_calle-(acapella).flac'], ['beto', bueno, 'como:01-daddy yankee-salgo pa la calle-xyz.flac']]
  FUENTES['Wadu Wadu (feat. Nadie)'] = [['caro', bueno, 'como:virus_wadu.flac']]
  FUENTES['Hold the Line'] = [['dani', bueno, 'como:toto - hold the line (www.descargas.com).flac']]
}
if (args.includes('--lentas')) {
  const roxanne = L('DISCO CUMPLE/Variete/VARIETE/The Police - Roxanne.flac')
  FUENTES.Roxanne = [['tortuga', roxanne, 'lenta'], ['liebre', roxanne]]
  FUENTES['Yo Ya Sé'].splice(1, 0, ['caracol', roxanne, 'lenta'])
}
// --tramos: la lista de a 2 temas y 2 a la vez; «Yo Ya Sé» llega de ana trucho y lentísimo: lo corta la muestra, no la lentitud
if (args.includes('--tramos')) FUENTES['Yo Ya Sé'][0] = [FUENTES['Yo Ya Sé'][0][0], FUENTES['Yo Ya Sé'][0][1], 'lenta']
// --reemplazo: «Yo Ya Sé» lo tenés en D (el inflado no sirve; el FLAC de beto sí es mejor) y «Hold the Line» en A (el FLAC de CD, B, no es mejor)
const TUYAS: Record<string, CopiaTuya> = { 'Yo Ya Sé': { nota: 'D', kbps: 128, que: 'MP3 128 kbps · nota D' }, 'Hold the Line': { nota: 'A', kbps: 1411, que: 'FLAC · nota A' } }
const texto = !falso ? fs.readFileSync(lista ?? '', 'utf8')
  : args.includes('--reemplazo') ? napiaCsv(Object.keys(FUENTES).map((t) => ({ artist: ARTISTAS[t], title: t, tuya: TUYAS[t] ?? null })))
    : Object.keys(FUENTES).map((t) => `${ARTISTAS[t]} - ${t}`).join('\n')
if (!texto.trim()) throw new Error('Falta la lista: node scripts/run-ts.mjs scripts/napia-calidad.ts <lista.txt> (o --falso)')
if (falso) Object.assign(process.env, { NAPIA_SOCKSEEK_FALSO: path.resolve('tests/fixtures/sockseek-falso.mjs'), FALSO_FUENTES: JSON.stringify(FUENTES), FALSO_PAUSA: '800' })
// --uso-real: lo que tiene «feat.» no lo tiene nadie (como en Soulseek); sin el feat., sí
if (falso && args.includes('--uso-real')) process.env.FALSO_NO_ENCUENTRA = 'feat'
// las fuentes lentas: 4 a la vez (como sockseek) y los tiempos del corte en una vigésima parte (3 s en vez de un minuto)
if (falso && args.includes('--lentas')) Object.assign(process.env, { FALSO_JOBS: '4', NAPIA_LENTO_ESCALA: '0.05' })
if (falso && args.includes('--tramos')) Object.assign(process.env, { FALSO_JOBS: '2', NAPIA_TRAMO: '2' })

// el registro de la app, fuera de la carpeta de la prueba (queda abierto hasta que termina el guion y no se podría borrar)
const registro = path.join(os.tmpdir(), `${path.basename(base)}.log`)
const app = await abrirApp(datos, { napia: true, tamano: '1200x1100', log: registro })
const t0 = Date.now()
try {
  await app.js(`(async () => { const l = await window.napia.parseText(${JSON.stringify(texto)}, 'Prueba calidad'); await window.napia.sumarATanda(l); await window.napia.start(); return 1 })()`)
  let s: RunStatus | null = null, vistaCaptura = false
  for (;;) {
    await espera(3000)
    s = await app.js<RunStatus>('window.napia.status()')
    const q = s.calidad
    console.log(`${Math.round((Date.now() - t0) / 1000)} s · ${s.counts.bajado} bajados · revisando ${q?.revisando ?? 0} · truchos ${q?.descartados ?? 0} · reemplazados ${q?.reemplazados ?? 0}${q?.buscandoOtra ? ' · buscando otra fuente' : ''}`)
    if (!vistaCaptura && (q?.buscandoOtra || (q?.descartados ?? 0) > 0)) { vistaCaptura = true; await app.js(alPaso3); await app.captura(path.join(CARPETA, `${capturas}-durante.png`)) }
    if (s.finished && !s.running) break
    if (Date.now() - t0 > 40 * 60_000) { console.log('Más de 40 minutos: se corta.'); await app.js('window.napia.cancel()'); }
    // --cortar: como «Cortar» a los N segundos; la respuesta tiene que llegar con la lista ya cerrada (revisión e historial incluidos)
    if (cortar && !s.finished && Date.now() - t0 > cortar * 1000) {
      const r = await app.js<RunStatus>('window.napia.cancel()')
      console.log(`Cortado: contestó con la lista ${r.finished ? 'cerrada' : 'TODAVÍA ABIERTA'} (${r.tracks.filter((t) => t.calidad?.estado === 'revisando').length} revisando)`)
    }
  }
  await espera(1500)
  await app.js(alPaso3)
  await app.captura(path.join(CARPETA, `${capturas}-bajada.png`))
  // --uso-real: también las opciones (la casilla de los nombres y la de saltear, con su texto nuevo)
  if (args.includes('--uso-real')) { await app.js("document.querySelector('.calidades')?.scrollIntoView({ block: 'center' }); 0"); await espera(500); await app.captura(path.join(CARPETA, `${capturas}-opciones.png`)) }
  await app.clic('Historial').catch(() => app.clic('History'))
  await espera(800)
  await app.js(`[...document.querySelectorAll('button.link')].find((b) => /Ver cuáles|See which/.test(b.textContent))?.click(); 0`)
  await espera(500)
  await app.captura(path.join(CARPETA, `${capturas}-historial.png`))
  // qué pasó con cada tema
  for (const t of s.tracks) {
    const c = t.calidad
    console.log(`- ${t.artist} - ${t.title}: ${t.state}${t.fuente ? ` (de ${t.fuente})` : ''}${c ? ` · ${c.estado} · nota ${c.nota ?? '?'} · ${c.es ?? ''}${c.motivo ? ` · ${c.motivo}` : ''} · ${c.descartadas} descartadas, ${c.lentas ?? 0} lentas, ${c.intentos} vueltas` : ''}${t.detail ? ` · ${t.detail}` : ''}`)
  }
  const h = JSON.parse(fs.readFileSync(path.join(datos, 'historial.json'), 'utf8')) as EntradaHistorial[]
  console.log('Historial:', JSON.stringify({ ...h[0], faltan: h[0].faltan.length, llegaron: h[0].llegaron.length }))
  const carpeta = s.folder!
  const ver = (d: string) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => fs.statSync(path.join(d, f)).isFile()) : [])
  console.log('En la carpeta de la lista:', ver(carpeta))
  console.log('En descartados:', ver(path.join(carpeta, 'descartados')))
  console.log('Quedó en la carpeta de trabajo:', fs.readdirSync(path.join(datos, 'trabajo'), { recursive: true }).filter((f) => /\.(mp3|flac|wav|aiff?|m4a|ogg|opus|incomplete)$/i.test(String(f))))
  console.log('Registro (lo de NAPIA):', s.log.filter((l) => l.startsWith('[napia]')))
} finally {
  await app.cerrar().catch(() => app.matar())
  await Promise.race([app.terminado, espera(20_000)])
  // Windows suelta la carpeta un rato después de que se cierran los procesos que trabajaron ahí
  for (let i = 0; !args.includes('--dejar') && fs.existsSync(base); i++) {
    try { fs.rmSync(base, { recursive: true, force: true }) } catch (e) { if (i >= 60) throw e; await espera(1000) }
  }
  console.log(args.includes('--dejar') ? `Quedó en ${base}` : `Borrado ${base}`, `(registro de la app: ${registro})`)
}
