// Informe de una persona de la prueba (docs/prueba-personas/): toma el registro del modo prueba y, si hay, el video de la pantalla;
// saca una foto cada tantos segundos con el ffmpeg del proyecto y escribe docs/pruebas/personas/<fecha>-<persona>/informe.md con
// tiempo por tarea, dónde se trabó (con la foto de ese momento) y las pantallas visitadas (core/prueba-informe.ts).
//
//   npm run prueba:informe -- --registro D:/PAILA-trabajo/prueba-personas/registros/2026-10-27_15-30-12.jsonl
//        [--video "C:/Users/usuario/Videos/2026-10-27 15-29-58.mkv"] [--inicio "2026-10-27 15:29:58"] [--persona Ana] [--cada 20]
//
// La hora en que empezó el video sale del nombre del archivo (OBS y la grabadora de Windows ponen fecha y hora) o, si no, de
// cuándo se guardó menos lo que dura. Si no coincide, se da a mano con --inicio.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { findFfmpeg, findFfprobe } from '@paila/core/probe'
import { leerRegistro } from '@paila/core/prueba'
import { informeMarkdown, reloj } from '@paila/core/prueba-informe'

const arg = (k: string, d = '') => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const fin = (s: string): never => { console.error(s); process.exit(1) }
const REPO = process.cwd() // npm run corre desde la raíz del repositorio

const registro = arg('--registro')
if (!registro || !fs.existsSync(registro)) fin('Uso: npm run prueba:informe -- --registro <archivo .jsonl> [--video <archivo>] [--persona <nombre>] [--cada 20]')
const lineas = leerRegistro(registro)
if (!lineas.length) fin('El registro está vacío.')
const inicioReg = lineas[0]
const persona = arg('--persona') || (inicioReg.tipo === 'inicio' && inicioReg.persona) || 'sin-nombre'
const abrio = new Date(inicioReg.hora) // hora local, como la escribe el registro
const fecha = inicioReg.hora.slice(0, 10)
const slug = persona.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]+/g, '-').toLowerCase()
const salida = path.join(REPO, 'docs', 'pruebas', 'personas', `${fecha}-${slug}`)
fs.mkdirSync(salida, { recursive: true })

/** "2026-10-27 15-29-58" (OBS), "…_15_29_58" o parecidos en el nombre del video → la hora local en que empezó. */
function horaDelNombre(nombre: string): Date | null {
  const m = nombre.match(/(\d{4})[-_.](\d{2})[-_.](\d{2})[ _T-]+(\d{1,2})[-_.:](\d{2})[-_.:](\d{2})/)
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null
}

let foto: (seg: number) => string | null = () => null
const video = arg('--video')
if (video) {
  if (!fs.existsSync(video)) fin(`No está el video: ${video}`)
  const ffmpeg = findFfmpeg(), ffprobe = findFfprobe()
  if (!ffmpeg || !ffprobe) fin('Falta ffmpeg o ffprobe del proyecto.')
  const dura = Number(execFileSync(ffprobe!, ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', video], { encoding: 'utf8' }).trim())
  const dado = arg('--inicio')
  const empezo = dado ? new Date(dado.replace(' ', 'T')) : horaDelNombre(path.basename(video)) ?? new Date(fs.statSync(video).mtimeMs - dura * 1000)
  // segundos del registro → segundos del video
  const corrimiento = (abrio.getTime() - empezo.getTime()) / 1000
  const cada = Math.max(2, Number(arg('--cada', '20')))
  const fotos = path.join(salida, 'fotos')
  fs.rmSync(fotos, { recursive: true, force: true }); fs.mkdirSync(fotos)
  console.log(`Sacando una foto cada ${cada} s de ${reloj(dura)} de video (empezó ${empezo.toLocaleTimeString('es-AR')}, PAILA abrió ${abrio.toLocaleTimeString('es-AR')})…`)
  execFileSync(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-i', video, '-vf', `fps=1/${cada},scale=1280:-2`, '-q:v', '5', path.join(fotos, '%04d.jpg')], { timeout: 30 * 60_000 })
  const hechas = fs.readdirSync(fotos).filter((f) => f.endsWith('.jpg')).sort()
  // la foto N (desde 1) es del segundo (N - 1) * cada + cada / 2 del video, más o menos
  foto = (seg) => {
    const enVideo = seg + corrimiento
    if (enVideo < 0 || enVideo > dura) return null
    const i = Math.min(hechas.length - 1, Math.max(0, Math.round((enVideo - cada / 2) / cada)))
    return hechas[i] ? `fotos/${hechas[i]}` : null
  }
}

const md = informeMarkdown(persona, fecha.split('-').reverse().join('/'), lineas, foto)
fs.writeFileSync(path.join(salida, 'informe.md'), md + `\nRegistro: \`${registro}\`${video ? ` · video: \`${video}\`` : ''}\n`)
console.log(`Listo: ${path.join(salida, 'informe.md')}`)
