// Pantalla "Estadísticas" (antes "Tu colección"): estadísticas de la Música por década, género y formato, artistas con más discos y calidad de CD o mejor.
import { useEffect, useState } from 'react'
import type { CollectionStats } from '@paila/shared/types'
import { Anillo, Aviso, BarrasH, Cabecera, Columnas, PantallaVacia, Pestanas, Rico, colorNota, colorSerie } from '@paila/diseno'
import { textos, cant } from '@paila/shared/idioma'
import { GRADES, GRADE_HELP } from './problems'
import { bytes, n } from './format'
import logo from './assets/logo.png'

type Tab = 'calidad' | 'epocas' | 'artistas'

const pct = (a: number, b: number) => (b ? Math.round((a * 100) / b) : 0)

const T = textos({
  titulo: { es: 'Estadísticas', en: 'Stats' },
  sub: { es: 'Tu música por época, género, formato y artista.', en: 'Your music by era, genre, format and artist.' },
  vacioT: { es: 'Todavía no hay música para contar', en: 'No music to count yet' },
  vacio: { es: 'Cuando PAILA escanee tu carpeta de Música, acá vas a ver cómo está armada tu colección.', en: "Once PAILA scans your Music folder, you'll see here how your collection is put together." },
  intro: { es: (t: number, b: string) => `Así está armada tu carpeta de Música: ${n(t)} temas, ${b}. Solo cuenta lo que PAILA ve hoy (sin lo que está en la Papelera).`, en: (t: number, b: string) => `This is how your Music folder is put together: ${cant(t, 'track', 'tracks')}, ${b}. It only counts what PAILA sees today (not what's in the Trash).` },
  temas: { es: 'temas', en: 'tracks' },
  ocupan: { es: 'ocupan', en: 'take up' },
  cdTip: { es: 'Notas A+ y A: sin pérdida de verdad, como un CD o mejor.', en: 'Grades A+ and A: truly lossless, like a CD or better.' },
  cdLabel: { es: 'en calidad de CD o mejor', en: 'at CD quality or better' },
  cdDe: { es: (a: number, b: number) => `(${n(a)} de ${n(b)} analizados)`, en: (a: number, b: number) => `(${n(a)} of ${n(b)} analyzed)` },
  queMirar: { es: 'Qué mirar', en: 'What to look at' },
  tabCalidad: { es: 'Calidad y formatos', en: 'Quality and formats' },
  tabEpocas: { es: 'Épocas y géneros', en: 'Eras and genres' },
  tabArtistas: { es: 'Artistas', en: 'Artists' },
  cdTitulo: { es: 'Calidad de CD o mejor', en: 'CD quality or better' },
  cdInfo: { es: 'Calidad de CD: audio sin pérdida a 44,1 kHz y 16 bits, como el de un disco (nota A). Mejor que CD, o Hi-Res, es nota A+. Se mide escuchando el archivo, no mirando lo que dice su nombre.', en: "CD quality: lossless audio at 44.1 kHz and 16 bits, like a disc (grade A). Better than CD, or Hi-Res, is grade A+. It's measured by listening to the file, not by looking at what its name says." },
  notasCalidad: { es: 'Notas de calidad', en: 'Quality grades' },
  nota: { es: (g: string, ayuda: string) => `Nota ${g}: ${ayuda}`, en: (g: string, ayuda: string) => `Grade ${g}: ${ayuda}` },
  sinAnalizar: { es: 'Todavía no se analizó ningún tema: cuando termine el análisis, acá ves cuánto está en calidad de CD o mejor.', en: "No track has been analyzed yet: once the analysis is done, you'll see here how much is at CD quality or better." },
  hiRes: { es: (h: number, b: string, l: number) => `${n(h)} son Hi-Res (A+) y ocupan ${b} entre A+ y A. En total tenés ${n(l)} archivos sin pérdida (FLAC, WAV…), aunque no todos sean de calidad real.`, en: (h: number, b: string, l: number) => `${n(h)} ${h === 1 ? 'is' : 'are'} Hi-Res (A+) and ${h === 1 ? 'takes' : 'take'} up ${b} between A+ and A. In all you have ${cant(l, 'lossless file', 'lossless files')} (FLAC, WAV…), though not all of them are real quality.` },
  formatos: { es: 'Formatos', en: 'Formats' },
  formatosInfo: { es: 'El tipo de archivo. FLAC, WAV, AIFF y ALAC guardan el audio sin pérdida; MP3, AAC y Opus lo comprimen para que ocupe menos.', en: 'The file type. FLAC, WAV, AIFF and ALAC keep the audio lossless; MP3, AAC and Opus compress it so it takes up less space.' },
  porFormato: { es: 'Temas por formato', en: 'Tracks per format' },
  detalleTemas: { es: (l: string, t: number, b: string) => `${l}: ${n(t)} temas, ${b}`, en: (l: string, t: number, b: string) => `${l}: ${cant(t, 'track', 'tracks')}, ${b}` },
  decada: { es: 'Por década', en: 'By decade' },
  decadaInfo: { es: 'La década sale del año que dice el tag de cada tema.', en: "The decade comes from the year in each track's tag." },
  porDecada: { es: 'Temas por década', en: 'Tracks per decade' },
  sinAnio: { es: 'Ningún tema tiene año. Completalo en Completar desde internet.', en: 'No track has a year. Add it in Fill in from the internet.' },
  faltaAnio: { es: (k: number) => `${n(k)} temas no tienen año y no están en el gráfico.`, en: (k: number) => `${cant(k, 'track has', 'tracks have')} no year and ${k === 1 ? "isn't" : "aren't"} in the chart.` },
  generos: { es: 'Géneros', en: 'Genres' },
  generosInfo: { es: 'El género sale del tag de cada tema. Si dos se escriben distinto (Rock y rock), se cuentan juntos.', en: "The genre comes from each track's tag. If two are written differently (Rock and rock), they're counted together." },
  porGenero: { es: 'Temas por género', en: 'Tracks per genre' },
  otrosGeneros: { es: 'Otros géneros', en: 'Other genres' },
  sinGenero: { es: 'Ningún tema tiene género. Completalo en Completar desde internet.', en: 'No track has a genre. Add it in Fill in from the internet.' },
  faltaGenero: { es: (k: number) => `${n(k)} temas no tienen género y no están en el gráfico.`, en: (k: number) => `${cant(k, 'track has', 'tracks have')} no genre and ${k === 1 ? "isn't" : "aren't"} in the chart.` },
  porPais: { es: 'Por país', en: 'By country' },
  paisNo: { es: 'El país del artista todavía no está: los tags de tus archivos no lo traen y PAILA no lo averigua sola. Cuando lo sepa, va a aparecer acá.', en: "The artist's country isn't here yet: the tags in your files don't include it and PAILA can't find it out on its own. When it can, it will show up here." },
  masDiscos: { es: 'Artistas con más discos', en: 'Artists with the most albums' },
  masDiscosInfo: { es: 'Cuenta discos distintos (carpetas con el mismo álbum), no temas. Los compilados de Varios Artistas no cuentan para nadie.', en: "It counts different albums (folders with the same album), not tracks. Various Artists compilations don't count for anyone." },
  discosArtista: { es: 'Discos por artista', en: 'Albums per artist' },
  discos: { es: (v: number) => cant(v, 'disco', 'discos'), en: (v: number) => cant(v, 'album', 'albums') },
  detalleArtista: { es: (a: string, d: number, t: number) => `${a}: ${n(d)} discos, ${n(t)} temas`, en: (a: string, d: number, t: number) => `${a}: ${cant(d, 'album', 'albums')}, ${cant(t, 'track', 'tracks')}` },
  sinArtistas: { es: 'Todavía no hay artistas con álbum en los tags. Completalo en Completar desde internet.', en: 'No artists with an album in the tags yet. Add it in Fill in from the internet.' },
  deDonde: { es: 'De dónde son', en: 'Where they are from' },
  deDondeInfo: { es: 'El país de cada artista según MusicBrainz, una base de datos de música abierta. No está en tus archivos: PAILA lo trae cuando buscás los nombres oficiales en Completar desde internet, y solo lo dice si está seguro (si hay dos artistas con el mismo nombre de países distintos, no lo cuenta).', en: "Each artist's country according to MusicBrainz, an open music database. It isn't in your files: PAILA brings it in when you look up the official names in Fill in from the internet, and only says it when it's sure (if two artists with the same name come from different countries, it doesn't count it)." },
  porPaisArtista: { es: 'Temas por país del artista', en: 'Tracks per artist country' },
  seSabe: { es: (a: number, c: number, t: number) => `Se sabe el país de ${n(a)} artistas (${n(c)} de ${n(t)} temas).`, en: (a: number, c: number, t: number) => `The country is known for ${cant(a, 'artist', 'artists')} (${n(c)} of ${cant(t, 'track', 'tracks')}).` },
  sinPaises: { es: 'Todavía no se sabe de dónde son tus artistas. Se trae solo al buscar los nombres oficiales en **Completar desde internet** (no cambia tus archivos).', en: "We don't know yet where your artists are from. It's brought in on its own when you look up the official names in **Fill in from the internet** (it doesn't change your files)." },
})

export default function Stats() {
  const [s, setS] = useState<CollectionStats | null>(null)
  const [tab, setTab] = useState<Tab>('calidad')
  useEffect(() => { window.paila.collectionStats().then(setS) }, [])

  if (!s) return <div className="page"><div className="center"><div className="spinner" /></div></div>
  if (!s.tracks) {
    return <div className="page"><h2>{T.titulo}</h2><PantallaVacia imagen={logo} titulo={T.vacioT}>{T.vacio}</PantallaVacia></div>
  }

  const cd = s.cdOrBetter
  const missingYear = s.tracks - s.withYear, missingGenre = s.tracks - s.withGenre
  return (
    <div className="page stats">
      <Cabecera nivel={2} titulo={T.titulo} sub={T.sub} />
      <p className="muted">{T.intro(s.tracks, bytes(s.bytes))}</p>

      <div className="stat-kpis">
        <div className="tile"><b className="stat-big num">{n(s.tracks)}</b><span className="muted">{T.temas}</span></div>
        <div className="tile"><b className="stat-big num">{bytes(s.bytes)}</b><span className="muted">{T.ocupan}</span></div>
        <div className="tile" title={T.cdTip}>
          <b className="stat-big num">{cd.graded ? `${pct(cd.count, cd.graded)} %` : '–'}</b>
          <span className="muted">{T.cdLabel} <span className="small">{T.cdDe(cd.count, cd.graded)}</span></span>
        </div>
      </div>

      <Pestanas label={T.queMirar} value={tab} onChange={setTab} items={[
        { key: 'calidad', label: T.tabCalidad }, { key: 'epocas', label: T.tabEpocas }, { key: 'artistas', label: T.tabArtistas, count: s.topArtists.length || undefined },
      ]} />

      {tab === 'calidad' && (<>
        <Cabecera titulo={T.cdTitulo} info={T.cdInfo} />
        {cd.graded ? (
          <Anillo titulo={T.notasCalidad} centro={`${pct(cd.count, cd.graded)} %`}
            datos={GRADES.map((g) => ({ label: g, valor: s.byGrade[g] ?? 0, color: colorNota(g), detalle: T.nota(g, GRADE_HELP[g]) }))} />
        ) : <Aviso>{T.sinAnalizar}</Aviso>}
        {cd.graded > 0 && <p className="muted small">{T.hiRes(cd.hiRes, bytes(cd.bytes), cd.lossless)}</p>}

        <Cabecera titulo={T.formatos} info={T.formatosInfo} />
        <BarrasH titulo={T.porFormato} total={s.tracks} datos={s.formats.map((f, i) => ({ label: f.label, valor: f.tracks, color: colorSerie(i), detalle: T.detalleTemas(f.label, f.tracks, bytes(f.bytes)) }))} />
      </>)}

      {tab === 'epocas' && (<>
        <Cabecera titulo={T.decada} info={T.decadaInfo} />
        {s.decades.length ? <Columnas titulo={T.porDecada} datos={s.decades.map((d) => ({ label: d.label, valor: d.tracks, detalle: T.detalleTemas(d.label, d.tracks, bytes(d.bytes)) }))} /> : <Aviso>{T.sinAnio}</Aviso>}
        {s.decades.length > 0 && missingYear > 0 && <p className="muted small">{T.faltaAnio(missingYear)}</p>}

        <Cabecera titulo={T.generos} info={T.generosInfo} />
        {s.genres.length ? (
          <BarrasH titulo={T.porGenero} datos={[
            ...s.genres.map((g, i) => ({ label: g.label, valor: g.tracks, color: colorSerie(i), detalle: T.detalleTemas(g.label, g.tracks, bytes(g.bytes)) })),
            ...(s.genresOther ? [{ label: T.otrosGeneros, valor: s.genresOther, color: 'var(--texto-tenue)' }] : []),
          ]} />
        ) : <Aviso>{T.sinGenero}</Aviso>}
        {s.genres.length > 0 && missingGenre > 0 && <p className="muted small">{T.faltaGenero(missingGenre)}</p>}

        <Cabecera titulo={T.porPais} />
        <Aviso>{T.paisNo}</Aviso>
      </>)}

      {tab === 'artistas' && (<>
        <Cabecera titulo={T.masDiscos} info={T.masDiscosInfo} />
        {s.topArtists.length ? (
          <BarrasH titulo={T.discosArtista} formato={(v) => T.discos(v)} datos={s.topArtists.map((a) => ({ label: a.artist, valor: a.albums, detalle: T.detalleArtista(a.artist, a.albums, a.tracks) }))} />
        ) : <Aviso>{T.sinArtistas}</Aviso>}

        <Cabecera titulo={T.deDonde} info={T.deDondeInfo} />
        {s.countries.length ? (<>
          <BarrasH titulo={T.porPaisArtista} total={s.withCountry} datos={s.countries.map((c, i) => ({ label: c.label, valor: c.tracks, color: colorSerie(i), detalle: T.detalleTemas(c.label, c.tracks, bytes(c.bytes)) }))} />
          <p className="muted small">{T.seSabe(s.countryArtists, s.withCountry, s.tracks)}</p>
        </>) : <Aviso><Rico texto={T.sinPaises} /></Aviso>}
      </>)}
    </div>
  )
}
