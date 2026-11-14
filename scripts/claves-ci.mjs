// Las claves de aplicación de PAILA en el armado de GitHub (.github/workflows/version.yml): arma claves.local.json con los
// secretos del repositorio (DISCOGS_KEY, DISCOGS_SECRET, ACOUSTID, LASTFM), que electron.vite.config.ts mete adentro del
// programa. Sin ningún secreto no escribe nada y PAILA se arma sin claves (cada uno pega las suyas en Configuración).
// Nunca muestra los valores. Uso: node scripts/claves-ci.mjs   (con los secretos como variables de entorno)
import fs from 'node:fs'
import path from 'node:path'

const raiz = path.resolve(import.meta.dirname, '..')
/** Cada clave de claves.local.json y el secreto de GitHub que la trae. */
export const SECRETOS = { discogsKey: 'DISCOGS_KEY', discogsSecret: 'DISCOGS_SECRET', acoustid: 'ACOUSTID', lastfm: 'LASTFM' }

/** Las claves que hay en el entorno (solo las que tienen algo). */
export function claves(env = process.env) {
  return Object.fromEntries(Object.entries(SECRETOS).map(([k, s]) => [k, (env[s] ?? '').trim()]).filter(([, v]) => v))
}

function main() {
  const c = claves()
  const destino = path.join(raiz, 'claves.local.json')
  if (!Object.keys(c).length) { console.log('Sin secretos de claves: PAILA se arma sin claves propias.'); return }
  // Discogs pide las dos partes juntas: con una sola, no sirve
  if (!c.discogsKey !== !c.discogsSecret) console.warn('Aviso: de Discogs hay una sola de las dos claves (DISCOGS_KEY y DISCOGS_SECRET); sin la otra no anda.')
  fs.writeFileSync(destino, JSON.stringify(c, null, 2) + '\n')
  console.log(`claves.local.json armado con: ${Object.keys(c).join(', ')}.`)
}

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) main()
