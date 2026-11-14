// Pantalla Papelera: lo que PAILA sacó de la biblioteca, restaurarlo o vaciarla. (Duplicados está en Duplicates.tsx.)
import { useEffect, useMemo, useState } from 'react'
import type { BackupInfo, PurgeResult, ReplacementEntry, TrashBatch, TrashFolder, TrashItem, TrashResult, TrashUsage } from '@paila/shared/types'
import { bytes, n } from './format'
import { Aviso, Boton, Cabecera, Info, Rico } from '@paila/diseno'
import { textos, cant, fecha, fechaHora, lista } from '@paila/shared/idioma'
import { ConfirmarBoton, Resultado, type ResultadoTanda } from './Confirmar'
import { papeleraCambio, tomarPedidoVaciar } from './papelera'

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
const base = (rel: string) => rel.split('/').pop() ?? rel
const dir = (rel: string) => rel.split('/').slice(0, -1).join('/')
/** Cuánto ocupan en la papelera las tandas de estos tipos. */
const byKindOf = (u: TrashUsage, k: TrashFolder['kind'][]) => u.folders.filter((f) => k.includes(f.kind)).reduce((s, f) => s + f.bytes, 0)

export { Duplicates } from './Duplicates'

/** "20/10/2026" */
const day = (iso: string) => fecha(iso)

const T = textos({
  vaciar: { es: 'Vaciar papelera', en: 'Empty trash' },
  vaciarAviso: { es: 'Esto {rojo} los archivos de la papelera: después ya no se pueden restaurar ni deshacer. Es lo único que borra en PAILA. Mirá bien la lista.', en: 'This {rojo} the files in the trash: afterwards they can no longer be restored or undone. It is the only thing in PAILA that deletes. Look at the list carefully.' },
  borraDeVerdad: { es: 'borra de verdad', en: 'permanently deletes' },
  todo: { es: 'Todo', en: 'Everything' },
  soloViejo1: { es: 'Solo lo que está en la papelera hace más de ', en: 'Only what has been in the trash for more than ' },
  soloViejo2: { es: ' días', en: ' days' },
  nadaBorrar: { es: 'No hay nada para borrar con esa elección.', en: 'Nothing to delete with that choice.' },
  masTandas: { es: (k: string) => `… y ${k} tandas más`, en: (k: string) => `… and ${k} more batches` },
  seBorran: { es: (f: string, t: string) => `Se van a borrar **${f} archivos** y se liberan **${t}**.`, en: (f: string, t: string) => `**${f} files** will be deleted and **${t}** freed up.` },
  cancelar: { es: 'Cancelar', en: 'Cancel' },
  borrarPreg: { es: (f: string, t: string) => `¿Borrar para siempre ${f} archivos (${t})?`, en: (f: string, t: string) => `Delete ${f} files (${t}) forever?` },
  tandasAviso: { es: 'Los reemplazos y conversiones cuyo original esté en esas tandas tampoco se van a poder deshacer.', en: 'Replacements and conversions whose original is in those batches can no longer be undone either.' },
  palabra: { es: 'VACIAR', en: 'EMPTY' },
  borrando: { es: 'Borrando…', en: 'Deleting…' },
  borrar: { es: (t: string) => `Borrar ${t} para siempre`, en: (t: string) => `Delete ${t} forever` },
  archivos: { es: (k: number) => cant(k, 'archivo', 'archivos'), en: (k: number) => cant(k, 'file', 'files') },
  reempHecho: { es: (rel: string) => `Se deshizo el reemplazo. Como el tema se había movido o renombrado después, el archivo anterior volvió a ese lugar: ${rel}.`, en: (rel: string) => `The replacement was undone. Since the track had been moved or renamed afterwards, the previous file went back to this place: ${rel}.` },
  reempHechoSimple: { es: 'Se deshizo el reemplazo: volvió el archivo anterior.', en: 'The replacement was undone: the previous file is back.' },
  restauraron: { es: (k: string) => `Se restauraron ${k} archivos.`, en: (k: string) => `${k} files were restored.` },
  restaurarPreg: { es: (k: number) => `¿Restaurar ${cant(k, 'archivo', 'archivos')} a donde estaban?`, en: (k: number) => `Put ${cant(k, 'file', 'files')} back where they were?` },
  vaciada: { es: (k: string, b: string) => `Papelera vaciada: se borraron ${k} archivos y se liberaron ${b}.`, en: (k: string, b: string) => `Trash emptied: ${k} files were deleted and ${b} freed up.` },
  seDejaron: { es: (k: string, why: string) => ` ${k} se dejaron (${why}).`, en: (k: string, why: string) => ` ${k} were left in place (${why}).` },
  titulo: { es: 'Papelera', en: 'Trash' },
  sub: { es: 'Nada se borra de verdad: todo se puede restaurar.', en: 'Nothing is really deleted: everything can be restored.' },
  ayuda: {
    es: 'Acá queda todo lo que PAILA sacó de tu biblioteca: los temas que mandaste a la papelera, los **originales** de los reemplazos y las conversiones (WAV → FLAC, WMA → MP3…) y las limpiezas de Espacio. Nada de esto se borró: sigue en tu disco, en la carpeta {carpeta} de cada carpeta de música, y se puede restaurar. Por eso **el espacio recién se libera cuando vaciás la papelera**.',
    en: 'Here is everything PAILA took out of your library: the tracks you sent to the trash, the **originals** of replacements and conversions (WAV → FLAC, WMA → MP3…) and the Space clean-ups. None of this was deleted: it is still on your disk, in the {carpeta} folder inside each music folder, and it can be restored. That is why **space is only freed once you empty the trash**.',
  },
  midiendo: { es: 'Midiendo la papelera…', en: 'Measuring the trash…' },
  vacia: { es: 'La papelera no ocupa nada en tu disco.', en: 'The trash takes up nothing on your disk.' },
  ocupa: { es: (b: string, k: string) => `La papelera ocupa **${b}** (${k} archivos)`, en: (b: string, k: string) => `The trash takes up **${b}** (${k} files)` },
  tipTemas: { es: 'Temas que mandaste: ', en: 'Tracks you sent: ' },
  tipOrig: { es: 'Originales de reemplazos y conversiones: ', en: 'Originals of replacements and conversions: ' },
  tipLimp: { es: 'Limpiezas de Espacio: ', en: 'Space clean-ups: ' },
  tipZip: { es: 'ZIP y RAR que ya estaban abiertos: ', en: 'ZIP and RAR files that were already opened: ' },
  tipOtros: { es: 'Otros: ', en: 'Other: ' },
  tipRespaldos: { es: 'Respaldos que mandaste a la papelera: ', en: 'Backups you sent to the trash: ' },
  dRespaldos: { es: (b: string) => `**${b}** de respaldos`, en: (b: string) => `**${b}** of backups` },
  dTemas: { es: (b: string) => `**${b}** de temas`, en: (b: string) => `**${b}** of tracks` },
  dOtros: { es: (b: string) => `${b} de otros archivos`, en: (b: string) => `${b} of other files` },
  respaldosTit: { es: 'Respaldos en la papelera', en: 'Backups in the trash' },
  respaldosTip: { es: 'Respaldos que mandaste a la papelera desde el Historial o desde Configuración → Respaldos. Recuperados, vuelven a servir para deshacer byte a byte.', en: 'Backups you sent to the trash from History or from Settings → Backups. Once recovered, they work again for byte-for-byte undo.' },
  respaldoLinea: { es: (deshacer: boolean, k: number, b: string) => `${deshacer ? 'Antes de deshacer cambios' : 'Antes de aplicar cambios'} · ${cant(k, 'archivo', 'archivos')} · ${b}`, en: (deshacer: boolean, k: number, b: string) => `${deshacer ? 'Before undoing changes' : 'Before applying changes'} · ${cant(k, 'file', 'files')} · ${b}` },
  recuperar: { es: 'Recuperar', en: 'Recover' },
  recuperado: { es: 'El respaldo volvió a su lugar y vuelve a servir para deshacer.', en: 'The backup is back in its place and works for undoing again.' },
  sinContar: { es: (k: string, c: number) => ` · sin contar ${k} ${c === 1 ? 'carpeta' : 'carpetas'} de música con el disco desconectado`, en: (k: string, c: number) => ` · not counting ${k} music ${c === 1 ? 'folder' : 'folders'} on a disconnected drive` },
  vaciarTip: { es: 'Borra de verdad lo que está en la papelera. Siempre pide confirmar dos veces.', en: 'Permanently deletes what is in the trash. It always asks you to confirm twice.' },
  vaciarBoton: { es: 'Vaciar papelera…', en: 'Empty trash…' },
  nadaRestaurar: { es: 'No hay temas en la papelera para restaurar.', en: 'There are no tracks in the trash to restore.' },
  reemplazos: { es: 'Reemplazos', en: 'Replacements' },
  deshecho: { es: ' · deshecho', en: ' · undone' },
  yaNoSePuede: { es: (d: string) => ` · ya no se puede deshacer: se vació la papelera el ${d}`, en: (d: string) => ` · can no longer be undone: the trash was emptied on ${d}` },
  restaurarElegidos: { es: (k: number) => `Restaurar los elegidos (${k})`, en: (k: number) => `Restore the chosen ones (${k})` },
  elegirTodos: { es: 'Elegir todos', en: 'Choose all' },
  ningunoElegido: { es: 'Ninguno', en: 'None' },
  deshacerRepsPreg: { es: (k: number) => `¿Restaurar los archivos anteriores de ${k} reemplazos?`, en: (k: number) => `Restore the previous files of ${k} replacements?` },
  reempVarios: { es: (k: number) => `Se restauraron ${k} reemplazos.`, en: (k: number) => `${k} replacements were restored.` },
  restaurarTodo: { es: 'Restaurar todo', en: 'Restore all' },
  yMas: { es: (k: number) => `… y ${k} más`, en: (k: number) => `… and ${k} more` },
})

/**
 * Vaciar papelera: lo ÚNICO que borra de verdad en PAILA. Doble confirmación: primero la lista de lo que se va
 * (con tamaños y cuánto se libera), después escribir VACIAR.
 */
function PurgePanel({ usage, onClose, onDone }: { usage: TrashUsage; onClose: () => void; onDone: (r: PurgeResult) => void }) {
  // de fábrica, solo lo que lleva más de 30 días: vaciar todo es lo que hay que elegir a propósito (hallazgo 7 de la revisión del 02/11)
  const [mode, setMode] = useState<'todo' | 'viejo'>('viejo')
  const [days, setDays] = useState(30)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const chosen = useMemo(() => usage.folders.filter((f) => f.files > 0 && (mode === 'todo' || f.ageDays >= days)), [usage, mode, days])
  const total = chosen.reduce((s, f) => s + f.bytes, 0), files = chosen.reduce((s, f) => s + f.files, 0)
  const go = async () => {
    setBusy(true); setErr(null)
    try { onDone(await window.paila.purgeTrash(chosen.map((f) => f.key))) } catch (e) { setErr(clean(e)); setBusy(false) }
  }
  return (
    <div className="purge">
      <b>{T.vaciar}</b>
      <span className="small"><Rico texto={T.vaciarAviso} partes={{ rojo: <b className="danger-text">{T.borraDeVerdad}</b> }} /></span>
      <div className="row small">
        <label><input type="radio" checked={mode === 'todo'} onChange={() => setMode('todo')} /> {T.todo}</label>
        <label><input type="radio" checked={mode === 'viejo'} onChange={() => setMode('viejo')} /> {T.soloViejo1}<input type="number" min={1} max={3650} value={days} style={{ width: 64 }} onChange={(e) => { setMode('viejo'); setDays(Math.max(1, Number(e.target.value) || 1)) }} />{T.soloViejo2}</label>
      </div>
      {chosen.length === 0 ? <span className="muted small">{T.nadaBorrar}</span> : (<>
        <div className="listbox" style={{ maxHeight: 320 }}>
          {chosen.slice(0, 200).map((f) => (
            <div key={f.key} className="listbox-row" title={`${f.rootPath}/${f.trash}/${f.folder}`}>
              <span className="ellipsis"><b>{day(f.createdAt)}</b> · {f.label} <span className="muted small">({T.archivos(f.files)}{usage.folders.some((x) => x.rootId !== f.rootId) ? ` · ${f.rootPath}` : ''})</span></span>
              <span className="muted">{bytes(f.bytes)}</span>
            </div>
          ))}
          {chosen.length > 200 && <div className="listbox-row muted small">{T.masTandas(n(chosen.length - 200))}</div>}
        </div>
        <span><Rico texto={T.seBorran(n(files), bytes(total))} /></span>
      </>)}
      {err && <span className="warn-inline">{err}</span>}
      <div className="actionrow" style={{ padding: 0 }}>
        {chosen.length > 0 && (
          <ConfirmarBoton disabled={busy} onSi={go} deshacer="nunca" palabra={T.palabra} pregunta={T.borrarPreg(n(files), bytes(total))} aviso={<span className="small">{T.tandasAviso}</span>}>
            {busy ? T.borrando : T.borrar(bytes(total))}
          </ConfirmarBoton>
        )}
        <Boton variant="ghost" disabled={busy} onClick={onClose}>{T.cancelar}</Boton>
      </div>
    </div>
  )
}

/** Pantalla Papelera: lo que PAILA sacó de la biblioteca (temas, originales de reemplazos, limpiezas). Se restaura, o se vacía a mano. */
export function TrashPage({ onChanged }: { onChanged: () => void }) {
  const [batches, setBatches] = useState<TrashBatch[]>([])
  const [items, setItems] = useState<TrashItem[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  const [res, setRes] = useState<ResultadoTanda | null>(null)
  const [reps, setReps] = useState<ReplacementEntry[]>([])
  const [usage, setUsage] = useState<TrashUsage | null>(null)
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [purging, setPurging] = useState(false)
  const load = async () => {
    setBatches(await window.paila.trashBatches()); setItems(await window.paila.trashItems()); setReps(await window.paila.replacements())
    setUsage(await window.paila.trashUsage()); setBackups(await window.paila.backupsTrashed())
  }
  const [sel, setSel] = useState<Set<number>>(new Set())
  const deshacibles = reps.filter((r) => !r.undone && !r.purgedAt)
  const elegidos = deshacibles.filter((r) => sel.has(r.id))
  const undoReps = async () => {
    try {
      let ok = 0; let ultimo: Awaited<ReturnType<typeof window.paila.undoReplacement>> | null = null
      for (const r of elegidos) { ultimo = await window.paila.undoReplacement(r.id); ok++ }
      setSel(new Set()); setMsg(null)
      setRes({ hechos: ok === 1 && ultimo ? (ultimo.followed ? T.reempHecho(ultimo.rel) : T.reempHechoSimple) : T.reempVarios(ok) })
      onChanged(); await load()
    } catch (e) { setMsg(clean(e)); await load() }
  }
  // desde el aviso del Inicio ("Vaciar…"): abre con el panel de vaciar, que pide confirmar como siempre
  useEffect(() => { load(); if (tomarPedidoVaciar()) setPurging(true) }, [])

  const restore = async (b: TrashBatch) => {
    try {
      const r: TrashResult = await window.paila.restoreTrash(b.batchId)
      setMsg(null); setRes({ hechos: T.restauraron(n(r.moved)), fallados: r.failed })
      onChanged(); await load(); papeleraCambio()
    } catch (e) { setMsg(clean(e)) }
  }
  const purged = async (r: PurgeResult) => {
    setPurging(false)
    setMsg(null)
    setRes({ hechos: T.vaciada(n(r.deleted), bytes(r.bytes)) + (r.kept.length ? T.seDejaron(n(r.kept.length), r.kept[0].why) : ''), fallados: r.failed, deshacer: 'nunca' })
    onChanged(); await load(); papeleraCambio()
  }

  const live = batches.filter((b) => items.some((i) => i.batchId === b.batchId))
  // solo lo que hay (el formato de tamaños redondea 0 a "1 KB": se leía "1 KB de otros archivos" sin ninguno)
  const otros = usage ? usage.bytes - byKindOf(usage, ['respaldo', 'temas', 'reemplazo', 'deshecho']) : 0
  const desglose = usage ? [byKindOf(usage, ['respaldo']) && T.dRespaldos(bytes(byKindOf(usage, ['respaldo']))), byKindOf(usage, ['temas', 'reemplazo', 'deshecho']) && T.dTemas(bytes(byKindOf(usage, ['temas', 'reemplazo', 'deshecho']))), otros > 0 && T.dOtros(bytes(otros))].filter((x): x is string => !!x) : []
  const recuperar = async (id: number) => {
    try { await window.paila.backupRestore(id); setMsg(null); setRes({ hechos: T.recuperado }); await load(); papeleraCambio() } catch (e) { setMsg(clean(e)) }
  }
  const byKind = (k: TrashFolder['kind'][]) => (usage?.folders ?? []).filter((f) => k.includes(f.kind)).reduce((s, f) => s + f.bytes, 0)
  return (
    <div className="page">
      <Cabecera nivel={2} titulo={T.titulo} sub={T.sub} ayuda={<Rico texto={T.ayuda} partes={{ carpeta: <code>_PAILA/papelera</code> }} />} />
      <div className="callout row">
        {!usage ? <span className="muted">{T.midiendo}</span> : usage.files === 0 ? <span>{T.vacia}</span> : (
          <span>
            <Rico texto={T.ocupa(bytes(usage.bytes), n(usage.files))} />
            <span className="info" title={`${T.tipTemas}${bytes(byKind(['temas']))}\n${T.tipOrig}${bytes(byKind(['reemplazo', 'deshecho']))}\n${T.tipLimp}${bytes(byKind(['limpieza']))}${byKind(['comprimido']) ? `\n${T.tipZip}${bytes(byKind(['comprimido']))}` : ''}${byKind(['respaldo']) ? `\n${T.tipRespaldos}${bytes(byKind(['respaldo']))}` : ''}${byKind(['otro']) ? `\n${T.tipOtros}${bytes(byKind(['otro']))}` : ''}`}>ⓘ</span>
            {/* el desglose a la vista: cuánto es de respaldos y cuánto de temas (pedido del autor, 24/10) */}
            {desglose.length > 0 && <span className="muted small"> · <Rico texto={lista(desglose)} /></span>}
            {usage.offline > 0 && <span className="muted small">{T.sinContar(n(usage.offline), usage.offline)}</span>}
          </span>
        )}
      </div>
      {purging && usage && <PurgePanel usage={usage} onClose={() => setPurging(false)} onDone={purged} />}
      {msg && <Aviso>{msg}</Aviso>}
      {res && <Resultado r={res} />}
      {backups.length > 0 && (
        <>
          <h4>{T.respaldosTit} <Info tip={T.respaldosTip} /></h4>
          <div className="lista-filas">{backups.map((b) => (
            <div key={b.id} className="box">
              <div className="box-head">
                <b>{fechaHora(b.createdAt)}</b><span className="muted small"> {T.respaldoLinea(b.op === 'deshacer-tags', b.files, bytes(b.bytes))}</span>
                <span className="push-right"><Boton size="sm" variant="ghost" onClick={() => recuperar(b.id)} title={b.trashDir ?? ''}>{T.recuperar}</Boton></span>
              </div>
            </div>
          ))}</div>
        </>
      )}
      {!live.length && <p className="muted">{T.nadaRestaurar}</p>}
      {reps.length > 0 && (
        <>
          <h4>{T.reemplazos}</h4>
          {deshacibles.length > 0 && (
            <div className="row">
              <ConfirmarBoton size="sm" variant="ghost" disabled={!elegidos.length} onSi={undoReps} deshacer="atras" pregunta={T.deshacerRepsPreg(elegidos.length)}>{T.restaurarElegidos(elegidos.length)}</ConfirmarBoton>
              <button className="link small" onClick={() => setSel(new Set(sel.size === deshacibles.length ? [] : deshacibles.map((r) => r.id)))}>{sel.size === deshacibles.length ? T.ningunoElegido : T.elegirTodos}</button>
            </div>
          )}
          <div className="lista-filas">{reps.map((r) => {
            const puede = !r.undone && !r.purgedAt
            return (
              <label key={r.id} className={`box ${puede ? 'clicable' : ''}`}>
                <div className="box-head">
                  {puede && <input type="checkbox" checked={sel.has(r.id)} onChange={(e) => setSel((p) => { const t = new Set(p); e.target.checked ? t.add(r.id) : t.delete(r.id); return t })} />}
                  <b>{base(r.oldRel)}</b><span className="muted small"> → {base(r.newRel)} · {fechaHora(r.createdAt)}{r.undone ? T.deshecho : ''}{!r.undone && r.purgedAt ? T.yaNoSePuede(day(r.purgedAt)) : ''}</span>
                </div>
              </label>
            )
          })}</div>
        </>
      )}
      {live.map((b) => (
        <div key={b.batchId} className="box">
          <div className="box-head">
            <b>{fechaHora(b.createdAt)}</b>
            <span className="muted small"> {b.reason ?? ''} · {T.archivos(items.filter((i) => i.batchId === b.batchId).length)} · {bytes(items.filter((i) => i.batchId === b.batchId).reduce((s, i) => s + i.size, 0))}</span>
            <span className="push-right"><ConfirmarBoton size="sm" variant="ghost" onSi={() => restore(b)} deshacer="atras" pregunta={T.restaurarPreg(items.filter((i) => i.batchId === b.batchId).length)}>{T.restaurarTodo}</ConfirmarBoton></span>
          </div>
          {items.filter((i) => i.batchId === b.batchId).slice(0, 8).map((i) => <div key={i.id} className="box-row" style={{ gridTemplateColumns: '1fr auto', cursor: 'default' }}><span className="ellipsis"><b>{base(i.rel)}</b> <span className="muted small">{dir(i.rel)}</span></span><span className="muted small">{bytes(i.size)}</span></div>)}
          {items.filter((i) => i.batchId === b.batchId).length > 8 && <div className="muted small box-row" style={{ gridTemplateColumns: '1fr' }}>{T.yMas(items.filter((i) => i.batchId === b.batchId).length - 8)}</div>}
        </div>
      ))}
      {/* lo único que borra de verdad: abajo de todo y chico, no arriba a la derecha donde estaba el botón más a mano */}
      {usage && usage.files > 0 && !purging && <div className="papelera-pie"><Boton size="sm" variant="ghost" onClick={() => setPurging(true)} title={T.vaciarTip}>{T.vaciarBoton}</Boton></div>}
    </div>
  )
}
