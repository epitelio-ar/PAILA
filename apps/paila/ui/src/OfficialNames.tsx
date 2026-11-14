// Sección "Nombres oficiales" de Completar desde internet: cuánto falta buscar en cada fuente, el botón para buscar y
// adónde ir a revisar lo encontrado (el perfil Oficial de "Arreglar nombres y tags").
import { useCallback, useEffect, useRef, useState } from 'react'
import type { NameSource, NamesStatus } from '@paila/shared/types'
import type { PageKey } from './nav'
import type { EstadoSeccion } from './Plegable'
import { useAlCambiarCambios } from './hooks/useChanges'
import { JobPanel, useJob } from './jobs'
import { n } from './format'
import { Aviso, Boton, Cabecera, Rico } from '@paila/diseno'
import { textos } from '@paila/shared/idioma'

const T = textos({
  helpMb: { es: 'Nombres oficiales y alias de cada artista. Sin clave; un pedido por segundo.', en: 'Official names and aliases for each artist. No key needed; one request per second.' },
  helpDeezer: { es: 'Confirma artista y título como los cargan los sellos. Sin clave.', en: 'Confirms artist and title the way labels enter them. No key needed.' },
  helpDiscogs: { es: 'Lo mejor para electrónica, cumbia y vinilos. Necesita clave (Configuración).', en: 'Best for electronic music, cumbia and vinyl. Needs a key (Settings).' },
  helpAcoustid: { es: 'Reconoce los temas sin nombre por su sonido (huella acústica). Necesita clave (Configuración).', en: 'Recognizes tracks with no name by their sound (acoustic fingerprint). Needs a key (Settings).' },
  helpAudd: { es: 'Reconocedor tipo Shazam, para lo que nada más reconoció: manda 15 s de audio. Viene apagado; se prende con tu clave en Configuración.', en: 'A Shazam-style recognizer for whatever nothing else recognized: it sends 15 s of audio. It is off by default; turn it on with your key in Settings.' },
  titulo: { es: 'Nombres oficiales', en: 'Official names' },
  info: {
    es: "Solo se envía el artista, el título y la duración (o la huella acústica de los temas sin nombre). De paso trae de dónde es cada artista (MusicBrainz). El nombre del artista y del tema tal como figuran en las bases de datos de música: 'Balvin' → 'J Balvin', 'Los Redondos' → 'Patricio Rey y sus Redonditos de Ricota', 'The Weekend' → 'The Weeknd', acentos que faltan, títulos cortados en 30 letras. Un tema cuenta como confirmado si la fuente lo tiene con la misma duración.",
    en: "Only the artist, the title and the length are sent (or the acoustic fingerprint of tracks with no name). It also brings where each artist is from (MusicBrainz). The name of the artist and the track the way music databases list them: 'Balvin' → 'J Balvin', 'Los Redondos' → 'Patricio Rey y sus Redonditos de Ricota', 'The Weekend' → 'The Weeknd', missing accents, titles cut off at 30 letters. A track counts as confirmed if the source has it with the same length.",
  },
  intro: { es: 'Busca cada artista y tema en varias fuentes. **No cambia nada**: lo encontrado se revisa en Arreglar nombres y tags.', en: 'Looks up every artist and track in several sources. **Nothing changes**: you review what it finds in Fix names and tags.' },
  revisar: { es: 'Revisar lo encontrado →', en: 'Review what was found →' },
  revisarN: { es: (k: string) => `Revisar ${k} temas con cambios propuestos`, en: (k: string) => `Review ${k} tracks with suggested changes` },
  conHuella: { es: ' temas sin nombre con huella acústica', en: ' unnamed tracks with an acoustic fingerprint' },
  temasBuscar: { es: ' temas', en: ' tracks' },
  temasDe: { es: ' temas de ', en: ' tracks by ' },
  artistas: { es: ' artistas', en: ' artists' },
  y: { es: ' y ', en: ' and ' },
  yaBuscado: { es: ' · búsquedas hechas: ', en: ' · searches done: ' },
  conError: { es: (k: string) => ` (${k} con error)`, en: (k: string) => ` (${k} with errors)` },
  falta: { es: ' · faltan: ', en: ' · left: ' },
  unos: { es: (m: number) => ` (unos ${m} min; las fuentes buscan a la vez y podés cambiar de pantalla)`, en: (m: number) => ` (about ${m} min; the sources search at the same time and you can switch screens)` },
  apagado: { es: 'apagado', en: 'off' },
  nadaReconocer: { es: 'nada que reconocer', en: 'nothing to recognize' },
  apagadoSinClave: { es: 'apagado o sin clave', en: 'off or no key' },
  sinClave: { es: 'sin clave', en: 'no key' },
  faltan: { es: (k: string) => `faltan ${k}`, en: (k: string) => `${k} left` },
  listo: { es: 'listo', en: 'done' },
  faltanB: { es: (k: string) => `faltan ${k} búsquedas`, en: (k: string) => `${k} searches left` },
  paraRevisar: { es: (k: string) => `${k} para revisar en Arreglar nombres`, en: (k: string) => `${k} to review in Fix names` },
  busquedas: { es: 'búsquedas de nombres', en: 'name searches' },
  cancelar: { es: 'Cancelar', en: 'Cancel' },
  buscando: { es: 'Buscando…', en: 'Searching…' },
  seguir: { es: (k: string) => `Seguir buscando (${k})`, en: (k: string) => `Keep searching (${k})` },
  buscar: { es: 'Buscar nombres oficiales', en: 'Look up official names' },
  reintentar: { es: (k: string) => `Reintentar los ${k} con error`, en: (k: string) => `Try the ${k} with errors again` },
  ver: { es: 'Revisar lo encontrado', en: 'Review what was found' },
  claves: { es: 'Claves de internet', en: 'Internet keys' },
})

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
const SRC: { key: NameSource; label: string; help: string }[] = [
  { key: 'musicbrainz', label: 'MusicBrainz', help: T.helpMb },
  { key: 'deezer', label: 'Deezer', help: T.helpDeezer },
  { key: 'discogs', label: 'Discogs', help: T.helpDiscogs },
  { key: 'acoustid', label: 'AcoustID', help: T.helpAcoustid },
  { key: 'audd', label: 'AudD', help: T.helpAudd },
]

export default function OfficialNames({ onGo, onEstado }: { onGo: (p: PageKey) => void; onEstado?: (e: EstadoSeccion) => void }) {
  const job = useJob('names')
  const [st, setSt] = useState<NamesStatus | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const refresh = useCallback(() => { window.paila.namesStatus().then(setSt).catch((e) => setMsg(clean(e))) }, [])
  useEffect(() => { refresh() }, [refresh])
  useAlCambiarCambios(refresh)
  const was = useRef(false)
  useEffect(() => { if (was.current && !job?.running) refresh(); was.current = !!job?.running }, [job?.running, refresh])
  const run = (retry = false) => { setMsg(null); window.paila.namesRun(retry).catch((e) => setMsg(clean(e))) }
  const left = st ? Object.values(st.left).reduce((a, b) => a + b, 0) : 0
  const asked = st ? Object.values(st.done).reduce((a, b) => a + (b?.ok ?? 0), 0) : 0
  const errors = st ? Object.values(st.done).reduce((a, b) => a + (b?.error ?? 0), 0) : 0
  // en qué está, en un renglón (lo muestra la sección plegada de Completar desde internet)
  useEffect(() => {
    if (!st) return
    onEstado?.(left > 0 ? { listo: false, texto: T.faltanB(n(left)) } : st.proposals > 0 ? { listo: false, texto: T.paraRevisar(n(st.proposals)) } : { listo: true, texto: T.listo })
  }, [st, left, onEstado])

  return (<>
    <Cabecera nivel={3} titulo={null} info={T.info} ayuda={<>
      <p className="muted small"><Rico texto={T.intro} /></p>
      {st && <p className="muted small">{T.temasDe.trim()} <b>{n(st.artists)}</b>{T.artistas}{st.unnamed ? <>{T.y}<b>{n(st.unnamed)}</b>{T.conHuella}</> : null}{left > 0 ? T.unos(st.minutes) : ''}</p>}
      {st && (
        <div className="names-src">
          {SRC.map((s) => {
            const off = st.left[s.key] === 0 && !st.done[s.key]
            return <span key={s.key} className={`pill ${off ? '' : st.left[s.key] ? 'pill-blue' : 'pill-green'}`} style={{ marginLeft: 0 }} title={s.help}>
              {s.label}: {off ? (s.key === 'deezer' ? T.apagado : (s.key === 'acoustid' || s.key === 'audd') && !st.unnamed ? T.nadaReconocer : s.key === 'audd' ? T.apagadoSinClave : T.sinClave) : st.left[s.key] ? T.faltan(n(st.left[s.key])) : T.listo}
            </span>
          })}
        </div>
      )}
      <p className="small"><button className="link" onClick={() => onGo('settings')}>{T.claves}</button></p>
    </>} />
    {msg && <Aviso>{msg}</Aviso>}
    {st && !job?.running && (
      <div className="callout">
        <b>{n(st.tracks)}</b>{T.temasBuscar}{T.yaBuscado}<b>{n(asked)}</b>{errors ? T.conError(n(errors)) : ''}{T.falta}<b>{n(left)}</b>
      </div>
    )}
        {job && <JobPanel job={job} unit={T.busquedas} onDismiss={() => window.paila.dismissJob('names')}>{job.running && <Boton variant="ghost" size="sm" disabled={job.cancelling} onClick={() => window.paila.cancelJob('names')}>{T.cancelar}</Boton>}</JobPanel>}
    <div className="row">
      <Boton disabled={!!job?.running || !st || left === 0} onClick={() => run(false)}>{job?.running ? T.buscando : asked ? T.seguir(n(left)) : T.buscar}</Boton>
      {errors > 0 && <Boton variant="ghost" disabled={!!job?.running} onClick={() => run(true)}>{T.reintentar(n(errors))}</Boton>}
      {asked > 0 && !job?.running && <Boton variant={job ? 'primary' : 'ghost'} onClick={() => onGo('tidy')}>{job && !job.running && !job.failed && st && st.proposals > 0 ? T.revisarN(n(st.proposals)) : T.ver}</Boton>}
    </div>
  </>)
}
