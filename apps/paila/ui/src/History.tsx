// Pantalla Historial: todo lo que PAILA hizo en los archivos, tanda por tanda, con opción de deshacer.
import { Icon } from './icons'
import { useEffect, useMemo, useState } from 'react'
import type { HistoryDetail, HistoryEntry, HistoryKind, HistoryPunto } from '@paila/shared/types'
import { bytes, n } from './format'
import { conTeclado } from './conTeclado'
import { toast } from './toast'
import { Aviso, Pildora, Cabecera, Rico } from '@paila/diseno'
import { textos, cant, fecha, formato } from '@paila/shared/idioma'
import { ConfirmarBoton, Resultado, type ComoDeshacer, type ResultadoTanda } from './Confirmar'
import { papeleraCambio } from './papelera'
import HistoryVolver from './HistoryVolver'
import { AvisoCadena, X, botonCadena, extraResultado, preguntaCadena } from './historialCadena'

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')

const T = textos({
  k_tags: { es: "Tags y nombres", en: "Tags and names" },
  k_tagsAyuda: { es: "Cambios de tags, nombre de archivo, extensión o tapa (desde \"Cambios pendientes\")", en: "Changes to tags, file name, extension or cover (from \"Pending changes\")" },
  k_organizar: { es: "Organizar carpetas", en: "Organize folders" },
  k_organizarAyuda: { es: "Temas movidos a otras carpetas con Organizar carpetas", en: "Tracks moved to other folders with Organize folders" },
  k_papelera: { es: "Papelera", en: "Trash" },
  k_papeleraAyuda: { es: "Temas mandados a la papelera de PAILA (por ejemplo, duplicados). Siguen en tu disco y se pueden restaurar", en: "Tracks sent to PAILA's trash (duplicates, for example). They are still on your disk and can be restored" },
  k_limpieza: { es: "Limpieza", en: "Clean-up" },
  k_limpiezaAyuda: { es: "Archivos que no son música (videos, temporales, imágenes sueltas…) mandados a la papelera desde Espacio", en: "Files that aren't music (videos, temporary files, loose images…) sent to the trash from Space" },
  k_reemplazo: { es: "Reemplazo", en: "Replacement" },
  k_reemplazoAyuda: { es: "Un tema cambiado por otra versión del archivo. El archivo viejo quedó en la papelera", en: "A track swapped for another version of the file. The old file was left in the trash" },
  k_conversion: { es: "Conversión", en: "Conversion" },
  k_recorte: { es: 'Recorte de silencios', en: 'Silence trimming' },
  k_recorteAyuda: { es: 'Temas a los que se les recortó el silencio del principio o del final, sin perder calidad. El original quedó en la papelera', en: 'Tracks whose silence at the start or end was trimmed, without losing quality. The original is in the trash' },
  k_conversionAyuda: { es: "Temas pasados a otro formato (WAV/AIFF → FLAC para ahorrar espacio, o WMA/OGG → MP3/FLAC para Rekordbox). El original quedó en la papelera", en: "Tracks turned into another format (WAV/AIFF → FLAC to save space, or WMA/OGG → MP3/FLAC for Rekordbox). The original was left in the trash" },
  k_playlist: { es: "Mejorar playlist", en: "Improve playlist" },
  k_playlistAyuda: { es: "Temas de una playlist cambiados por una versión mejor que ya tenías. No toca archivos", en: "Tracks in a playlist swapped for a better version you already had. It does not touch any files" },
  k_pedido: { es: "Lista traída", en: "Imported list" },
  k_pedidoAyuda: { es: "Una lista de otro lado (un .csv, un texto pegado o un .m3u): se armó su playlist y lo que faltaba se sumó a la lista «Faltan o suenan mal». No toca archivos", en: "A list from somewhere else (a .csv, pasted text or an .m3u): its playlist was built and whatever was missing was added to the \"Missing or low quality\" list. It does not touch any files" },
  k_traidas: { es: "Traídas de Rekordbox", en: "Brought from Rekordbox" },
  k_traidasAyuda: { es: "Playlists traídas de tu rekordbox.xml o de un pendrive de CDJ: cada una se armó con lo que tenés y lo que faltaba se sumó a la lista «Faltan o suenan mal». Del pendrive, también la grilla y los cues. No toca archivos", en: "Playlists brought from your rekordbox.xml or a CDJ USB stick: each one was built with what you have, and whatever was missing was added to the \"Missing or low quality\" list. From the USB stick, the beat grid and cues too. It does not touch any files" },
  k_listas: { es: "Playlists", en: "Playlists" },
  k_listasAyuda: { es: "Playlists fusionadas en una sin repetidos, o limpiadas de temas repetidos en otra calidad. No toca archivos", en: "Playlists merged into one without repeats, or cleaned of tracks repeated in another quality. It does not touch any files" },
  k_vaciado: { es: "Vaciar papelera", en: "Empty trash" },
  k_vaciadoAyuda: { es: "Lo único que PAILA borra de verdad: los archivos que estaban en la papelera se borraron para siempre. No se puede deshacer", en: "The only thing PAILA really deletes: the files that were in the trash were deleted forever. This cannot be undone" },
  k_bandeja: { es: "De la Bandeja", en: "From the Inbox" },
  k_bandejaAyuda: { es: "Temas que llegaron a la Bandeja y no tenías, pasados a la carpeta Recibidos de tu Música. Deshacer los devuelve a la Bandeja", en: "Tracks that arrived in the Inbox and that you did not have, moved to the Recibidos folder of your Music. Undo puts them back in the Inbox" },
  k_comprimido: { es: "De un ZIP o RAR", en: "From a ZIP or RAR" },
  k_separar: { es: "Separar voz", en: "Separate vocals" },
  k_separarAyuda: { es: "La acapella y el instrumental que sacaste de un tema, en su carpeta. El tema quedó igual. Deshacer los manda a la papelera de PAILA", en: "The acapella and the instrumental you took from a track, in their folder. The track stayed the same. Undo sends them to PAILA’s trash" },
  k_comprimidoAyuda: { es: "La música de un ZIP o un RAR sacada a una carpeta al lado. El comprimido quedó igual. Deshacer manda lo sacado a la papelera de PAILA", en: "The music from a ZIP or RAR taken out into a folder next to it. The compressed file was left as it was. Undo sends what was taken out to PAILA's trash" },
  k_carpetas: { es: "Carpetas vacías", en: "Empty folders" },
  k_carpetasAyuda: { es: "Carpetas que habían quedado vacías en tu Música, sacadas desde Espacio. No tenían ningún archivo. Deshacer las vuelve a crear", en: "Folders that had been left empty in your Music, removed from Space. They had no files at all. Undo creates them again" },
  k_comprimidoPapelera: { es: "ZIP o RAR a la papelera", en: "ZIP or RAR to the trash" },
  k_comprimidoPapeleraAyuda: { es: "Un ZIP o RAR cuya música ya estaba toda afuera, mandado a la papelera de PAILA. Sigue en tu disco y se puede restaurar", en: "A ZIP or RAR whose music was already all outside, sent to PAILA's trash. It is still on your disk and can be restored" },
  fTodo: { es: 'Todo', en: 'Everything' },
  fTags: { es: 'Tags y nombres', en: 'Tags and names' },
  fCarpetas: { es: 'Carpetas', en: 'Folders' },
  fPapelera: { es: 'Papelera y limpieza', en: 'Trash and clean-up' },
  fReemp: { es: 'Reemplazos y conversiones', en: 'Replacements and conversions' },
  fPlaylists: { es: 'Playlists', en: 'Playlists' },
  fCopias: { es: 'Copias afuera', en: 'Copies outside' },
  respaldo: { es: (b: string) => `Respaldo de cómo estaban los archivos (${b}):`, en: (b: string) => `Backup of how the files were (${b}):` },
  respaldoDeshacer: { es: (b: string) => `Respaldo antes de deshacer (${b}):`, en: (b: string) => `Backup before undoing (${b}):` },
  respaldoCompleto: { es: (b: string) => `Copias completas de los archivos de antes (${b}):`, en: (b: string) => `Full copies of the files as they were (${b}):` },
  respaldoBorrado: { es: 'ya no está (se borró a mano)', en: 'gone (deleted by hand)' },
  todoBien: { es: 'Todo bien: mandar el respaldo a la papelera', en: 'All good: send the backup to the trash' },
  todoBienPreg: { es: (b: string) => `¿Está todo bien? Mandar este respaldo (${b}) a la papelera de PAILA.`, en: (b: string) => `Is everything fine? Send this backup (${b}) to PAILA's trash.` },
  todoBienAviso: {
    es: 'Mientras esté en la papelera, se recupera desde Configuración → Respaldos. Sin él, deshacer sigue funcionando (vuelven los tags de antes y el sonido no se toca), pero el archivo ya no queda idéntico byte a byte.',
    en: "While it's in the trash, it can be recovered from Settings → Backups. Without it, undo keeps working (the old tags come back and the sound isn't touched), but the file won't be identical byte for byte anymore.",
  },
  siBorrar: { es: 'Sí, a la papelera', en: 'Yes, to the trash' },
  respaldoBorradoOk: { es: (b: string) => `El respaldo está en la papelera de PAILA (${b}). El lugar se libera al vaciarla.`, en: (b: string) => `The backup is in PAILA's trash (${b}). The space is freed when you empty it.` },
  abrirCarpeta: { es: 'Abrir', en: 'Open' },
  k_copia: { es: 'Copia afuera', en: 'Copy outside' },
  k_copiaAyuda: { es: "Lo que PAILA copió afuera de tu Música: al pendrive, al celular o a otro programa (Rekordbox, Traktor, Serato, VirtualDJ, Engine DJ, listas .m3u8). Tu Música no se tocó", en: "What PAILA copied outside your Music: to a USB drive, a phone or another app (Rekordbox, Traktor, Serato, VirtualDJ, Engine DJ, .m3u8 playlists). Your Music wasn't touched" },
  restaurar: { es: 'Restaurar', en: 'Restore' },
  deshacer: { es: 'Deshacer', en: 'Undo' },
  deshacerElegidos: { es: (k: string) => `Deshacer los elegidos (${k})`, en: (k: string) => `Undo the chosen (${k})` },
  restaurarElegidos: { es: (k: string) => `Restaurar los elegidos (${k})`, en: (k: string) => `Restore the chosen (${k})` },
  preguntaElegidos: { es: (k: string) => `¿${k} las tandas elegidas, de la más nueva a la más vieja?`, en: (k: string) => `${k} the chosen batches, newest first?` },
  quitarEleccion: { es: 'Quitar la elección', en: 'Clear the choice' },
  elegirTip: { es: 'Elegir esta tanda para deshacerla junto con otras', en: 'Pick this batch to undo it along with others' },
  hoy: { es: 'Hoy', en: 'Today' },
  ayer: { es: 'Ayer', en: 'Yesterday' },
  seRestauraron: { es: (c: string) => `Se restauraron ${c}.`, en: (c: string) => `Restored ${c}.` },
  seDeshizoEn: { es: (c: string) => `Se deshizo en ${c}.`, en: (c: string) => `Undone in ${c}.` },
  deshizoParte: { es: 'Se deshizo una parte', en: 'Part of it was undone' },
  deshizoListo: { es: 'Listo, se deshizo', en: 'Done, it was undone' },
  titulo: { es: 'Historial', en: 'History' },
  sub: { es: 'Todo lo que PAILA hizo en tus archivos, con Deshacer en cada tanda.', en: 'Everything PAILA did to your files, with Undo on every batch.' },
  ayuda: {
    es: 'Todo lo que PAILA hizo en tus archivos, del más nuevo al más viejo: tags y nombres, carpetas, papelera, reemplazos y conversiones. Cada **tanda** (todo lo que se aplicó junto, de una vez) se puede deshacer entera. Si una tanda más nueva volvió a tocar los mismos temas, deshacer la vieja ofrece deshacer también esa, de una, para que nada quede a medias.',
    en: 'Everything PAILA did to your files, newest first: tags and names, folders, trash, replacements and conversions. Every **batch** (everything applied together, in one go) can be undone as a whole. If a newer batch touched the same tracks again, undoing the old one offers to undo that one too, in one go, so nothing is left half-done.',
  },
  nadaTipo: { es: 'No hay nada de este tipo todavía.', en: 'There is nothing of this kind yet.' },
  nadaTodavia: { es: 'Todavía no hiciste cambios en archivos con PAILA. Cuando apliques cambios de tags, organices carpetas, mandes algo a la papelera o reemplaces un tema, va a aparecer acá.', en: 'You have not made any changes to files with PAILA yet. When you apply tag changes, organize folders, send something to the trash or replace a track, it will show up here.' },
  cargando: { es: 'Cargando…', en: 'Loading…' },
  deshechoPil: { es: 'deshecho', en: 'undone' },
  deshechoTip: { es: 'Esta tanda ya se deshizo: los archivos volvieron a como estaban', en: 'This batch was already undone: the files went back to how they were' },
  ocultar: { es: 'Ocultar detalle', en: 'Hide details' },
  ver: { es: 'Ver detalle', en: 'See details' },
  noSePuede: { es: 'No se puede deshacer', en: "Can't be undone" },
  pregunta: { es: (a: string) => `¿${a} esta tanda?`, en: (a: string) => `${a} this batch?` },
  cTags: { es: (c: string) => `Se vuelven a escribir los datos de antes en ${c}.`, en: (c: string) => `The earlier data is written back to ${c}.` },
  cPlaylist: { es: 'La playlist vuelve a tener las versiones de antes.', en: 'The playlist gets its earlier versions back.' },
  cPedido: { es: 'Se borra la playlist del pedido y lo que sumó a la lista «Faltan o suenan mal» (si todavía no lo pediste). Tus archivos no se tocan.', en: 'The playlist from the request is deleted, along with what it added to the "Missing or low quality" list (if you have not asked for it yet). Your files are not touched.' },
  cTraidas: { es: 'Se borran esas playlists, lo que sumaron a la lista «Faltan o suenan mal» (si todavía no lo pediste) y la grilla y los cues que se recuperaron del pendrive. Tus archivos no se tocan.', en: 'Those playlists are deleted, along with what they added to the "Missing or low quality" list (if you have not asked for it yet) and the beat grid and cues recovered from the USB stick. Your files are not touched.' },
  cPapelera: { es: 'Los archivos vuelven a su lugar original.', en: 'The files go back to their original place.' },
  cOrganizar: { es: 'Los temas vuelven a sus carpetas de antes.', en: 'The tracks go back to their earlier folders.' },
  cBandeja: { es: 'Los temas vuelven a la Bandeja, a donde estaban.', en: 'The tracks go back to the Inbox, where they were.' },
  cSeparar: { es: 'La acapella y el instrumental van a la papelera de PAILA (si los cambiaste después, quedan). El tema original sigue igual.', en: "The acapella and the instrumental go to PAILA's trash (if you changed them afterwards, they stay). The original track stays as it is." },
  cComprimido: { es: 'Lo sacado va a la papelera de PAILA (lo que cambiaste después queda). El comprimido sigue igual.', en: "What was taken out goes to PAILA's trash (what you changed afterwards stays). The compressed file stays as it is." },
  cCarpetas: { es: 'Las carpetas vuelven a estar donde estaban, vacías.', en: 'The folders are back where they were, empty.' },
  cOtro: { es: 'Vuelve el archivo de antes (el nuevo queda en la papelera).', en: 'The earlier file comes back (the new one is left in the trash).' },
  deshaciendo: { es: 'Deshaciendo…', en: 'Undoing…' },
  siHacer: { es: (a: string) => `Sí, ${a.toLowerCase()}`, en: (a: string) => `Yes, ${a.toLowerCase()}` },
  vacio: { es: '(vacío)', en: '(empty)' },
  yMas: { es: (k: string) => `… y ${k} más`, en: (k: string) => `… and ${k} more` },
  temas: { es: (k: number) => cant(k, 'tema', 'temas'), en: (k: number) => cant(k, 'track', 'tracks') },
  archivos: { es: (k: number) => cant(k, 'archivo', 'archivos'), en: (k: number) => cant(k, 'file', 'files') },
})

const KIND: Record<HistoryKind, { label: string; pill: string; help: string }> = {
  aplicar: { get label() { return X.aplicar }, pill: 'pill-green', get help() { return X.aplicarAyuda } },
  tags: { get label() { return T.k_tags }, pill: 'pill-blue', get help() { return T.k_tagsAyuda } },
  organizar: { get label() { return T.k_organizar }, pill: 'pill-green', get help() { return T.k_organizarAyuda } },
  papelera: { get label() { return T.k_papelera }, pill: 'pill-amber', get help() { return T.k_papeleraAyuda } },
  limpieza: { get label() { return T.k_limpieza }, pill: 'pill-amber', get help() { return T.k_limpiezaAyuda } },
  reemplazo: { get label() { return T.k_reemplazo }, pill: 'pill-blue', get help() { return T.k_reemplazoAyuda } },
  recorte: { get label() { return T.k_recorte }, pill: 'pill-blue', get help() { return T.k_recorteAyuda } },
  conversion: { get label() { return T.k_conversion }, pill: 'pill-blue', get help() { return T.k_conversionAyuda } },
  playlist: { get label() { return T.k_playlist }, pill: 'pill-green', get help() { return T.k_playlistAyuda } },
  pedido: { get label() { return T.k_pedido }, pill: 'pill-green', get help() { return T.k_pedidoAyuda } },
  traidas: { get label() { return T.k_traidas }, pill: 'pill-green', get help() { return T.k_traidasAyuda } },
  listas: { get label() { return T.k_listas }, pill: 'pill-green', get help() { return T.k_listasAyuda } },
  vaciado: { get label() { return T.k_vaciado }, pill: 'pill-red', get help() { return T.k_vaciadoAyuda } },
  bandeja: { get label() { return T.k_bandeja }, pill: 'pill-green', get help() { return T.k_bandejaAyuda } },
  comprimido: { get label() { return T.k_comprimido }, pill: 'pill-green', get help() { return T.k_comprimidoAyuda } },
  'comprimido-papelera': { get label() { return T.k_comprimidoPapelera }, pill: 'pill-amber', get help() { return T.k_comprimidoPapeleraAyuda } },
  separar: { get label() { return T.k_separar }, pill: 'pill-green', get help() { return T.k_separarAyuda } },
  carpetas: { get label() { return T.k_carpetas }, pill: 'pill-accent', get help() { return T.k_carpetasAyuda } },
  copia: { get label() { return T.k_copia }, pill: 'pill-accent', get help() { return T.k_copiaAyuda } },
}

/** Filtros de arriba: cada uno junta uno o más tipos. */
const FILTERS: { key: string; label: string; kinds: HistoryKind[] | null }[] = [
  { key: 'all', get label() { return T.fTodo }, kinds: null },
  { key: 'tags', get label() { return T.fTags }, kinds: ['aplicar', 'tags'] },
  { key: 'moves', get label() { return T.fCarpetas }, kinds: ['aplicar', 'organizar', 'bandeja', 'comprimido', 'separar', 'carpetas'] },
  { key: 'trash', get label() { return T.fPapelera }, kinds: ['aplicar', 'papelera', 'limpieza', 'comprimido-papelera', 'vaciado'] },
  { key: 'rep', get label() { return T.fReemp }, kinds: ['reemplazo', 'conversion', 'recorte'] },
  { key: 'pl', get label() { return T.fPlaylists }, kinds: ['playlist', 'pedido', 'traidas', 'listas'] },
  { key: 'out', get label() { return T.fCopias }, kinds: ['copia'] },
]

const undoLabel = (k: HistoryKind) => (k === 'papelera' || k === 'limpieza' || k === 'comprimido-papelera' ? T.restaurar : T.deshacer)
/** Adónde va lo que se saca al deshacer: lo que el deshacer deja en la papelera de PAILA (el archivo nuevo, lo sacado de un comprimido). */
const alDeshacer = (k: HistoryKind): ComoDeshacer => (k === 'reemplazo' || k === 'conversion' || k === 'recorte' || k === 'comprimido' || k === 'separar' ? 'papelera' : 'atras')
/** Qué hace deshacer cada tipo de tanda (lo que se lee antes de decir que sí). */
const queHace = (e: HistoryEntry) => e.kind === 'aplicar' ? X.cAplicar : e.kind === 'tags' ? T.cTags(T.temas(e.files)) : e.kind === 'playlist' ? T.cPlaylist : e.kind === 'pedido' ? T.cPedido : e.kind === 'traidas' ? T.cTraidas : e.kind === 'papelera' || e.kind === 'limpieza' ? T.cPapelera : e.kind === 'organizar' ? T.cOrganizar : e.kind === 'bandeja' ? T.cBandeja : e.kind === 'comprimido' ? T.cComprimido : e.kind === 'separar' ? T.cSeparar : e.kind === 'carpetas' ? T.cCarpetas : T.cOtro

/** Cómo se deshace una tanda: lo mismo acá y en el "Deshacer lo último" de arriba (ChangesBar), para que pregunten igual. */
export function comoDeshacer(e: HistoryEntry): { boton: string; si: string; pregunta: string; aviso: string; deshacer: ComoDeshacer; restaura: boolean } {
  const boton = undoLabel(e.kind)
  return { boton, si: T.siHacer(boton), pregunta: T.pregunta(boton), aviso: queHace(e), deshacer: alDeshacer(e.kind), restaura: boton === T.restaurar }
}

function dayOf(iso: string): string {
  const d = new Date(iso), today = new Date()
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (same(d, today)) return T.hoy
  const y = new Date(today); y.setDate(today.getDate() - 1)
  if (same(d, y)) return T.ayer
  return fecha(d, { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

/** Historial único: todo lo que PAILA hizo en los archivos, del más nuevo al más viejo, con Deshacer por tanda. */
export default function History({ onChanged }: { onChanged: () => void }) {
  const [list, setList] = useState<HistoryEntry[] | null>(null)
  const [filter, setFilter] = useState('all')
  const [open, setOpen] = useState<string | null>(null)
  const [detail, setDetail] = useState<HistoryDetail | null>(null)
  const [working, setWorking] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [res, setRes] = useState<ResultadoTanda | null>(null)
  const [elegidas, setElegidas] = useState<Set<string>>(new Set())

  const load = async () => setList(await window.paila.history())
  useEffect(() => { load() }, [])
  // "Todo bien: borrar el respaldo" de una tanda (lo mismo que borrarlo en Configuración → Respaldos)
  const dropBackup = async (id: number) => {
    setMsg(null); setRes(null)
    try {
      const r = await window.paila.backupsDelete([id])
      setRes({ hechos: T.respaldoBorradoOk(bytes(r.bytes)), fallados: r.failed })
      await load(); papeleraCambio()
    } catch (err) { setMsg(clean(err)) }
  }

  const keyOf = (e: HistoryEntry) => `${e.kind}:${e.id}`
  const shown = useMemo(() => {
    const kinds = FILTERS.find((f) => f.key === filter)?.kinds
    return (list ?? []).filter((e) => !kinds || kinds.includes(e.kind))
  }, [list, filter])
  const days = useMemo(() => {
    const m = new Map<string, HistoryEntry[]>()
    for (const e of shown) { const d = dayOf(e.at); m.set(d, [...(m.get(d) ?? []), e]) }
    return [...m.entries()]
  }, [shown])

  const toggle = async (e: HistoryEntry) => {
    const k = keyOf(e)
    if (open === k) { setOpen(null); return }
    setOpen(k); setDetail(null)
    setDetail(await window.paila.historyDetail(e.kind, e.id))
  }

  // con cadena: lo que vino después y la toca se deshace antes, de una (core/history-cadena.ts)
  const undo = async (e: HistoryEntry) => {
    setBusy(true); setWorking(keyOf(e)); setMsg(null); setRes(null)
    try {
      const r = e.cadena?.length ? await window.paila.historyUndoCadena(e.kind, e.id) : await window.paila.historyUndo(e.kind, e.id)
      const cuantos = e.kind === 'limpieza' ? T.archivos(r.done) : T.temas(r.done)
      const what = (e.kind === 'papelera' || e.kind === 'limpieza') && !e.cadena?.length ? T.seRestauraron(cuantos) : T.seDeshizoEn(cuantos)
      setRes({ hechos: what + extraResultado(r), fallados: r.failed })
      toast(r.failed.length ? T.deshizoParte : T.deshizoListo, r.failed.length ? 'info' : 'ok')
      onChanged()
      await load()
      if (open === keyOf(e)) setDetail(await window.paila.historyDetail(e.kind, e.id))
    } catch (err) { setMsg(clean(err)) } finally { setBusy(false); setWorking(null) }
  }

  const restaura = (e: HistoryEntry) => comoDeshacer(e).restaura
  const aDeshacer = (list ?? []).filter((e) => elegidas.has(keyOf(e)) && e.canUndo && !e.undone)
  const todasRestauran = aDeshacer.length > 0 && aDeshacer.every(restaura)
  const arrastra = new Set(aDeshacer.flatMap((e) => (e.cadena ?? []).map((c) => `${c.kind}:${c.id}`)).filter((k) => !elegidas.has(k))).size
  const volver = async (p: HistoryPunto) => {
    setBusy(true); setMsg(null); setRes(null)
    try {
      const r = await window.paila.historyVolver(p.tanda)
      setRes({ hechos: T.seDeshizoEn(T.temas(r.done)) + extraResultado(r), fallados: r.failed })
      toast(r.failed.length ? T.deshizoParte : T.deshizoListo, r.failed.length ? 'info' : 'ok'); onChanged()
    } catch (err) { setMsg(clean(err)) } finally { setBusy(false); await load() }
  }
  const undoElegidas = async () => {
    setBusy(true); setMsg(null); setRes(null)
    let hechos = 0
    const fallados: { rel: string; error: string }[] = []
    try {
      for (const e of aDeshacer) {
        const r = await window.paila.historyUndoCadena(e.kind, e.id)
        hechos += r.done; fallados.push(...r.failed)
        if (r.failed.length) break // nada a medias: las más viejas esperan
      }
      setRes({ hechos: T.seDeshizoEn(T.temas(hechos)), fallados })
      toast(fallados.length ? T.deshizoParte : T.deshizoListo, fallados.length ? 'info' : 'ok')
      setElegidas(new Set()); onChanged()
    } catch (err) { setMsg(clean(err)) } finally { setBusy(false); await load() }
  }
  const elegir = (e: HistoryEntry, on: boolean) => setElegidas((x) => { const t = new Set(x); on ? t.add(keyOf(e)) : t.delete(keyOf(e)); return t })

  return (
    <div className="page">
      <Cabecera nivel={2} titulo={T.titulo} sub={T.sub} ayuda={<Rico texto={T.ayuda} />} />
      <div className="tabs">
        {FILTERS.map((f) => {
          const c = f.kinds ? (list ?? []).filter((e) => f.kinds!.includes(e.kind)).length : (list ?? []).length
          return <button key={f.key} className={`tab ${filter === f.key ? 'on' : ''}`} onClick={() => setFilter(f.key)}>{f.label}{list ? ` (${n(c)})` : ''}</button>
        })}
      </div>
      {msg && <Aviso>{msg}</Aviso>}
      {res && <Resultado r={res} />}
      {elegidas.size > 0 && (
        <div className="actionbar">
          <ConfirmarBoton disabled={busy || !aDeshacer.length} onSi={undoElegidas} deshacer="atras" si={T.siHacer(todasRestauran ? T.restaurar : T.deshacer)}
            pregunta={T.preguntaElegidos(todasRestauran ? T.restaurar : T.deshacer)} aviso={arrastra ? <span className="small">{X.tambien(arrastra)}</span> : undefined}>{busy ? T.deshaciendo : (todasRestauran ? T.restaurarElegidos : T.deshacerElegidos)(n(aDeshacer.length))}</ConfirmarBoton>
          <button className="link small" onClick={() => setElegidas(new Set())}>{T.quitarEleccion}</button>
        </div>
      )}
      <HistoryVolver version={list} busy={busy} onVolver={volver} />
      {list && !shown.length && <p className="muted">{list.length ? T.nadaTipo : T.nadaTodavia}</p>}
      {!list && <p className="muted">{T.cargando}</p>}

      {days.map(([day, es]) => (
        <div key={day}>
          <h4 className="hist-day">{day}</h4>
          <div className="lista-filas">{es.map((e) => {
            const k = keyOf(e)
            return (
              <div key={k} className={`box ${e.undone ? 'skipped' : ''}`}>
                <div className="box-head clicable" title={open === k ? T.ocultar : T.ver} {...conTeclado(() => toggle(e))} onClick={(ev) => { if (!(ev.target as HTMLElement).closest('button, a, input, .confirmar')) toggle(e) }}>
                  {!e.undone && e.canUndo && <input type="checkbox" checked={elegidas.has(k)} disabled={busy} title={T.elegirTip} aria-label={T.elegirTip} onChange={(ev) => elegir(e, ev.target.checked)} />}
                  <span className={`pill ${KIND[e.kind].pill}`} style={{ marginLeft: 0 }} title={KIND[e.kind].help}>{KIND[e.kind].label}</span>
                  <b className="hist-sum">{e.summary}</b>
                  <span className="muted small">{new Date(e.at).toLocaleTimeString(formato(), { hour: '2-digit', minute: '2-digit' })}</span>
                  {e.undone && <Pildora title={T.deshechoTip}>{T.deshechoPil}</Pildora>}
                  <span className="push-right" />
                  <button className="link" aria-label={open === k ? T.ocultar : T.ver} title={open === k ? T.ocultar : T.ver} onClick={() => toggle(e)}><Icon name="chevron" size={13} className={open === k ? 'abierto' : ''} /></button>
                  {!e.undone && !e.canUndo && <span className="muted small" title={e.whyNot ?? ''}>{T.noSePuede} <span className="info">ⓘ</span></span>}
                </div>
                {!e.undone && e.whyNot && <div className="hist-note muted small">{e.whyNot}</div>}
                {e.note && <div className="hist-note"><span className="warn-inline small"><Icon name="alert" size={13} className="ic-inline" /> {e.note}</span></div>}
                {e.backups?.map((b) => (
                  <div key={b.dir} className="hist-note muted small">
                    {(b.op === 'deshacer-tags' ? T.respaldoDeshacer : b.light ? T.respaldo : T.respaldoCompleto)(bytes(b.bytes))} <span title={b.dir}>{b.dir}</span>{' '}
                    {b.exists ? <button className="link" onClick={() => window.paila.openFolder(b.dir)}>{T.abrirCarpeta}</button> : <span>· {T.respaldoBorrado}</span>}
                    {/* la oferta de limpieza: nunca se borran solos, la persona confirma que está todo bien */}
                    {b.exists && <> <ConfirmarBoton variant="ghost" size="sm" deshacer="respaldos" disabled={busy} si={T.siBorrar} pregunta={T.todoBienPreg(bytes(b.bytes))}
                      aviso={b.op === 'tags' ? <span className="small">{T.todoBienAviso}</span> : undefined} onSi={() => dropBackup(b.id)}>{T.todoBien}</ConfirmarBoton></>}
                  </div>
                ))}
                {open === k && (
                  <div className="hist-detail">
                    {!e.undone && e.canUndo && (
                      <div className="row">
                        {e.cadena?.length ? <ConfirmarBoton variant="ghost" size="sm" disabled={busy} onSi={() => undo(e)} deshacer="atras" si={T.siHacer(T.deshacer)}
                          pregunta={preguntaCadena(e)} aviso={<AvisoCadena e={e} queHace={queHace(e)} />}>{working === k ? T.deshaciendo : botonCadena(e)}</ConfirmarBoton>
                          : <ConfirmarBoton variant="ghost" size="sm" disabled={busy} onSi={() => undo(e)} deshacer={alDeshacer(e.kind)} si={T.siHacer(undoLabel(e.kind))}
                          pregunta={T.pregunta(undoLabel(e.kind))} aviso={<span className="small">{queHace(e)}</span>}>{working === k ? T.deshaciendo : undoLabel(e.kind)}</ConfirmarBoton>}
                      </div>
                    )}
                    {!detail ? <div className="muted small hist-row">{T.cargando}</div> : detail.rows.map((r, i) => (
                      <div key={i} className={`hist-row ${r.undone ? 'is-undone' : ''}`}>
                        <span className="ellipsis" title={r.folder ? `${r.folder}/${r.name}` : r.name}><b>{r.name}</b> {r.folder && <span className="muted small">{r.folder}</span>}</span>
                        <span className="muted small">{r.what}</span>
                        <span className="ellipsis small" title={r.before != null || r.after != null ? `${r.before ?? T.vacio} → ${r.after ?? T.vacio}` : ''}>
                          {(r.before != null || r.after != null) && <><span className="muted">{r.before ?? T.vacio}</span> → {r.after ?? T.vacio}</>}
                          {r.undone && <Pildora>{T.deshechoPil}</Pildora>}
                        </span>
                      </div>
                    ))}
                    {detail && detail.total > detail.rows.length && <div className="muted small hist-row">{T.yMas(n(detail.total - detail.rows.length))}</div>}
                  </div>
                )}
              </div>
            )
          })}</div>
        </div>
      ))}
    </div>
  )
}
