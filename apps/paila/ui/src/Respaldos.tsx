// Configuración → Respaldos (motor único; core/ops/backup.ts): antes de cambiar lo de adentro de archivos de tu Música, PAILA
// guarda lo que cambia de cada uno (respaldo liviano). Acá se ve dónde van, cuáles hay y cuánto ocupan; se mandan a mano a la
// papelera de PAILA (uno por uno o "Borrar respaldos viejos") y desde ahí se recuperan hasta vaciarla: PAILA nunca lo hace sola.
import { useEffect, useState } from 'react'
import type { BackupInfo } from '@paila/shared/types'
import { Aviso, Boton, Info, Pildora } from '@paila/diseno'
import { bytes } from './format'
import { ConfirmarBoton, Resultado, type ResultadoTanda } from './Confirmar'
import { papeleraCambio } from './papelera'
import { cant, fechaHora, textos } from '@paila/shared/idioma'

const T = textos({
  titulo: { es: 'Respaldos', en: 'Backups' },
  tip: {
    es: 'Antes de escribir tags, tapas, volumen parejo o comentarios en tus archivos, PAILA guarda solo lo que cambia de cada uno (unos pocos KB; el audio nunca se toca) y comprueba que con eso se puede rearmar el original. Así, deshacer deja cada archivo idéntico a como estaba. Mover, renombrar, reemplazar o convertir no lo necesitan: eso se deshace desde el Historial y el original queda en la papelera de PAILA.',
    en: "Before writing tags, covers, even volume or comments to your files, PAILA saves only what changes in each one (a few KB; the audio is never touched) and checks the original can be rebuilt from it. That way, undo puts every file back exactly as it was. Moving, renaming, replacing or converting don't need it: those are undone from the History and the original stays in PAILA's trash.",
  },
  explica: {
    es: 'Cómo estaban tus archivos antes de cada tanda de Cambios pendientes. PAILA nunca los borra sola: cuando revises que todo quedó bien, mandalos a la papelera desde acá o desde el Historial.',
    en: "How your files were before each batch of Pending changes. PAILA never deletes them on its own: once you've checked everything came out fine, send them to the trash from here or from the History.",
  },
  completo: { es: 'copias completas', en: 'full copies' },
  completoTip: {
    es: 'Copias enteras de los archivos, como las hacía la versión 0.5.3. Ocupan mucho más que los respaldos nuevos y siguen sirviendo para deshacer. Si ya revisaste que todo quedó bien, conviene borrarlas.',
    en: 'Whole copies of the files, the way version 0.5.3 made them. They take much more space than the new backups and still work for undoing. If you already checked everything came out fine, it is worth deleting them.',
  },
  viejos: { es: (k: number) => `Borrar respaldos viejos (${k})`, en: (k: number) => `Delete old backups (${k})` },
  viejosTip: { es: 'Los de hace más de 30 días y las copias completas de la versión anterior.', en: 'The ones older than 30 days, and the full copies from the previous version.' },
  viejosNinguno: { es: 'No hay respaldos de hace más de 30 días ni copias completas.', en: 'There are no backups older than 30 days and no full copies.' },
  viejosPreg: {
    es: (k: number, b: string) => `¿Mandar a la papelera ${cant(k, 'respaldo viejo', 'respaldos viejos')} (${b})? Deshacer esas tandas va a seguir funcionando, volviendo a escribir los tags de antes.`,
    en: (k: number, b: string) => `Send ${cant(k, 'old backup', 'old backups')} to the trash (${b})? Undoing those batches will keep working, by writing the old tags back.`,
  },
  van: { es: 'Van a:', en: 'They go to:' },
  deFabrica: { es: 'al lado de tu Música, en _PAILA/respaldos de cada disco', en: 'next to your Music, in _PAILA/respaldos on each disk' },
  elegir: { es: 'Elegir otra carpeta', en: 'Choose another folder' },
  volver: { es: 'Volver a la de fábrica', en: 'Back to the default' },
  ninguno: { es: 'Todavía no hay respaldos.', en: 'There are no backups yet.' },
  incompleto: { es: 'incompleto', en: 'incomplete' },
  incompletoTip: { es: 'La tanda se cortó en el medio: sirve para los temas que llegaron a cambiar.', en: 'The batch stopped halfway: it works for the tracks that did get changed.' },
  incompletoViejoTip: { es: 'Se cortó mientras se copiaba: la tanda no llegó a empezar. Se puede borrar.', en: "It stopped while copying: the batch never started. It can be deleted." },
  yaNoEsta: { es: 'la carpeta ya no está', en: 'the folder is gone' },
  abrir: { es: 'Abrir', en: 'Open' },
  tags: { es: 'Antes de aplicar cambios', en: 'Before applying changes' },
  deshacer: { es: 'Antes de deshacer cambios', en: 'Before undoing changes' },
  archivos: { es: (k: number) => cant(k, 'archivo', 'archivos'), en: (k: number) => cant(k, 'file', 'files') },
  // sin nada elegido, sin el número ("Mandar 0 respaldos" se leía raro: capturas del 24/10)
  borrar: { es: (k: number) => (k ? `Mandar ${cant(k, 'respaldo', 'respaldos')} a la papelera` : 'Mandar a la papelera'), en: (k: number) => (k ? `Send ${cant(k, 'backup', 'backups')} to the trash` : 'Send to the trash') },
  borrarPreg: { es: (k: number, b: string) => `¿Mandar ${cant(k, 'respaldo', 'respaldos')} a la papelera (${b})?`, en: (k: number, b: string) => `Send ${cant(k, 'backup', 'backups')} to the trash (${b})?` },
  borrados: {
    es: (k: number, b: string) => `${k === 1 ? 'Se mandó' : 'Se mandaron'} ${cant(k, 'respaldo', 'respaldos')} a la papelera de PAILA (${b}). El lugar se libera al vaciarla.`,
    en: (k: number, b: string) => `${cant(k, 'backup was', 'backups were')} sent to PAILA's trash (${b}). The space is freed when you empty it.`,
  },
  todos: { es: 'Elegir todos', en: 'Select all' },
  enPapelera: { es: (k: number) => `En la papelera de PAILA (${k})`, en: (k: number) => `In PAILA's trash (${k})` },
  enPapeleraTip: {
    es: 'Respaldos que mandaste a la papelera. Se recuperan hasta que vacíes la papelera (Espacio → Papelera); recién ahí se borran de verdad.',
    en: 'Backups you sent to the trash. They can be recovered until you empty the trash (Space → Trash); only then are they deleted for real.',
  },
  recuperar: { es: 'Recuperar', en: 'Recover' },
  recuperado: { es: 'El respaldo volvió a su lugar y vuelve a servir para deshacer.', en: 'The backup is back in its place and works for undoing again.' },
})

export default function Respaldos() {
  const [dir, setDir] = useState<string | null>(null)
  const [list, setList] = useState<BackupInfo[]>([])
  const [trashed, setTrashed] = useState<BackupInfo[]>([])
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [res, setRes] = useState<ResultadoTanda | null>(null)
  const load = async () => { setDir(await window.paila.backupDir()); setList(await window.paila.backups()); setTrashed(await window.paila.backupsTrashed()) }
  useEffect(() => { void load() }, [])

  const pick = async () => {
    const r = await window.paila.backupDirPick()
    if (!r) return
    setError(r.error); setDir(r.dir)
  }
  const reset = async () => { setError(null); setDir(await window.paila.backupDirReset()) }
  const toggle = (id: number) => setSel((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x })
  const elegidos = list.filter((b) => sel.has(b.id))
  const borrar = async (ids: number[]) => {
    const r = await window.paila.backupsDelete(ids)
    setRes({ hechos: T.borrados(r.moved, bytes(r.bytes)), fallados: r.failed })
    setSel(new Set()); await load(); papeleraCambio()
  }
  const recuperar = async (id: number) => {
    setError(null)
    try { await window.paila.backupRestore(id); setRes({ hechos: T.recuperado, fallados: [] }) } catch (e) { setError((e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')) }
    await load(); papeleraCambio()
  }
  // "viejos": de hace más de 30 días, y las copias completas de la 0.5.3 (nunca se borran solos: es una oferta, con su confirmación)
  const viejos = list.filter((b) => !b.light || Date.now() - new Date(b.createdAt).getTime() > 30 * 86400e3)
  const linea = (b: BackupInfo) => <>{fechaHora(b.createdAt)} · {b.op === 'deshacer-tags' ? T.deshacer : T.tags} · {T.archivos(b.files)} · {bytes(b.bytes)}</>

  return (
    <>
      <h4>{T.titulo} <Info tip={T.tip} /></h4>
      <p className="muted small">{T.explica}</p>
      <div className="actionrow">
        <span>{T.van} <b>{dir ?? T.deFabrica}</b></span>
        <Boton variant="ghost" size="sm" onClick={pick}>{T.elegir}</Boton>
        {dir && <Boton variant="ghost" size="sm" onClick={reset}>{T.volver}</Boton>}
      </div>
      {error && <Aviso tone="atencion">{error}</Aviso>}
      {list.length === 0 ? <p className="muted small">{T.ninguno}</p> : (<>
        <div className="listbox">
          {list.map((b) => (
            <div key={b.id} className="listbox-row">
              <label>
                <input type="checkbox" checked={sel.has(b.id)} onChange={() => toggle(b.id)} />{' '}
                {linea(b)}
                {!b.light && <> <Pildora tone="atencion" title={T.completoTip}>{T.completo}</Pildora></>}
                {!b.complete && <> <Pildora tone="atencion" title={b.light ? T.incompletoTip : T.incompletoViejoTip}>{T.incompleto}</Pildora></>}
                {!b.exists && <span className="muted"> · {T.yaNoEsta}</span>}
              </label>
              {b.exists && <button className="link" onClick={() => window.paila.openFolder(b.dir)} title={b.dir}>{T.abrir}</button>}
            </div>
          ))}
        </div>
        <div className="actionrow">
          <Boton variant="ghost" size="sm" onClick={() => setSel(new Set(list.map((b) => b.id)))}>{T.todos}</Boton>
          <ConfirmarBoton deshacer="respaldos" disabled={!sel.size} onSi={() => borrar([...sel])} pregunta={T.borrarPreg(sel.size, bytes(elegidos.reduce((s, b) => s + b.bytes, 0)))}>{T.borrar(sel.size)}</ConfirmarBoton>
          <span title={viejos.length ? T.viejosTip : T.viejosNinguno}>
            <ConfirmarBoton deshacer="respaldos" variant="ghost" disabled={!viejos.length} onSi={() => borrar(viejos.map((b) => b.id))} pregunta={T.viejosPreg(viejos.length, bytes(viejos.reduce((s, b) => s + b.bytes, 0)))}>{T.viejos(viejos.length)}</ConfirmarBoton>
          </span>
        </div>
      </>)}
      {trashed.length > 0 && (<>
        <h5>{T.enPapelera(trashed.length)} <Info tip={T.enPapeleraTip} /></h5>
        <div className="listbox">
          {trashed.map((b) => (
            <div key={b.id} className="listbox-row">
              <span className="muted">{linea(b)}{!b.light && <> <Pildora tone="atencion" title={T.completoTip}>{T.completo}</Pildora></>}</span>
              <button className="link" onClick={() => recuperar(b.id)} title={b.trashDir ?? ''}>{T.recuperar}</button>
            </div>
          ))}
        </div>
      </>)}
      {res && <Resultado r={res} onCerrar={() => setRes(null)} />}
    </>
  )
}
