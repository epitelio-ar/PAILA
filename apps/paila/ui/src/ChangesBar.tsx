// La barra de arriba (una sola, repaso del 27/10): los avisos del escaneo, lo que vas a aplicar y Deshacer lo último. Ver el antes y el después, aplicar con avance en vivo, descartar, y deshacer lo último que hizo PAILA
// (la última tanda del Historial, de cualquier tipo), diciendo qué es y cuándo fue. Desde la etapa 2 del MASTERPLAN-5 es la lista única:
// también lo que va a la papelera y lo que se mueve, con un solo Aplicar que lo hace en orden (core/aplicar.ts).
import { useEffect, useState } from 'react'
import type { ApplyResult, BackupPlan, HistoryEntry, HistoryUndoResult, PendingChange } from '@paila/shared/types'
import { JobPanel, useJob } from './jobs'
import { bytes, n } from './format'
import { toast } from './toast'
import { Boton, Rico } from '@paila/diseno'
import { textos, cant, plural, formato, idioma } from '@paila/shared/idioma'
import { comoDeshacer } from './History'
import { ConfirmarBoton, Resultado, type ResultadoTanda } from './Confirmar'

const T = textos({
  papelera: { es: 'A la papelera', en: 'To the trash' },
  reemplazo: { es: 'Copia mejor', en: 'Better copy' },
  mover: { es: 'Lugar nuevo', en: 'New place' },
  trim: { es: 'Silencio al empezar o al terminar', en: 'Silence at the start or end' },
  cover: { es: 'Tapa', en: 'Cover' },
  folderCover: { es: 'cover.jpg de la carpeta', en: 'Folder cover.jpg' },
  replaygain: { es: 'Volumen parejo (ReplayGain)', en: 'Even volume (ReplayGain)' },
  comment: { es: 'Comentario (tracklist)', en: 'Comment (tracklist)' },
  serato: { es: 'Grilla y cues para Serato', en: 'Grid and cues for Serato' },
  bpm: { es: 'BPM del tag', en: 'BPM in the tag' },
  key: { es: 'Tono del tag', en: 'Key in the tag' },
  filename: { es: 'Nombre del archivo', en: 'File name' },
  extension: { es: 'Extensión del archivo', en: 'File extension' },
  title: { es: 'Título', en: 'Title' },
  artist: { es: 'Artista', en: 'Artist' },
  albumArtist: { es: 'Artista del álbum', en: 'Album artist' },
  album: { es: 'Álbum', en: 'Album' },
  track: { es: 'N.º de tema', en: 'Track no.' },
  year: { es: 'Año', en: 'Year' },
  genre: { es: 'Género', en: 'Genre' },
  seAplicaron: { es: (k: number) => `${plural(k, 'Se aplicó', 'Se aplicaron')} ${cant(k, 'cambio', 'cambios')}.`, en: (k: number) => `${cant(k, 'change was', 'changes were')} applied.` },
  recortesHistorial: { es: 'Los silencios recortados se deshacen desde el Historial: el original quedó en la papelera de PAILA.', en: 'Trimmed silences are undone from History: the original is in the PAILA trash.' },
  titulo: { es: (k: string, files: number) => `Para aplicar: ${k} en ${cant(files, 'tema', 'temas')}`, en: (k: string, files: number) => `To apply: ${k} in ${cant(files, 'track', 'tracks')}` },
  nadaEscrito: { es: ' · todavía no se escribió nada en los archivos', en: ' · nothing has been written to your files yet' },
  ocultar: { es: 'Ocultar', en: 'Hide' },
  verAntes: { es: 'Ver antes y después', en: 'See before and after' },
  descartarPreg: { es: (k: string) => `¿Descartar lo que ibas a aplicar (${k})?`, en: (k: string) => `Discard what you were going to apply (${k})?` },
  siDescartar: { es: 'Sí, descartar', en: 'Yes, discard' },
  no: { es: 'No', en: 'No' },
  descartarTip: { es: 'Tira estos cambios sin tocar ningún archivo', en: 'Throws these changes away without touching any file' },
  descartarTipOcupado: { es: 'Se están aplicando: esperá a que termine o cancelá', en: 'They are being applied: wait for it to finish, or cancel' },
  descartar: { es: 'Descartar todo', en: 'Discard all' },
  noSePueden: { es: (k: string) => `${k} no se pudieron hacer`, en: (k: string) => `${k} couldn't be done` },
  noSePuedenTip: { es: 'Quedan aparte: "Aplicar" ya no los incluye. Abajo dice por qué.', en: 'They are kept apart: "Apply" no longer includes them. The reason is below.' },
  orden: { es: 'Se aplica en este orden, sin que tengas que pensarlo: papelera, nombres y tags, carpetas, tapas.', en: 'It is applied in this order, without you having to think about it: trash, names and tags, folders, covers.' },
  verPorQue: { es: 'Ver por qué', en: 'See why' },
  sacarlos: { es: 'Sacarlos', en: 'Remove them' },
  sacarlosTip: { es: 'Los saca de lo que vas a aplicar sin tocar ningún archivo', en: 'Removes them from what you are going to apply without touching any file' },
  probar: { es: 'Probar de nuevo', en: 'Try again' },
  probarTip: { es: 'Por si ya se arregló lo que pasaba (por ejemplo, conectaste el disco)', en: 'In case what was wrong is fixed now (for example, you connected the drive)' },
  motivo: { es: (k: string, por: string) => `${k} · ${por}`, en: (k: string, por: string) => `${k} · ${por}` },
  aplicarTip: { es: 'Hace todo lo de la lista en tus archivos, en orden (con verificación y deshacer)', en: 'Does everything on the list to your files, in order (with checking and undo)' },
  aplicar: { es: 'Aplicar', en: 'Apply' },
  respaldo: {
    es: (k: number, b: string, d: string) => `Respaldo: de ${cant(k, 'archivo', 'archivos')}, PAILA guarda solo lo que cambia (unos ${b}) en ${d}. Con eso, deshacer deja cada archivo idéntico a como estaba.`,
    en: (k: number, b: string, d: string) => `Backup: for ${cant(k, 'file', 'files')}, PAILA saves only what changes (about ${b}) in ${d}. With that, undo puts every file back exactly as it was.`,
  },
  aplicarPreg: { es: (c: number, f: number) => `¿Aplicar ${cant(c, 'cambio', 'cambios')} en ${cant(f, 'tema', 'temas')}?`, en: (c: number, f: number) => `Apply ${cant(c, 'change', 'changes')} to ${cant(f, 'track', 'tracks')}?` },
  partes: {
    es: (p: number, t: number, m: number, c: number, r = 0) => [p && `${cant(p, 'tema', 'temas')} a la papelera`, t && cant(t, 'cambio de nombre o tags', 'cambios de nombre o tags'), m && `${cant(m, 'tema cambia', 'temas cambian')} de lugar`, c && cant(c, 'tapa', 'tapas'), r && cant(r, 'copia mejor', 'copias mejores')].filter(Boolean).join(' · '),
    en: (p: number, t: number, m: number, c: number, r = 0) => [p && `${cant(p, 'track', 'tracks')} to the trash`, t && cant(t, 'name or tag change', 'name or tag changes'), m && `${cant(m, 'track moves', 'tracks move')}`, c && cant(c, 'cover', 'covers'), r && cant(r, 'better copy', 'better copies')].filter(Boolean).join(' · '),
  },
  ultimo: { es: (que: string) => `Lo último: **${que}**`, en: (que: string) => `The last thing: **${que}**` },
  listo: { es: (que: string) => `Listo: **${que}**`, en: (que: string) => `Done: **${que}**` },
  hoy: { es: (h: string) => `hoy a las ${h}`, en: (h: string) => `today at ${h}` },
  ayer: { es: (h: string) => `ayer a las ${h}`, en: (h: string) => `yesterday at ${h}` },
  otroDia: { es: (d: string, h: string) => `el ${d} a las ${h}`, en: (d: string, h: string) => `on ${d} at ${h}` },
  deshacerTip: { es: 'Lo último que PAILA hizo en tus archivos, de cualquier tipo. Lo de antes se deshace desde el Historial.', en: 'The last thing PAILA did to your files, of any kind. Anything earlier is undone from History.' },
  seRestauraron: { es: (k: number) => `${plural(k, 'Se restauró', 'Se restauraron')} ${cant(k, 'tema', 'temas')}.`, en: (k: number) => `${cant(k, 'track was', 'tracks were')} restored.` },
  seDeshizo: { es: (k: number) => `Listo, se deshizo (${cant(k, 'tema', 'temas')}).`, en: (k: number) => `Done, it was undone (${cant(k, 'track', 'tracks')}).` },
  ocultarTip: { es: 'Saca este botón. Lo podés deshacer igual desde el Historial.', en: 'Removes this button. You can still undo it from History.' },
  pausa: { es: 'El análisis se pausa solo mientras se aplican los cambios y sigue después.', en: 'The analysis pauses by itself while the changes are applied, and carries on afterwards.' },
  archivos: { es: 'archivos', en: 'files' },
  cancelar: { es: 'Cancelar', en: 'Cancel' },
  avanceNota: { es: 'Cada archivo se escribe primero en una copia aparte, se verifica (el sonido tiene que quedar idéntico) y recién ahí reemplaza al original. Si cancelás, lo ya aplicado queda aplicado (y se puede deshacer).', en: "Each file is first written to a separate copy, checked (the sound has to stay identical) and only then replaces the original. If you cancel, what was already applied stays applied (and can be undone)." },
  colArchivo: { es: 'Archivo', en: 'File' },
  colCampo: { es: 'Campo', en: 'Field' },
  colAntes: { es: 'Antes', en: 'Before' },
  colDespues: { es: 'Después', en: 'After' },
  vacio: { es: '(vacío)', en: '(empty)' },
  masCambios: { es: (k: string) => `… y ${k} cambios más.`, en: (k: string) => `… and ${k} more changes.` },
})

const LABEL: Record<PendingChange['field'], string> = {
  papelera: T.papelera, mover: T.mover, reemplazo: T.reemplazo, trim: T.trim, cover: T.cover, folderCover: T.folderCover, replaygain: T.replaygain, comment: T.comment, serato: T.serato, bpm: T.bpm, key: T.key,
  filename: T.filename,
  extension: T.extension,
  title: T.title, artist: T.artist, albumArtist: T.albumArtist, album: T.album, track: T.track, year: T.year, genre: T.genre,
}

const OCULTO = 'paila.deshacer-oculto'
const VER = 'paila:ver-cambios'
/** Abre la lista de Cambios pendientes desde otra pantalla (el "Revisar" de Para hacer, en el Inicio). */
export const verCambios = () => window.dispatchEvent(new Event(VER))

/** Cuándo fue, corto: "hoy a las 10:42", "ayer a las 18:05" o "el 22/10 a las 09:30" (en inglés, "yesterday at 6:05 PM"). */
export function cuando(iso: string, ahora = new Date()): string {
  const d = new Date(iso), hoy = ahora, ayer = new Date(hoy); ayer.setDate(hoy.getDate() - 1)
  // en castellano, 18:05 (no "06:05 p. m.", que es lo que da es-AR por defecto); en inglés, 6:05 PM
  const h = d.toLocaleTimeString(formato(), { hour: 'numeric', minute: '2-digit', ...(idioma() === 'es' ? { hourCycle: 'h23' as const } : {}) })
  if (d.toDateString() === hoy.toDateString()) return T.hoy(h)
  if (d.toDateString() === ayer.toDateString()) return T.ayer(h)
  return T.otroDia(d.toLocaleDateString(formato(), { day: 'numeric', month: 'numeric' }), h)
}

/** Cómo se recuerda que la persona ocultó el cartel de esta tanda (vuelve con la próxima). */
export const claveDe = (e: HistoryEntry) => `${e.kind}:${e.id}`
/** Lo último se ofrece si se puede deshacer y no se ocultó. Si lo último no se puede (vaciar la papelera), no se ofrece nada más viejo acá.
 *  Con cambios pendientes, no: al lado de "Descartar", "Deshacer" parecía deshacer lo propuesto y deshizo otra cosa (la persona 1 deshizo
 *  su separación de voz queriendo sacar 5 nombres propuestos, 31/10). Sigue en el Historial. */
export const puedeDeshacer = (e: HistoryEntry | null, oculto: string | null, pendientes = 0): e is HistoryEntry => !pendientes && !!e && !e.undone && e.canUndo && claveDe(e) !== oculto

/** Barra de "Cambios pendientes": ver el antes y el después, aplicar con avance en vivo, descartar y deshacer la última tanda. */
export default function ChangesBar({ pending: all, ultimo, analyzing, avisos = [], onApply, onDiscard, onUndo }: {
  pending: PendingChange[]; ultimo: HistoryEntry | null; analyzing: boolean
  /** Los avisos del escaneo, ya cortados y con su "y N más": van en esta misma barra (una sola arriba, repaso del 27/10) */
  avisos?: string[]
  onApply: (ids?: number[]) => Promise<ApplyResult | string>; onDiscard: (ids?: number[]) => void; onUndo: (e: HistoryEntry) => Promise<HistoryUndoResult | string>
}) {
  // lo que falló al aplicar queda aparte, con su motivo: "Aplicar" cuenta solo lo que sí se puede (choques del 27/10, C4)
  const malos = all.filter((p) => p.error)
  const pending = all.filter((p) => !p.error)
  const [verMalos, setVerMalos] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => { const f = () => setOpen(true); window.addEventListener(VER, f); return () => window.removeEventListener(VER, f) }, [])
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [res, setRes] = useState<ResultadoTanda | null>(null)
  // el respaldo de lo que se va a escribir (ops/backup.ts): cuánto ocupa y dónde va, para decirlo antes de aplicar
  const [bk, setBk] = useState<BackupPlan | null>(null)
  useEffect(() => {
    if (!pending.length) { setBk(null); return }
    let vivo = true
    window.paila.backupPlan().then((p) => { if (vivo) setBk(p) }, () => { /* sin vista previa del respaldo: lo dice al aplicar */ })
    return () => { vivo = false }
  }, [all])
  // "Deshacer lo último" se puede ocultar (decidido el 22/10): sigue en el Historial. Se recuerda por tanda: vuelve con la próxima.
  const [hidden, setHidden] = useState<string | null>(() => { try { return localStorage.getItem(OCULTO) } catch { return null } })
  const hide = (k: string) => { setHidden(k); try { localStorage.setItem(OCULTO, k) } catch { /* sin almacenamiento: se oculta hasta cerrar */ } }
  const job = useJob('apply')
  const working = !!job?.running

  // una sola cosa por vez en esta barra (el autor, 01/11: "hay que tocar 3-5 botoncitos para ir cerrando cosas"): sin fallas, no
  // queda ningún cartel para cerrar; la barra dice "Listo:" con lo hecho y su Deshacer, y a los segundos vuelve a "Lo último"
  const [recien, setRecien] = useState(false)
  useEffect(() => { if (!recien) return; const t = setTimeout(() => setRecien(false), 12_000); return () => clearTimeout(t) }, [recien])
  const report = (hechos: (k: number) => string, r: ApplyResult | string, deshacer?: ResultadoTanda['deshacer']) => {
    if (typeof r === 'string') return toast(r, 'error')
    // lo que no se pudo sigue pendiente, aparte y con su motivo (la fila "no se pudieron hacer", con "Sacarlos")
    if (r.failed.length) setRes({ hechos: hechos(r.applied), fallados: r.failed, deshacer })
    else { setRes(null); setRecien(true) }
  }
  // el avance de Aplicar se ve mientras corre; al terminar bien se va solo (antes quedaba "Terminó" con su propia cruz)
  useEffect(() => { if (job && !job.running && !job.failed && !job.problems.length) void window.paila.dismissJob('apply') }, [job])
  const apply = async (ids?: number[]) => {
    const trims = (ids ? malos.filter((p) => ids.includes(p.id)) : pending).some((p) => p.field === 'trim')
    setRes(null)
    const r = await onApply(ids)
    report(T.seAplicaron, r, 'historial')
    // los recortes cambian el audio: el original queda en la papelera y se deshacen como cualquier tanda del Historial
    if (trims && typeof r !== 'string') toast(T.recortesHistorial)
  }
  const como = ultimo ? comoDeshacer(ultimo) : null
  const undo = async () => {
    if (!ultimo || !como) return
    setRes(null)
    const r = await onUndo(ultimo)
    if (typeof r === 'string') return toast(r, 'error')
    if (r.failed.length) setRes({ hechos: (como.restaura ? T.seRestauraron : T.seDeshizo)(r.done), fallados: r.failed })
    else toast((como.restaura ? T.seRestauraron : T.seDeshizo)(r.done), 'ok')
  }

  const files = new Set(pending.map((p) => p.fileId)).size
  const cuantos = (f: (p: PendingChange) => boolean) => pending.filter(f).length
  const partes = T.partes(cuantos((p) => p.field === 'papelera'), cuantos((p) => !['papelera', 'mover', 'cover', 'folderCover', 'reemplazo'].includes(p.field)), cuantos((p) => p.field === 'mover'), cuantos((p) => p.field === 'cover' || p.field === 'folderCover'), cuantos((p) => p.field === 'reemplazo'))
  const clave = ultimo ? claveDe(ultimo) : null
  const recienVale = recien && !all.length && !!ultimo && !ultimo.undone && ultimo.canUndo
  const canUndo = !!como && (recienVale || puedeDeshacer(ultimo, hidden, all.length))
  if (!pending.length && !malos.length && !canUndo && !job && !res && !avisos.length) return null
  // los motivos, juntos: "3 · El archivo ya no está"
  const porQue = [...malos.reduce((m, p) => m.set(p.error!, (m.get(p.error!) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1])

  return (
    <div className="changes-bar">
      {avisos.map((w, i) => <div key={i} className="changes-aviso small">{w}</div>)}
      {(pending.length > 0 || canUndo) && <div className="changes-head">
        {pending.length > 0 && (
          <>
            <b>{T.titulo(n(pending.length), files)}</b>
            <span className="muted small">{T.nadaEscrito}</span>
            <button className="link" onClick={() => setOpen(!open)}>{open ? T.ocultar : T.verAntes}</button>
            <span className="push-right" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {confirmDiscard ? (
                <>
                  <span className="small">{T.descartarPreg(n(pending.length))}</span>
                  <Boton size="sm" onClick={() => { setConfirmDiscard(false); onDiscard() }}>{T.siDescartar}</Boton>
                  <Boton variant="ghost" size="sm" onClick={() => setConfirmDiscard(false)}>{T.no}</Boton>
                </>
              ) : (
                <>
                  <Boton variant="ghost" disabled={working} onClick={() => (pending.length > 20 ? setConfirmDiscard(true) : onDiscard())} title={working ? T.descartarTipOcupado : T.descartarTip}>{T.descartar}</Boton>
                  <span title={T.aplicarTip}>
                    <ConfirmarBoton variant="aplicar" disabled={working} onSi={() => apply()} deshacer="historial" pregunta={T.aplicarPreg(pending.length, files)}
                      aviso={<span className="small"><b>{partes}</b>. {T.orden}{bk && (bk.problem || bk.files) ? <span className={bk.problem || bk.warning ? 'warn-inline' : 'muted'}> {bk.problem ?? <>{T.respaldo(bk.files, bytes(bk.bytes), bk.dirs.join(', '))}{bk.warning && <> {bk.warning}</>}</>}</span> : null}</span>}>{T.aplicar}</ConfirmarBoton>
                  </span>
                </>
              )}
            </span>
          </>
        )}
        {canUndo && !working && ultimo && como && (
          <span className="ultimo-hecho" title={T.deshacerTip}>
            {/* el resumen se puede cortar si es largo; el cuándo no, que es lo que dice si es lo de hoy o algo viejo */}
            <span className="small ultimo-que" title={ultimo.summary}><Rico texto={recien ? T.listo(ultimo.summary) : T.ultimo(ultimo.summary)} /></span>
            <span className="small muted ultimo-cuando">{cuando(ultimo.at)}</span>
            <ConfirmarBoton variant="ghost" onSi={undo} deshacer={como.deshacer} si={como.si} pregunta={como.pregunta} aviso={<span className="small">{ultimo.summary}. {como.aviso}</span>}>{como.boton}</ConfirmarBoton>
          </span>
        )}
        {canUndo && !working && !pending.length && clave && (
          <button className="link small" onClick={() => hide(clave)} title={T.ocultarTip}>{T.ocultar}</button>
        )}
      </div>}
      {malos.length > 0 && !working && (
        <div className="changes-head" style={{ marginTop: 4 }}>
          <span className="warn-inline small" title={T.noSePuedenTip}>{T.noSePueden(n(malos.length))}</span>
          <button className="link small" onClick={() => setVerMalos(!verMalos)}>{verMalos ? T.ocultar : T.verPorQue}</button>
          <span className="push-right" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Boton variant="ghost" size="sm" onClick={() => apply(malos.map((p) => p.id))} title={T.probarTip}>{T.probar}</Boton>
            <Boton variant="ghost" size="sm" onClick={() => onDiscard(malos.map((p) => p.id))} title={T.sacarlosTip}>{T.sacarlos}</Boton>
          </span>
        </div>
      )}
      {verMalos && malos.length > 0 && (
        <ul className="small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
          {porQue.slice(0, 8).map(([por, k]) => <li key={por}>{T.motivo(n(k), por)}</li>)}
        </ul>
      )}
      {res && <Resultado r={res} onCerrar={() => setRes(null)} />}
      {analyzing && pending.length > 0 && !working && <div className="muted small" style={{ marginTop: 4 }}>{T.pausa}</div>}
      {job && (job.running || job.failed || job.problems.length > 0) && (
        <JobPanel job={job} unit={T.archivos} onDismiss={() => window.paila.dismissJob('apply')}>
          {job.running && <Boton variant="ghost" size="sm" disabled={job.cancelling} onClick={() => window.paila.cancelJob('apply')}>{T.cancelar}</Boton>}
          {job.running && <span className="muted small">{T.avanceNota}</span>}
        </JobPanel>
      )}
      {open && pending.length > 0 && (
        <table className="changes-table">
          <thead><tr><th>{T.colArchivo}</th><th>{T.colCampo}</th><th>{T.colAntes}</th><th>{T.colDespues}</th></tr></thead>
          <tbody>
            {pending.slice(0, 200).map((p) => (
              <tr key={p.id}>
                <td title={p.rel}>{p.rel.split(/[\\/]/).pop()}</td><td>{LABEL[p.field]}</td>
                <td className="muted">{p.before || T.vacio}</td><td><b>{p.after || T.vacio}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open && pending.length > 200 && <div className="muted small">{T.masCambios(n(pending.length - 200))}</div>}
    </div>
  )
}
