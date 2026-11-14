// "Vaciar papelera" con la app COMPILADA (scripts/conducir.ts aprieta los mismos botones que una persona), sobre una
// biblioteca de prueba aparte hecha con COPIAS de la Música (que solo se lee). Lo que se prueba:
//   - la papelera se llena por los caminos de la app: Duplicados (temas repetidos) y Espacio (lo que no es música);
//   - Vaciar avisa antes (lista de lo que se va, cuánto se libera, "para siempre", escribir VACIAR);
//   - "más de 30 días" borra solo la tanda vieja, y "todo" el resto; nada de afuera de la papelera se toca: ni la música,
//     ni los samples, ni una carpeta de afuera, ni la papelera de OTRA biblioteca que no es de esta PAILA (señuelo);
//   - el Historial registra el vaciado: las tandas dicen que ya no se pueden deshacer y no ofrecen el botón.
// Borra de verdad, pero solo copias hechas para la prueba. Complementa scripts/vaciar.ts (21/10: el mismo vaciado por
// código, con el reemplazo, WAV→FLAC y el acceso directo de carpeta en NTFS).
//
//   node scripts/run-ts.mjs scripts/vaciar-app.ts --carpeta <trabajo>/vaciar-app --original <Música original> [--capturas <carpeta>]
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Library } from '@paila/core/library'
import { findFfmpeg, findFfprobe } from '@paila/core/probe'
import { DJ_TOOLS_OFFERED } from '@paila/shared/profile'
import { abrirApp, type App } from './conducir'

const arg = (k: string, d = '') => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const base = arg('--carpeta'), original = arg('--original'), capturas = arg('--capturas')
if (!base || !original || !/[\\/]vaciar-app$/i.test(base)) { console.error('Uso: --carpeta <…/vaciar-app> --original <Música> [--capturas <carpeta>]'); process.exit(2) }
if (fs.existsSync(base)) { console.error(`Ya existe ${base}: borrala a mano para empezar de nuevo`); process.exit(2) }
const M = path.join(base, 'M'), afuera = path.join(base, 'afuera'), datos = path.join(base, 'datos')
const senuelo = path.join(base, 'otra-biblioteca', '_PAILA', 'papelera', '2025-01-01_10-00-00_tanda-1_Duplicados')
const papelera = path.join(M, '_PAILA', 'papelera')
const log = (...a: unknown[]) => console.log(...a)
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))
const md5 = (f: string) => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex')
const captura = async (app: App, nombre: string) => { if (capturas) await app.captura(path.join(capturas, `vaciar-${nombre}.png`)) }
/** Todo lo que NO está dentro de la papelera de esta biblioteca, con su MD5. */
const fuera = () => {
  const out = new Map<string, string>()
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (p === papelera || p === datos) continue
      if (e.isDirectory()) walk(p); else out.set(path.relative(base, p), md5(p))
    }
  }
  walk(base)
  return out
}
const enPapelera = () => fs.existsSync(papelera) ? (fs.readdirSync(papelera, { recursive: true }) as string[]).filter((f) => fs.statSync(path.join(papelera, f)).isFile()) : []
const tandas = () => fs.existsSync(papelera) ? fs.readdirSync(papelera) : []

// 1) biblioteca de prueba: temas copiados de la Música (de carpetas distintas), 5 repetidos, samples, basura y afuera
const want: Record<string, number> = { mp3: 6, flac: 3, m4a: 1, wav: 2 }
const picked: string[] = []
const seenDir = new Set<string>()
for (const f of fs.readdirSync(original, { recursive: true }) as string[]) {
  const ext = path.extname(f).slice(1).toLowerCase(), dir = path.dirname(f)
  if (!want[ext] || seenDir.has(dir) || /^_PAILA|PIONEER|Samples|Ableton/i.test(f)) continue
  if (fs.statSync(path.join(original, f)).size > 40e6) continue
  want[ext]--; seenDir.add(dir); picked.push(f)
}
for (const f of picked) { fs.mkdirSync(path.dirname(path.join(M, f)), { recursive: true }); fs.copyFileSync(path.join(original, f), path.join(M, f)) }
fs.mkdirSync(path.join(M, 'Copias'), { recursive: true })
for (const f of picked.slice(0, 5)) fs.copyFileSync(path.join(M, f), path.join(M, 'Copias', path.basename(f)))
const ffmpeg = findFfmpeg()!
fs.mkdirSync(path.join(M, 'Samples', 'Kit'), { recursive: true })
for (let i = 1; i <= 3; i++) execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${100 * i}:duration=0.5`, path.join(M, 'Samples', 'Kit', `kick ${i}.wav`)])
fs.mkdirSync(path.join(M, 'Descargas'), { recursive: true })
fs.writeFileSync(path.join(M, 'Descargas', 'Thumbs.db'), 'basura de Windows')
fs.writeFileSync(path.join(M, 'Descargas', 'desktop.ini'), '[.ShellClassInfo]')
fs.mkdirSync(afuera, { recursive: true })
fs.writeFileSync(path.join(afuera, 'testigo.txt'), 'si esto se borra, Vaciar se fue de su papelera')
fs.copyFileSync(path.join(M, picked[0]), path.join(afuera, path.basename(picked[0])))
fs.mkdirSync(senuelo, { recursive: true })
fs.copyFileSync(path.join(M, picked[1]), path.join(senuelo, path.basename(picked[1])))
log(`Biblioteca de prueba: ${picked.length} temas copiados (${picked.map((f) => path.extname(f)).join(' ')}), 5 repetidos en Copias/, 3 samples, 2 de basura, afuera/ y la papelera señuelo de otra biblioteca`)

fs.mkdirSync(datos, { recursive: true })
{
  const lib = new Library(path.join(datos, 'paila.db'), findFfprobe())
  await lib.addRoot(M, [{ rel: '', kind: 'musica' }, { rel: 'Samples', kind: 'produccion' }])
  await lib.scan()
  // la oferta de las herramientas para DJ ya hecha: si no, aparece sobre la pantalla en cualquier momento
  lib.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(DJ_TOOLS_OFFERED, new Date().toISOString())
  log(`Escaneada: ${(lib.db.prepare('SELECT COUNT(*) AS n FROM files').get() as { n: number }).n} archivos`)
  lib.close()
}

const abrir = async () => {
  const app = await abrirApp(datos, { log: path.join(base, 'app.log') })
  await espera(1500)
  return app
}
const ir = async (app: App, boton: string, titulo: string) => {
  await app.clic(boton, { dentroDe: 'nav, aside, .sidebar' }).catch(() => app.clic(boton))
  await app.esperarTexto(titulo)
}
let app: App | null = null
try {
  // 2) Duplicados: buscar y mandar los repetidos a la papelera
  app = await abrir()
  await ir(app, 'Duplicados', 'El mismo tema repetido')
  await app.clic('Buscar duplicados')
  await app.esperarTexto(/Mandar \d+ archivos/, 300_000)
  log(`Duplicados: ${(await app.texto()).match(/[\d.]+ grupos de duplicados[^\n]*/)?.[0]}`)
  await captura(app, '1-duplicados')
  await app.clic('Mandar ')
  await app.esperarTexto(/Se mandaron \d+ archivos a la papelera[^\n]*/, 120_000)
  log((await app.texto()).match(/Se mandaron \d+ archivos a la papelera[^\n]*/)![0])
  await app.cerrar(); app = null

  // 3) con la app cerrada, la tanda de Duplicados pasa a ser "de hace 40 días" (la fecha va en el nombre de la carpeta)
  {
    const db = new DatabaseSync(path.join(datos, 'paila.db'))
    const t = tandas()[0]
    const d = new Date(Date.now() - 40 * 86_400_000), p = (n: number) => String(n).padStart(2, '0')
    const viejo = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_10-00-00${t.slice(19)}`
    fs.renameSync(path.join(papelera, t), path.join(papelera, viejo))
    db.prepare('UPDATE trash_log SET trash_rel = replace(trash_rel, ?, ?)').run(t, viejo)
    db.close()
    log(`Tanda de Duplicados envejecida: ${viejo}`)
  }

  // 4) Espacio: lo que no es música, a la papelera (otra tanda, nueva)
  app = await abrir()
  await ir(app, 'Espacio', 'Espacio')
  await app.clic('Lo que no es música')
  await app.clic('Buscar archivos que no son música')
  await app.esperarTexto(/Mandar \d+ archivos/, 60_000)
  await app.clic('Mandar ')
  // espera a que el análisis suelte los archivos que estaba leyendo (puede tardar unos segundos)
  const mandados = /Se mandaron \d+ archivos a la papelera[^\n]*/
  await app.esperarTexto(mandados, 120_000)
  log(`Espacio: ${(await app.texto()).match(mandados)![0]}`)
  log(`Tandas en la papelera: ${tandas().join(' | ')} (${enPapelera().length} archivos)`)
  const antes = fuera()
  const viejas = tandas().filter((t) => Date.now() - Date.parse(t.slice(0, 10)) > 30 * 86_400_000)

  // 5) Vaciar: primero "más de 30 días"
  await ir(app, 'Papelera', 'Nada se borra de verdad')
  await espera(800)
  log(`Papelera antes: ${(await app.texto()).match(/La papelera ocupa[^\n]*/)?.[0]}`)
  await captura(app, '2-papelera')
  await app.clic('Vaciar papelera…')
  await app.esperarTexto('borra de verdad')
  await app.js(`document.querySelectorAll('.purge input[type=radio]')[1].click()`)
  await espera(300)
  const paso1 = await app.js<string>(`document.querySelector('.purge').innerText`)
  log(`Aviso, paso 1 (más de 30 días):\n    ${paso1.split('\n').join('\n    ')}`)
  await captura(app, '3-aviso-30-dias')
  await app.clic('Seguir…')
  await app.esperarTexto('Última confirmación')
  const paso2 = await app.js<string>(`document.querySelector('.purge').innerText`)
  log(`Aviso, paso 2:\n    ${paso2.split('\n').join('\n    ')}`)
  const borrarDeshabilitado = await app.js<boolean>(`[...document.querySelectorAll('.purge button')].find((b) => b.textContent.startsWith('Borrar')).disabled`)
  await app.escribir('.purge input[type=text]', 'vaciar')
  await captura(app, '4-escribir-vaciar')
  await app.clic('Borrar ')
  await app.esperarTexto(/Papelera vaciada[^\n]*/, 60_000)
  log(`Botón Borrar apagado antes de escribir VACIAR: ${borrarDeshabilitado}. ${(await app.texto()).match(/Papelera vaciada[^\n]*/)![0]}`)
  log(`  quedan las tandas: ${tandas().join(' | ')}; se fueron las viejas: ${viejas.every((t) => !tandas().includes(t))}`)
  const quedanTrasViejo = enPapelera().length

  // 6) Vaciar todo
  await app.clic('Vaciar papelera…')
  await app.clic('Seguir…')
  await app.escribir('.purge input[type=text]', 'VACIAR')
  await app.clic('Borrar ')
  const todo = new RegExp(`Papelera vaciada: se borraron ${quedanTrasViejo} archivos[^\\n]*`)
  await app.esperarTexto(todo, 60_000)
  log(`Vaciar todo: ${(await app.texto()).match(todo)![0]}`)
  await captura(app, '5-vaciada')

  // 7) Historial: tiene que decir que ya no se puede deshacer, y no ofrecer el botón
  await ir(app, 'Historial', 'Todo lo que PAILA hizo')
  await espera(800)
  const hist = await app.js<{ tipo: string; texto: string; boton: boolean }[]>(`[...document.querySelectorAll('.box')].map((b) => ({ tipo: b.querySelector('.pill')?.textContent ?? '', texto: b.innerText.replace(/\\s+/g, ' ').slice(0, 220), boton: [...b.querySelectorAll('button')].some((x) => /^(Restaurar|Deshacer)$/.test(x.textContent.trim())) }))`)
  for (const h of hist) log(`  Historial: ${h.texto}${h.boton ? '  [OFRECE DESHACER: MAL]' : ''}`)
  await captura(app, '6-historial')
  await app.cerrar(); app = null

  // 8) controles
  const despues = fuera()
  const cambiaron = [...antes].filter(([p, h]) => despues.get(p) !== h).map(([p]) => p)
  log(`Afuera de la papelera (${antes.size} archivos: temas, samples, afuera/ y la papelera señuelo): ${cambiaron.length ? `CAMBIÓ: ${cambiaron.join(', ')}` : 'intacto'}`)
  log(`Papelera señuelo de otra biblioteca: ${fs.readdirSync(senuelo).length} archivo(s), sigue igual: ${!cambiaron.some((p) => p.startsWith('otra-biblioteca'))}`)
  log(`Archivos que quedaron en la papelera: ${enPapelera().length ? enPapelera().join(', ') : 'ninguno'}; carpetas: ${tandas().length}`)
  const db = new DatabaseSync(path.join(datos, 'paila.db'), { readOnly: true })
  log(`trash_log: ${JSON.stringify(db.prepare('SELECT COUNT(*) AS n, SUM(purged_at IS NOT NULL) AS vaciados FROM trash_log').get())}; moves_log (limpieza): ${JSON.stringify(db.prepare('SELECT COUNT(*) AS n, SUM(purged_at IS NOT NULL) AS vaciados FROM moves_log').get())}`)
  db.close()
} catch (e) {
  if (app) {
    log(`Consola de la ventana:\n  ${app.consola.slice(-30).join('\n  ')}`)
    await app.captura(path.join(base, 'error.png')).catch(() => { /* ya no está */ })
    app.matar()
  }
  throw e
}
