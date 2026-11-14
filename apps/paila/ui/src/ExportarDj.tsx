// Exportar a Traktor, Serato, VirtualDJ y Engine DJ (la parte de Rekordbox.tsx que cambia según el programa): dónde va a
// escribir, si el programa está abierto, lo que salió y la guía paso a paso para abrirlo del otro lado.
import { useEffect, useState } from 'react'
import type { DjApp, DjExportResult } from '@paila/shared/types'
import { textos, num, plural } from '@paila/shared/idioma'
import { Aviso, Info, Rico } from '@paila/diseno'
import { Resultado } from './Confirmar'

export type ExportApp = 'rekordbox' | DjApp
export const APPS: { key: ExportApp; label: string }[] = [
  { key: 'rekordbox', label: 'Rekordbox' }, { key: 'traktor', label: 'Traktor' }, { key: 'serato', label: 'Serato' }, { key: 'virtualdj', label: 'VirtualDJ' },
  { key: 'engine', label: 'Engine DJ' },
]
export const NOT_READ = textos({
  rekordbox: { es: 'Los formatos que Rekordbox no lee (WMA, OGG, Opus) no entran.', en: 'Formats Rekordbox can\'t read (WMA, OGG, Opus) are left out.' },
  traktor: { es: 'Traktor no lee WMA ni Opus: esos no entran.', en: 'Traktor can\'t read WMA or Opus: those are left out.' },
  serato: { es: 'Serato no lee WMA ni Opus: esos no entran.', en: 'Serato can\'t read WMA or Opus: those are left out.' },
  virtualdj: { es: 'VirtualDJ lee casi todo: entran todos tus temas.', en: 'VirtualDJ reads almost everything: all your tracks go in.' },
  engine: { es: 'Engine DJ no lee WMA ni Opus: esos no entran.', en: 'Engine DJ can\'t read WMA or Opus: those are left out.' },
})
export const TIP_DENTRO = textos({
  tip: {
    es: 'Serato guarda la grilla y los cues adentro de cada archivo de música (no en una base aparte). PAILA los prepara en Cambios pendientes: los revisás, los aplicás y se pueden deshacer. Los temas que ya tienen marcas de Serato no se tocan.',
    en: 'Serato stores the beat grid and cues inside each music file (not in a separate database). PAILA prepares them in Pending changes: you review them, apply them, and they can be undone. Tracks that already have Serato markers are not touched.',
  },
})

const T = textos({
  seGuarda: {
    es: (otro: string) => `Se guarda en {carpeta} (${otro}). Lo que había antes de PAILA se copia aparte primero, en {respaldos}.`,
    en: (otro: string) => `It is saved in {carpeta} (${otro}). What was there before PAILA is copied aside first, into {respaldos}.`,
  },
  otroSerato: { es: 'para los temas de otro disco, en la carpeta _Serato_ de ese disco', en: 'for tracks on another drive, in the _Serato_ folder on that drive' },
  otroVdj: { es: 'para los temas de otro disco, en la carpeta VirtualDJ de ese disco', en: 'for tracks on another drive, in the VirtualDJ folder on that drive' },
  otroEngine: {
    es: 'como hace Engine: los temas de cada disco, en la carpeta Engine Library de ese disco; las playlists, en la de esta compu',
    en: "like Engine does: each drive's tracks in that drive's Engine Library folder; playlists in this computer's",
  },
  creada: {
    es: 'Se armó la biblioteca de Engine de {b}, igual a la que arma Engine al importar temas de ese disco.',
    en: "Engine's library for {b} was created, the same one Engine creates when you import tracks from that drive.",
  },
  faltaEngine: {
    es: 'Todavía no está la biblioteca de Engine DJ: abrí Engine DJ una vez y cerralo (así la crea), y después exportá.',
    en: "The Engine DJ library isn't there yet: open Engine DJ once and close it (that creates it), then export.",
  },
  abierto: {
    es: (app: string) => `${app} está abierto: cerralo antes de exportar (al cerrarse vuelve a guardar su base y se perdería lo de PAILA).`,
    en: (app: string) => `${app} is open: close it before exporting (when it closes it saves its database again and PAILA's changes would be lost).`,
  },
  guardoCon: {
    es: (main: string, t: number, p: number, g: number, c: number) => `Se guardó ${main} con ${num(t)} temas y ${num(p)} playlists (${num(g)} con grilla, ${num(c)} con cue points).`,
    en: (main: string, t: number, p: number, g: number, c: number) => `Saved ${main} with ${num(t)} ${plural(t, 'track', 'tracks')} and ${num(p)} ${plural(p, 'playlist', 'playlists')} (${num(g)} with beat grid, ${num(c)} with cue points).`,
  },
  escribieronCon: {
    es: (main: string, t: number, p: number, g: number, c: number) => `Listo: se escribieron ${main} con ${num(t)} temas y ${num(p)} playlists (${num(g)} con grilla, ${num(c)} con cue points).`,
    en: (main: string, t: number, p: number, g: number, c: number) => `Done: ${main} written, with ${num(t)} ${plural(t, 'track', 'tracks')} and ${num(p)} ${plural(p, 'playlist', 'playlists')} (${num(g)} with beat grid, ${num(c)} with cue points).`,
  },
  archivos: { es: (k: number) => `${num(k)} archivos`, en: (k: number) => `${num(k)} ${plural(k, 'file', 'files')}` },
  simplificados: {
    es: (k: number) => `${num(k)} temas tienen la grilla que cambia de tempo {info}: van con un solo BPM.`,
    en: (k: number) => `${num(k)} ${plural(k, 'track has', 'tracks have')} a beat grid that changes tempo {info}: ${k === 1 ? 'it goes' : 'they go'} with a single BPM.`,
  },
  simplificadosTip: {
    es: 'Este programa acepta un solo BPM por tema: esos van con el BPM general y la grilla arranca en el primer tiempo fuerte. En los temas tocados sin metrónomo puede correrse un poco hacia el final.',
    en: 'This program accepts a single BPM per track: those go with the overall BPM and the grid starts on the first strong beat. In tracks played without a metronome it may drift a little toward the end.',
  },
  conservados: {
    es: (k: number, app: string) => `${num(k)} temas ya tenían grilla o cues tuyos en ${app}: quedaron como estaban.`,
    en: (k: number, app: string) => `${num(k)} ${plural(k, 'track already had', 'tracks already had')} your beat grid or cues in ${app}: ${k === 1 ? 'it was' : 'they were'} left as they were.`,
  },
  enPendientes: {
    es: (k: number) => `**${num(k)}** temas quedaron en **Cambios pendientes** con su grilla y sus cues para Serato: revisalos y aplicalos en la barra de abajo (se pueden deshacer). `,
    en: (k: number) => `**${num(k)}** ${plural(k, 'track is', 'tracks are')} in **Pending changes** with ${k === 1 ? 'its' : 'their'} beat grid and cues for Serato: review and apply ${k === 1 ? 'it' : 'them'} in the bar at the bottom (they can be undone). `,
  },
  ningunoAdentro: { es: 'Ningún tema para escribir adentro. ', en: 'No tracks to write inside. ' },
  yaTenian: {
    es: (k: number) => `${num(k)} ya tenían marcas de Serato: no se tocan.`,
    en: (k: number) => `${num(k)} already had Serato markers: ${k === 1 ? 'it is' : 'they are'} not touched.`,
  },
  copiadoEn: { es: 'Lo de antes quedó copiado en {b}.', en: 'What was there before was copied to {b}.' },
  // guías paso a paso
  tk1: { es: 'Abrí Traktor y, en el panel de la izquierda, hacé clic derecho sobre **Track Collection**.', en: 'Open Traktor and, in the left panel, right-click **Track Collection**.' },
  tk2: { es: 'Elegí **Import another Collection** y buscá el archivo {nml} que guardaste.', en: 'Choose **Import another Collection** and find the {nml} file you saved.' },
  tk3: { es: 'Si Traktor pregunta qué datos usar, elegí los de la colección (así entran la grilla y los cues de PAILA).', en: 'If Traktor asks which data to use, choose the collection\'s (that way PAILA\'s beat grid and cues come in).' },
  tk4: {
    es: 'Tus playlists aparecen en **Playlists**. Si Traktor vuelve a analizar los temas, que no toque el BPM ni la grilla: activá el candado (Lock) o analizá sin BPM.',
    en: 'Your playlists show up under **Playlists**. If Traktor analyzes the tracks again, make sure it doesn\'t touch the BPM or the grid: turn on the lock (Lock) or analyze without BPM.',
  },
  tk5: { es: 'Si cambiás playlists en PAILA, exportá de nuevo e importalo otra vez: Traktor actualiza lo que ya tenía.', en: 'If you change playlists in PAILA, export again and import it again: Traktor updates what it already had.' },
  se1: { es: 'Cerrá Serato y exportá desde acá: las crates {info} quedan dentro de una crate **PAILA**, así no se mezclan con las tuyas.', en: 'Close Serato and export from here: the crates {info} go inside a **PAILA** crate, so they don\'t get mixed with yours.' },
  crateTip: { es: 'Crate: así le dice Serato a una playlist.', en: 'Crate: Serato\'s name for a playlist.' },
  se2: { es: 'Si marcaste la grilla y los cues, aplicá los cambios en **Cambios pendientes** antes de abrir Serato.', en: 'If you ticked the beat grid and cues, apply the changes in **Pending changes** before opening Serato.' },
  se3: { es: 'Abrí Serato: en **Crates** aparece **PAILA** con tus playlists adentro.', en: 'Open Serato: under **Crates** you will see **PAILA** with your playlists inside.' },
  se4: { es: 'El BPM y la grilla vienen con los temas; si Serato pide analizarlos, analizá solo lo que no tiene grilla.', en: 'The BPM and beat grid come with the tracks; if Serato asks to analyze them, only analyze what has no grid.' },
  se5: { es: 'Si cambiás playlists en PAILA, cerrá Serato y exportá de nuevo: las crates de PAILA se reemplazan (las de antes quedan copiadas).', en: 'If you change playlists in PAILA, close Serato and export again: the PAILA crates are replaced (the old ones stay copied).' },
  vd1: { es: 'Cerrá VirtualDJ y exportá desde acá: PAILA completa su base con el BPM, el tono, la grilla y los cues.', en: 'Close VirtualDJ and export from here: PAILA fills in its database with the BPM, key, beat grid and cues.' },
  vd2: {
    es: 'Abrí VirtualDJ: tus playlists están en **Mis Listas**, las que empiezan con **"PAILA - "** (VirtualDJ no tiene carpetas ahí: el nombre lleva la carpeta).',
    en: 'Open VirtualDJ: your playlists are under **MyLists**, the ones starting with **"PAILA - "** (VirtualDJ has no folders there: the name carries the folder).',
  },
  vd3: { es: 'Los temas que ya tenían cues tuyos en VirtualDJ quedan como estaban.', en: 'Tracks that already had your cues in VirtualDJ are left as they were.' },
  en1: {
    es: 'Si nunca abriste Engine DJ en esta compu, abrilo una vez y cerralo: así crea su biblioteca (PAILA no la crea, la completa).',
    en: "If you've never opened Engine DJ on this computer, open it once and close it: that creates its library (PAILA doesn't create it, it fills it in).",
  },
  en2: {
    es: 'Con Engine DJ cerrado, exportá desde acá: PAILA le suma el BPM, el tono, la grilla y los cues, y tus playlists quedan dentro de una playlist **PAILA**.',
    en: 'With Engine DJ closed, export from here: PAILA adds the BPM, key, beat grid and cues, and your playlists go inside a **PAILA** playlist.',
  },
  en3: {
    es: 'Abrí Engine DJ: en **Playlists** está **PAILA**. Engine analiza los temas nuevos para dibujar su onda; la grilla de PAILA va con candado {info}, así no la cambia.',
    en: "Open Engine DJ: **PAILA** is under **Playlists**. Engine analyzes the new tracks to draw their waveform; PAILA's beat grid goes locked {info}, so it won't change it.",
  },
  candadoTip: {
    es: 'Candado (beatgrid lock): Engine no mueve una grilla trabada cuando analiza. Si querés cambiarla en Engine, destrabala ahí.',
    en: "Lock (beatgrid lock): Engine doesn't move a locked grid when it analyzes. If you want to change it in Engine, unlock it there.",
  },
  en4: {
    es: 'Los hot cues van a los 8 pads y los loops, a los loops guardados. Engine no tiene memory cues: el primero queda como el cue principal (el botón **CUE**).',
    en: 'Hot cues go to the 8 pads and loops to the saved loops. Engine has no memory cues: the first one becomes the main cue (the **CUE** button).',
  },
  en5: {
    es: 'Si tu música está en un disco de afuera, sus temas quedan en la carpeta **Engine Library** de ese disco, como los deja Engine. Abrí Engine DJ una vez con el disco conectado (copia solo las playlists al disco) y ya podés tocar con ese disco en los equipos, sin compu. Para un pendrive aparte, en Engine DJ arrastrá la playlist **PAILA** al pendrive.',
    en: "If your music is on an external drive, its tracks go in that drive's **Engine Library** folder, the way Engine leaves them. Open Engine DJ once with the drive connected (it copies the playlists to the drive by itself) and you can play from that drive on the gear, no computer needed. For a separate USB stick, drag the **PAILA** playlist to it in Engine DJ.",
  },
  en6: {
    es: 'Los temas que ya tenían grilla o cues tuyos en Engine quedan como estaban. Si algo no te gusta, en la carpeta {respaldos} de cada biblioteca está su carpeta {db} como era antes: con Engine DJ cerrado, copiala de vuelta.',
    en: "Tracks that already had your beat grid or cues in Engine are left as they were. If you don't like something, each library's {respaldos} folder has its {db} folder as it was before: with Engine DJ closed, copy it back.",
  },
  vd4: { es: 'Si algo no te gusta, en la carpeta {respaldos} está la base como era antes: con VirtualDJ cerrado, copiala de vuelta.', en: 'If you don\'t like something, the {respaldos} folder has the database as it was before: with VirtualDJ closed, copy it back.' },
})

const NAME: Record<DjApp, string> = { traktor: 'Traktor', serato: 'Serato', virtualdj: 'VirtualDJ', engine: 'Engine DJ' }
/** La carpeta de la base de Engine DJ: un nombre de carpeta, no se traduce. */
const DB_DIR = 'Database2' // idioma-ok

/** Dónde va a escribir Serato, VirtualDJ o Engine DJ, si hay que cerrarlo antes y si a Engine le falta su biblioteca. */
export function DjPlace({ app }: { app: DjApp }) {
  const [p, setP] = useState<{ folder: string | null; running: boolean; missing?: boolean } | null>(null)
  useEffect(() => { setP(null); window.paila.djExportPlace(app).then(setP).catch(() => setP(null)) }, [app])
  if (!p || app === 'traktor') return null
  const otro = app === 'serato' ? T.otroSerato : app === 'engine' ? T.otroEngine : T.otroVdj
  return (
    <>
      {p.folder && <p className="muted small"><Rico texto={T.seGuarda(otro)} partes={{ carpeta: <code>{p.folder}</code>, respaldos: <code>PAILA-respaldos</code> }} /></p>}
      {p.missing && <Aviso tone="atencion">{T.faltaEngine}</Aviso>}
      {p.running && <Aviso tone="atencion">{T.abierto(NAME[app])}</Aviso>}
    </>
  )
}

/** Lo que salió de exportar a otro programa: lo hecho, lo que no entró (con su motivo) y los avisos del programa. */
export function DjResult({ r }: { r: DjExportResult }) {
  const main = r.app === 'traktor' ? r.written[0] : r.written.length ? T.archivos(r.written.length) : T.archivos(0)
  return (
    <Resultado r={{
      hechos: (r.app === 'traktor' ? T.guardoCon : T.escribieronCon)(main, r.tracks, r.playlists, r.grids, r.cues),
      fallados: r.skipped.map((s) => ({ rel: s.rel, error: s.reason })),
      deshacer: 'copias',
      extra: (<>
        {r.simplified > 0 && <div className="small"><Rico texto={T.simplificados(r.simplified)} partes={{ info: <Info tip={T.simplificadosTip} /> }} /></div>}
        {r.kept != null && r.kept > 0 && <div className="small">{T.conservados(r.kept, NAME[r.app])}</div>}
        {r.created?.map((c) => <div key={c} className="small"><Rico texto={T.creada} partes={{ b: <code>{c}</code> }} /></div>)}
        {r.staged != null && <div className="small">{r.staged ? <Rico texto={T.enPendientes(r.staged)} /> : T.ningunoAdentro}{r.alreadyIn ? T.yaTenian(r.alreadyIn) : ''}</div>}
        {r.backups.length > 0 && <div className="small muted"><Rico texto={T.copiadoEn} partes={{ b: <>{r.backups.map((b) => <code key={b}>{b}</code>)}</> }} /></div>}
      </>),
    }} />
  )
}

/** Cómo abrirlo del otro lado, paso a paso. */
export function DjGuide({ app }: { app: DjApp }) {
  if (app === 'traktor') return (
    <ol className="guide">
      <li><Rico texto={T.tk1} /></li>
      <li><Rico texto={T.tk2} partes={{ nml: <code>.nml</code> }} /></li>
      <li>{T.tk3}</li>
      <li><Rico texto={T.tk4} /></li>
      <li>{T.tk5}</li>
    </ol>
  )
  if (app === 'serato') return (
    <ol className="guide">
      <li><Rico texto={T.se1} partes={{ info: <Info tip={T.crateTip} /> }} /></li>
      <li><Rico texto={T.se2} /></li>
      <li><Rico texto={T.se3} /></li>
      <li>{T.se4}</li>
      <li>{T.se5}</li>
    </ol>
  )
  if (app === 'engine') return (
    <ol className="guide">
      <li>{T.en1}</li>
      <li><Rico texto={T.en2} /></li>
      <li><Rico texto={T.en3} partes={{ info: <Info tip={T.candadoTip} /> }} /></li>
      <li><Rico texto={T.en4} /></li>
      <li><Rico texto={T.en5} /></li>
      <li><Rico texto={T.en6} partes={{ respaldos: <code>PAILA-respaldos</code>, db: <code>{DB_DIR}</code> }} /></li>
    </ol>
  )
  return (
    <ol className="guide">
      <li>{T.vd1}</li>
      <li><Rico texto={T.vd2} /></li>
      <li>{T.vd3}</li>
      <li><Rico texto={T.vd4} partes={{ respaldos: <code>PAILA-respaldos</code> }} /></li>
    </ol>
  )
}
