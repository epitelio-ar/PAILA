// `npm run tema <archivo>`: todo lo que PAILA ve y decide de un tema, en una pantalla de texto (tags, calidad y por qué, BPM, tono,
// grilla, huellas, playlists, duplicados, historial de cambios y qué propondría cada asistente). SOLO LEE: abre la base en modo de
// solo lectura y no toca ningún archivo. El mismo inspector está en la app (Configuración → Modo avanzado).
//
//   npm run tema "D:\Música\Artista\tema.mp3"        la ruta completa, o el final de la ruta, o un pedazo del nombre, o el número
//   npm run tema -- 1234 --json                      lo mismo en JSON (para otro programa o agente)
//   npm run tema -- tema.mp3 --base copia\paila.db   otra base (por defecto: PAILA_USER_DATA o la de esta PC)
//   --sin-asistentes                                 saltea lo que propondrían los asistentes (recorren toda la biblioteca: tarda más en las grandes)
//   --en | --es                                      en inglés o en castellano (de fábrica: el idioma de PAILA, o PAILA_IDIOMA)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findTrack, inspectTrack, openReadOnly } from '@paila/core/inspector'
import { inspectionText } from '@paila/core/inspector-texto'
import { esIdioma, ponerIdioma, textos } from '@paila/shared/idioma'

const args = process.argv.slice(2)
const flag = (n: string) => args.includes(n)
const valor = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const pedido = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--base').join(' ')

// la carpeta de datos de PAILA: %APPDATA%\PAILA en Windows, ~/Library/Application Support/PAILA en Mac
const appData = process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming')
const datos = process.env.PAILA_USER_DATA || path.join(appData, 'PAILA')
const base = valor('--base') ?? path.join(datos, 'paila.db')
// el idioma: --en o --es; si no, PAILA_IDIOMA; si no, el que eligió la persona en PAILA (idioma.json, al lado de la base)
const elegido = (() => { try { return (JSON.parse(fs.readFileSync(path.join(path.dirname(base), 'idioma.json'), 'utf8')) as { idioma?: unknown }).idioma } catch { return undefined } })()
const idioma = flag('--en') ? 'en' : flag('--es') ? 'es' : esIdioma(process.env.PAILA_IDIOMA) ? process.env.PAILA_IDIOMA : elegido
if (esIdioma(idioma)) ponerIdioma(idioma)
const T = textos({
  uso: { es: 'Uso: npm run tema <archivo | número | pedazo del nombre> [--json] [--base <paila.db>] [--sin-asistentes] [--en | --es]', en: 'Usage: npm run tema <file | number | part of the name> [--json] [--base <paila.db>] [--sin-asistentes] [--en | --es]' },
  sinBase: { es: (b: string) => `No encuentro la base en ${b}. Pasá --base <paila.db> o PAILA_USER_DATA.`, en: (b: string) => `I can't find the database at ${b}. Pass --base <paila.db> or PAILA_USER_DATA.` },
  ninguno: { es: (b: string) => `No hay ningún tema que se llame así en ${b}.`, en: (b: string) => `There's no track with that name in ${b}.` },
  parecidos: { es: (n: number, mas: boolean) => `Hay ${n}${mas ? ' o más' : ''} temas parecidos. Pasá el número o más del nombre:`, en: (n: number, mas: boolean) => `There are ${n}${mas ? ' or more' : ''} similar tracks. Pass the number or more of the name:` },
})
if (!pedido) { console.error(T.uso); process.exit(2) }
if (!fs.existsSync(base)) { console.error(T.sinBase(base)); process.exit(2) }

const db = openReadOnly(base)
try {
  const r = findTrack(db, pedido)
  if (!r) { console.error(T.ninguno(base)); process.exitCode = 1 }
  else if ('choices' in r) {
    console.error(T.parecidos(r.choices.length, r.choices.length === 20))
    for (const c of r.choices) console.error(`  #${c.id}  ${c.rel}`)
    process.exitCode = 1
  } else {
    const i = inspectTrack(db, r.found, { assistants: !flag('--sin-asistentes') })!
    console.log(flag('--json') ? JSON.stringify(i, null, 1) : inspectionText(i))
  }
} finally { db.close() }
