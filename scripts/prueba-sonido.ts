// Medición de la Etapa 5 del MASTERPLAN-5 (Sonido, una sola historia), de punta a punta y sin Soulseek: arma una carpeta de prueba con
// música inventada (4 MP3 de 96 kbps y una lista con 2 temas que faltan), abre PAILA COMPILADA en modo prueba (registro de pantallas y
// tareas) y, como una persona, desde la pestaña Sonido: manda a NAPIA lo que suena mal y la deja bajando (NAPIA con el sockseek de
// mentira: tests/fixtures/sockseek-falso.mjs; un tema llega trucho primero), espera que llegue, que la Bandeja lo reconozca y lo proponga,
// aplica, manda lo que falta, lo pasa a la Música, hace la tarea 9 (volumen parejo) y deshace. Cuenta las idas y vueltas entre PAILA y
// NAPIA (las veces que NAPIA tuvo que venir adelante: meta 0) y saca fotos. Solo toca la carpeta de la prueba (se borra al final).
//
//   node scripts/run-ts.mjs scripts/prueba-sonido.ts [--carpeta <dónde>] [--fotos docs/pruebas/mp5-etapa5-sonido] [--dejar]
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { abrirApp } from './conducir'
import { leerRegistro } from '@paila/core/prueba'

const arg = (k: string, d = '') => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const carpeta = path.resolve(arg('--carpeta', path.join(process.env.PAILA_TRABAJO ?? os.tmpdir(), `prueba-sonido-${Date.now().toString(36)}`)))
const fotos = arg('--fotos', 'docs/pruebas/mp5-etapa5-sonido')
if (/^f:[\\/]música/i.test(carpeta)) throw new Error('La prueba nunca va en D:\\Música')
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))
const ok = (cond: unknown, que: string) => { console.log(`${cond ? 'BIEN' : 'MAL '}  ${que}`); if (!cond) process.exitCode = 1 }
const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const ff = (...a: string[]) => execFileSync(ffmpeg, ['-v', 'error', '-y', ...a])

// ---------- la carpeta de la prueba ----------
const EXPR = [
  '0.3*sin(2*PI*(220+110*gte(mod(t,4),2))*t)+0.2*sin(2*PI*330*t)*lt(mod(t,3),1.5)+0.1*sin(2*PI*523*t)*gte(mod(t,5),2.5)',
  '0.3*sin(2*PI*(294+98*gte(mod(t,3),1))*t)+0.2*sin(2*PI*370*t)*lt(mod(t,2),1)+0.1*sin(2*PI*440*t)*gte(mod(t,7),3)',
  '0.3*sin(2*PI*(196+65*gte(mod(t,5),2))*t)+0.2*sin(2*PI*247*t)*lt(mod(t,2.5),1)+0.15*sin(2*PI*392*t)*gte(mod(t,3),1.5)',
  '0.3*sin(2*PI*(262+131*gte(mod(t,6),3))*t)+0.25*sin(2*PI*311*t)*lt(mod(t,4),2)',
  '0.3*sin(2*PI*(349+87*gte(mod(t,2),1))*t)+0.2*sin(2*PI*466*t)*lt(mod(t,5),2.5)+0.1*sin(2*PI*277*t)*gte(mod(t,3),2)',
  '0.3*sin(2*PI*(185+92*gte(mod(t,3.5),1.5))*t)+0.2*sin(2*PI*415*t)*lt(mod(t,6),2)+0.1*sin(2*PI*622*t)*gte(mod(t,4),1)',
]
const TEMAS = ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis'].map((t, i) => ({ artist: `Los ${t}`, title: t, expr: EXPR[i] }))
const lab = path.join(carpeta, 'soulseek-de-mentira'), musica = path.join(carpeta, 'Música')
for (const d of [lab, musica, path.join(carpeta, 'napia-datos'), path.join(carpeta, 'sockseek-config', 'sockseek')]) fs.mkdirSync(d, { recursive: true })
console.log(`Armando la prueba en ${carpeta}…`)
const master = (i: number) => {
  const out = path.join(lab, `${TEMAS[i].artist} - ${TEMAS[i].title}.flac`)
  ff('-f', 'lavfi', '-i', `aevalsrc='${TEMAS[i].expr}':s=44100:d=30`, '-f', 'lavfi', '-i', 'anoisesrc=d=30:c=pink:a=0.08:s=7:r=44100', '-filter_complex', 'amix=inputs=2:normalize=0', '-ac', '2', '-sample_fmt', 's16', out)
  return out
}
const flacs = TEMAS.map((_, i) => master(i))
// tu música: los cuatro primeros en MP3 de 96 (suenan mal); el quinto y el sexto no los tenés (están en una lista)
for (const i of [0, 1, 2, 3]) ff('-i', flacs[i], '-map_metadata', '-1', '-b:a', '96k', '-metadata', `artist=${TEMAS[i].artist}`, '-metadata', `title=${TEMAS[i].title}`, path.join(musica, `${TEMAS[i].artist} - ${TEMAS[i].title}.mp3`))
// «Tres» lo comparte primero alguien con un FLAC hecho del MP3 (trucho) y después alguien con el bueno; «Cuatro» no lo tiene nadie
const trucho = path.join(lab, 'Los Tres - Tres (trucho).flac')
ff('-i', path.join(musica, 'Los Tres - Tres.mp3'), trucho)
const FUENTES = { Uno: [['ana', flacs[0]]], Dos: [['beto', flacs[1]]], Tres: [['caro', trucho], ['dani', flacs[2]]], Cinco: [['eli', flacs[4]]], Seis: [['fede', flacs[5]]] }
const lista = path.join(carpeta, 'Para el viaje.csv')
fs.writeFileSync(lista, 'Artist,Title\r\nLos Uno,Uno\r\nLos Cinco,Cinco\r\nLos Seis,Seis\r\n')
// NAPIA ya configurada (la carpeta confirmada y una cuenta de mentira: nunca la de esta PC)
fs.writeFileSync(path.join(carpeta, 'napia-datos', 'napia.json'), JSON.stringify({ destino: path.join(carpeta, 'Descargas NAPIA'), options: { calidad: 'buena', sacarRemaster: true, primeros: null, saltearTenes: false } }))
fs.writeFileSync(path.join(carpeta, 'sockseek-config', 'sockseek', 'sockseek.conf'), 'username = prueba\npassword = prueba\n')
Object.assign(process.env, {
  PAILA_PRUEBA: carpeta, APPDATA: path.join(carpeta, 'sockseek-config'), NAPIA_OCULTA: '1',
  NAPIA_SOCKSEEK_FALSO: path.resolve('tests/fixtures/sockseek-falso.mjs'), FALSO_FUENTES: JSON.stringify(FUENTES), FALSO_PAUSA: '900', FALSO_NO_ENCUENTRA: 'Cuatro',
})

// ---------- como una persona ----------
const app = await abrirApp(path.join(carpeta, 'datos'), { log: path.join(os.tmpdir(), `${path.basename(carpeta)}.log`), tamano: '1400x1000' })
const t0 = Date.now()
const seg = () => Math.round((Date.now() - t0) / 1000)
const foto = async (nombre: string) => { await app.js("document.head.insertAdjacentHTML('beforeend','<style>*{animation:none!important;transition:none!important}</style>'); 0"); await espera(400); await app.captura(path.join(fotos, nombre)) }
const resumen = () => app.js<{ suenanMal: { n: number }; faltan: { n: number }; llegaron: { enLista: number; nuevos: number; mejores: unknown[]; revisando: number } }>('window.paila.sonidoResumen()')
const napia = () => app.js<{ corriendo: boolean; bajados: number; truchos: number; falta: string | null; fin: { lista: string } | null; ultimos: { estado: string; frase: string }[] } | null>('window.paila.napiaEstado()')
const hasta = async (que: string, cond: () => Promise<boolean>, max = 300) => { for (let i = 0; i < max; i++) { if (await cond().catch(() => false)) return true; await espera(1000) } ok(false, `se esperó ${max} s: ${que}`); return false }
const enMarcha = () => app.js<boolean>('window.paila.jobs().then((js) => js.some((j) => j.running) || !!window.__escucha?.running)')
let faltaVista = false
const vigilar = setInterval(() => { void napia().then((e) => { if (e?.falta) faltaVista = true }).catch(() => {}) }, 2000)
try {
  await app.esperarTexto(/Inicio/, 60_000)
  await app.js('window.paila.onScanStatus((s) => { window.__escucha = s }); 0')
  await hasta('PAILA escuchó los 4 temas y dice que suenan mal', async () => (await resumen()).suenanMal.n >= 4, 400)
  // a Sonido desde las pestañas, como una persona
  await app.js(`document.querySelector('.pestana[data-seccion=sonido]').click()`); await espera(600)
  await app.js(`document.querySelector('[data-page=sonido]').click()`); await espera(1500)
  ok(/Suenan mal/i.test(await app.texto()), `Sonido abre con lo que suena mal (${seg()} s)`)
  await foto('02-sonido-prueba.png')
  // 1. suena mal → buscar mejor: un botón, y NAPIA baja sola
  await app.clic('Buscar mejores con NAPIA')
  await hasta('NAPIA empezó a bajar (se ve arriba, en PAILA)', async () => !!(await napia())?.corriendo, 90)
  await espera(2500)
  await foto('03-napia-bajando.png')
  await hasta('NAPIA terminó la lista', async () => { const e = await napia(); return !!e && !e.corriendo && !!e.fin }, 300)
  await espera(3500) // el enlace de NAPIA se escribe cada 2 s y PAILA lo mira cada 3
  const e1 = await napia()
  console.log('      NAPIA dijo:', JSON.stringify({ truchos: e1?.truchos, bajados: e1?.bajados, ultimos: e1?.ultimos }))
  const deTrucho = e1?.ultimos.find((u) => u.estado === 'trucho' || /trucha/.test(u.frase))
  ok((e1?.truchos ?? 0) >= 1 && deTrucho, `lo trucho se ve en PAILA (${e1?.truchos} trucho): «${deTrucho?.frase ?? '—'}»`)
  ok(e1?.ultimos.some((u) => u.estado === 'noEsta'), 'lo que no está en Soulseek también')
  // 2. llegó → la Bandeja lo reconoce y lo verifica → queda propuesto
  await hasta('las 3 copias mejores quedaron propuestas', async () => (await resumen()).llegaron.enLista >= 3, 300)
  await foto('04-llegaron.png')
  const barra = await app.js<string>(`document.querySelector('.changes-bar')?.innerText ?? ''`)
  const enBarra = await app.js<number>("window.paila.pendingChanges().then((l) => l.filter((c) => c.field === 'reemplazo').length)")
  ok(enBarra === 3, `las 3 están en la barra de arriba, con todo lo demás: «${barra.split('\n')[0]}»`)
  // 3. aplicar (un botón y el «Sí, aplicar» de siempre)
  await app.clic('Aplicar 3 copias mejores'); await espera(400); await app.clic('Sí, aplicar')
  await espera(1500); await hasta('Aplicar terminó', async () => !(await enMarcha()), 120)
  const flac = fs.readdirSync(musica).filter((f) => f.endsWith('.flac'))
  ok(flac.length === 3, `en tu Música quedaron ${flac.length} FLAC en lugar de los MP3 (${flac.join(', ')})`)
  await foto('05-aplicado.png')
  // 4. lo que falta: la lista trae 2 que no tenés → NAPIA → llegan → a tu Música
  await app.js(`(async () => { const p = await window.paila.previewRequestFile(${JSON.stringify(lista)}); await window.paila.createRequest({ name: 'Para el viaje', source: p.source ?? 'csv', items: p.items }) })()`)
  await app.js(`document.querySelector('[data-page=wishlist]').click()`); await espera(800)
  await app.js(`document.querySelector('[data-page=sonido]').click()`); await espera(2000)
  ok((await resumen()).faltan.n >= 2, 'Sonido dice que te faltan los 2 de la lista')
  await app.clic('Buscar con NAPIA')
  await hasta('llegaron los 2 que faltaban', async () => (await resumen()).llegaron.nuevos >= 2, 300)
  const plan = await app.js<{ items: { path: string }[] }>('window.paila.inboxAddPlan()')
  const pasaron = await app.js<{ added: number }>(`window.paila.inboxAddApply(${JSON.stringify(plan)}, ${JSON.stringify(plan.items.map((i) => i.path))})`)
  ok(pasaron.added === 2, `los ${pasaron.added} que faltaban pasaron a tu Música`)
  // 5. la tarea 9: volumen parejo, desde los arreglos de sonido de la misma pestaña
  await hasta('PAILA terminó de escuchar lo nuevo', async () => !(await enMarcha()), 300)
  await app.clic('Volumen parejo'); await espera(1500)
  await app.js('void window.paila.gainPlan().catch(() => {})'); await espera(1500); await hasta('midió el volumen', async () => !(await enMarcha()), 300)
  const parejo = await app.js<number>(`(async () => { const k = await window.paila.gainStage(false); if (k) await window.paila.applyChanges(); return k })()`)
  await hasta('Aplicar del volumen terminó', async () => !(await enMarcha()), 120)
  ok(parejo >= 5, `tarea 9: volumen parejo en ${parejo} temas (${seg()} s desde que abrió)`)
  // el registro de la prueba la anota sola cuando la ve cumplida en la base (core/prueba.ts, VigiaTareas)
  const anotada = () => { const r = fs.readdirSync(path.join(carpeta, 'registros')).sort().at(-1); return !!r && leerRegistro(path.join(carpeta, 'registros', r)).some((l) => l.tipo === 'tarea' && (l as { tarea: string }).tarea === 'volumen') }
  ok(await hasta('la tarea 9 quedó anotada en el registro', async () => anotada(), 90), 'la tarea 9 quedó anotada en el registro de la prueba')
  // 6. y se deshace como todo: el Aplicar de las copias mejores, desde el Historial
  const h = await app.js<{ kind: string; id: number; summary: string }[]>('window.paila.history()')
  const ap = h.find((x) => x.kind === 'aplicar' && /copia/.test(x.summary))
  if (ap) await app.js(`window.paila.historyUndoCadena('aplicar', ${ap.id})`)
  await hasta('deshacer terminó', async () => !(await enMarcha()), 120)
  ok(fs.readdirSync(musica).filter((f) => /^Los (Uno|Dos|Tres) - .*\.mp3$/.test(f)).length === 3, `deshacer «${ap?.summary ?? '—'}» devuelve los 3 MP3 de antes`)
} catch (e) { ok(false, `la prueba se cortó: ${(e as Error).message}`); console.log(app.consola.slice(-10).join('\n')) }
clearInterval(vigilar)
try { await app.cerrar() } catch { app.matar() }
// NAPIA sigue abierta sola (es otro programa, y estaba oculta): se cierra por su número de proceso, solo la de esta prueba
try {
  const pids = execFileSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*${path.basename(carpeta)}*' } | ForEach-Object { $_.ProcessId }`], { encoding: 'utf8' }).split(/\s+/).filter((p) => /^\d+$/.test(p))
  for (const p of pids) { try { execFileSync('taskkill', ['/PID', p, '/T', '/F'], { stdio: 'ignore' }) } catch { /* ya terminó */ } }
} catch { /* sin PowerShell: queda NAPIA abierta */ }

// ---------- las cuentas ----------
const regs = fs.existsSync(path.join(carpeta, 'registros')) ? fs.readdirSync(path.join(carpeta, 'registros')).sort() : []
const lineas = regs.length ? leerRegistro(path.join(carpeta, 'registros', regs.at(-1)!)) : []
const pantallas = lineas.filter((l) => l.tipo === 'pantalla').map((l) => (l as { pantalla: string }).pantalla)
const idas = pantallas.filter((p, i) => p === 'NAPIA' && pantallas[i - 1] !== 'NAPIA').length + (faltaVista ? 1 : 0)
ok(idas === 0, `idas y vueltas entre PAILA y NAPIA: ${idas} (meta 0; la persona 2, 01/11: 11)${faltaVista ? ' — NAPIA pidió algo que se hace allá' : ''}`)
const clics = lineas.filter((l) => l.tipo === 'clic').length
console.log(`Pantallas: ${[...new Set(pantallas)].join(' → ')} · clics anotados: ${clics} · tareas: ${lineas.filter((l) => l.tipo === 'tarea').map((l) => (l as { tarea: string }).tarea).join(', ')}`)
await espera(3000)
if (!process.argv.includes('--dejar')) for (let i = 0; fs.existsSync(carpeta) && i < 30; i++) { try { fs.rmSync(carpeta, { recursive: true, force: true }) } catch { await espera(1000) } }
console.log(process.argv.includes('--dejar') ? `Quedó en ${carpeta}` : `Borrada ${carpeta}`)
process.exit(process.exitCode ?? 0)
