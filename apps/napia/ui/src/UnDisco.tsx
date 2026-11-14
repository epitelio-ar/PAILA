// "Un disco" en Qué bajar (DECISIONES 07/11): se escribe artista y disco, NAPIA busca la lista oficial en MusicBrainz y Deezer y, si hay
// varias ediciones, las lista con año y cantidad de temas, marca la sugerida (la que más se parece a lo escrito) y no baja nada hasta que
// la persona elige (el autor, 13/11: que no elija sola). La lista entra a la tanda como cualquier otra, con el disco: primero se busca la carpeta entera de una
// persona y, si nadie la tiene completa, tema por tema lo que falta (apps/napia/electron/disco.ts). Queda en la carpeta "Artista - Disco".
import { useState } from 'react'
import { Aviso, Boton, Campo, Info, Pildora } from '@paila/diseno'
import type { EdicionDisco, NapiaList, TemaDisco } from '@paila/shared/napia'
import { cant, textos } from '@paila/shared/idioma'
import { mmss, n } from './textos'

const T = textos({
  artista: { es: 'Artista', en: 'Artist' },
  disco: { es: 'Disco', en: 'Album' },
  buscar: { es: 'Buscar el disco', en: 'Find the album' },
  buscando: { es: 'Buscando en MusicBrainz y Deezer…', en: 'Searching MusicBrainz and Deezer…' },
  ayuda: {
    es: 'NAPIA busca la lista oficial del disco para saber qué temas tiene. Primero intenta bajar la carpeta entera de una sola persona (así llega completo y parejo); si nadie lo tiene entero, baja tema por tema lo que falta. Todo pasa por el control de calidad de siempre.',
    en: "NAPIA looks up the album's official track list to know which tracks it has. First it tries to download the whole folder from a single person (so it arrives complete and consistent); if nobody has it whole, it downloads track by track what's missing. Everything goes through the usual quality check.",
  },
  nada: { es: 'No encontramos ese disco. Fijate cómo está escrito, o probá sin "Deluxe" ni "Remastered".', en: 'We couldn\'t find that album. Check the spelling, or try without "Deluxe" or "Remastered".' },
  sinRed: { es: (m: string) => `No se pudo buscar: ${m}`, en: (m: string) => `Couldn't search: ${m}` },
  cual: { es: '¿Cuál de estas ediciones?', en: 'Which of these editions?' },
  cualTip: { es: 'Un mismo disco puede tener varias ediciones: la original, una remasterizada, una de lujo con temas de más, la de otro país. Elegí la que querés: NAPIA busca la carpeta con esa cantidad de temas. No baja nada hasta que elijas.', en: "The same album can have several editions: the original, a remastered one, a deluxe one with extra tracks, another country's. Pick the one you want: NAPIA looks for the folder with that number of tracks. It downloads nothing until you choose." },
  sinMb: { es: 'MusicBrainz no contestó (a veces pasa si se le pregunta muy seguido): puede haber más ediciones, como la original. Probá de nuevo en un ratito, o elegí una de estas.', en: "MusicBrainz didn't answer (it sometimes happens if it's asked too often): there may be more editions, like the original. Try again in a moment, or pick one of these." },
  otraVez: { es: 'Buscar de nuevo', en: 'Search again' },
  sugerida: { es: 'Sugerida', en: 'Suggested' },
  sugeridaTip: { es: 'Es la que más se parece a lo que escribiste (si empatan, la más vieja). Es solo una sugerencia: elegís vos.', en: "It's the one closest to what you typed (if they tie, the oldest). It's only a suggestion: you choose." },
  original: { es: 'Original', en: 'Original' },
  remaster: { es: 'Remasterizada', en: 'Remastered' },
  deLujo: { es: 'De lujo', en: 'Deluxe' },
  temas: { es: (k: number) => cant(k, 'tema', 'temas'), en: (k: number) => cant(k, 'track', 'tracks') },
  yMas: { es: (k: string) => `y ${k} más`, en: (k: string) => `and ${k} more` },
  sumar: { es: 'Sumar el disco a la tanda', en: 'Add the album to the batch' },
  cargando: { es: 'Trayendo la lista de temas…', en: 'Fetching the track list…' },
})

const VISTA = 8
// el ejemplo de los campos es un disco de verdad: no se traduce
// idioma-ok
const EJEMPLO = { artista: 'Plan B', disco: 'Love and Sex' }
const CLASE = { original: T.original, remaster: T.remaster, deLujo: T.deLujo }
const detalle = (e: EdicionDisco) => [e.anio, e.pais, e.formato, e.nota, e.tipo, T.temas(e.temas)].filter(Boolean).join(' · ')

export default function UnDisco({ onList }: { onList: (l: NapiaList) => void }) {
  const [artista, setArtista] = useState('')
  const [titulo, setTitulo] = useState('')
  const [eds, setEds] = useState<EdicionDisco[] | null>(null)
  const [elegida, setElegida] = useState<EdicionDisco | null>(null)
  const [temas, setTemas] = useState<TemaDisco[] | null>(null)
  const [ocupado, setOcupado] = useState<'buscando' | 'cargando' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [incompleta, setIncompleta] = useState(false)

  const buscar = async () => {
    setOcupado('buscando'); setError(null); setEds(null); setElegida(null); setTemas(null)
    // con una sola edición, como antes; pero si MusicBrainz no contestó puede haber más (Soda Stereo, Canción animal: quedaba solo la
    // remasterizada de Deezer, 13/11), así que no se elige sola
    try { const r = await window.napia.buscarDisco(artista, titulo); setEds(r.ediciones); setIncompleta(r.sinMusicbrainz); if (r.ediciones.length === 1 && !r.sinMusicbrainz) void elegir(r.ediciones[0]) } catch (e) { setError(T.sinRed((e as Error).message)) } finally { setOcupado(null) }
  }
  const elegir = async (e: EdicionDisco) => {
    setElegida(e); setTemas(null); setOcupado('cargando')
    try { setTemas(await window.napia.temasDisco(e)) } catch (x) { setError(T.sinRed((x as Error).message)) } finally { setOcupado(null) }
  }
  const sumar = () => {
    if (!elegida || !temas?.length) return
    onList({ name: `${elegida.artista} - ${elegida.titulo}`, source: elegida.fuente === 'musicbrainz' ? 'MusicBrainz' : 'Deezer', skipped: [], disco: { artista: elegida.artista, titulo: elegida.titulo, edicion: elegida },
      tracks: temas.map((t) => ({ artist: t.artist, title: t.title, album: elegida.titulo, duration: t.duration })) })
  }

  return (
    <div className="un-disco">
      <div className="row">
        <Campo label={T.artista}><input style={{ width: 150 }} value={artista} onChange={(e) => setArtista(e.target.value)} placeholder={EJEMPLO.artista} /></Campo>
        <Campo label={T.disco}><input style={{ width: 150 }} value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder={EJEMPLO.disco} onKeyDown={(e) => { if (e.key === 'Enter' && artista.trim() && titulo.trim()) void buscar() }} /></Campo>
        <Boton disabled={!artista.trim() || !titulo.trim() || !!ocupado} onClick={buscar}>{T.buscar}</Boton><Info tip={T.ayuda} />
      </div>
      {ocupado === 'buscando' && <p className="muted small">{T.buscando}</p>}
      {eds && !eds.length && <Aviso tone="atencion">{T.nada}</Aviso>}
      {eds && incompleta && <Aviso tone="atencion">{T.sinMb}<div className="row" style={{ marginTop: 'var(--sp-2)' }}><Boton size="sm" variant="ghost" disabled={!!ocupado} onClick={buscar}>{T.otraVez}</Boton></div></Aviso>}
      {eds && (eds.length > 1 || (incompleta && eds.length === 1)) && (
        <fieldset className="ediciones">
          <legend>{T.cual}<Info tip={T.cualTip} /></legend>
          {eds.map((e) => (
            <label key={`${e.fuente}-${e.id}`} className="edicion">
              <input type="radio" name="edicion" checked={elegida?.id === e.id && elegida.fuente === e.fuente} onChange={() => void elegir(e)} />
              <b>{e.artista} — {e.titulo}</b> {e.clase && <Pildora>{CLASE[e.clase]}</Pildora>} <span className="muted small">{detalle(e)}</span> <Pildora>{e.fuente === 'musicbrainz' ? 'MusicBrainz' : 'Deezer'}</Pildora>
              {e.sugerida && <><Pildora tone="ok">{T.sugerida}</Pildora><Info tip={T.sugeridaTip} /></>}
            </label>
          ))}
        </fieldset>
      )}
      {ocupado === 'cargando' && <p className="muted small">{T.cargando}</p>}
      {temas && temas.length > 0 && (
        <>
          <div className="vista-lista">
            {temas.slice(0, VISTA).map((t) => <div key={t.n} className="vista-fila"><span className="num muted">{t.n}</span><span className="ellipsis">{t.title}</span><span className="num muted">{mmss(t.duration)}</span></div>)}
            {temas.length > VISTA && <div className="vista-fila muted"><span /><span>{T.yMas(n(temas.length - VISTA))}</span><span /></div>}
          </div>
          <div className="row" style={{ marginTop: 'var(--sp-2)' }}><Boton onClick={sumar}>{T.sumar}</Boton></div>
        </>
      )}
      {error && <Aviso tone="error" style={{ marginTop: 'var(--sp-3)' }}>{error}</Aviso>}
    </div>
  )
}
