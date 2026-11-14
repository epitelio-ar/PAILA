// Herramientas de la tabla: "Guardar vista" y "A Excel" en la cabecera de la biblioteca, y la lista de vistas guardadas de la
// barra lateral (volver a una, renombrarla o borrarla). Ver hooks/useSavedViews.ts y core/views.ts.
import { useState } from 'react'
import type { SavedView } from '@paila/shared/types'
import type { SortKey } from '@paila/shared/trackinfo'
import { Boton, Info } from '@paila/diseno'
import { textos, cant } from '@paila/shared/idioma'
import { Icon } from './icons'
import { COLUMNS } from './TrackTable'
import { toast } from './toast'

const T = textos({
  vistaTip: {
    es: 'Una vista guardada recuerda cómo dejaste la tabla: la colección, el filtro, lo que buscaste, el orden y las columnas. Aparece en la barra lateral para volver con un clic. No cambia nada de tu música.',
    en: "A saved view remembers how you left the table: the collection, the filter, what you searched for, the order and the columns. It shows up in the sidebar so you can go back with one click. It doesn't change anything in your music.",
  },
  excelTip: {
    es: 'Guarda la tabla como la ves (los temas a la vista, en su orden y con las columnas que se ven) en un archivo .csv: se abre con doble clic en Excel, Google Sheets o LibreOffice, con los acentos bien.',
    en: 'Saves the table as you see it (the tracks in view, in their order and with the visible columns) in a .csv file: double-click to open it in Excel, Google Sheets or LibreOffice, with accents intact.',
  },
  listo: { es: (n: number, archivo: string | undefined) => `Listo: ${cant(n, 'tema', 'temas')} en ${archivo}`, en: (n: number, archivo: string | undefined) => `Done: ${cant(n, 'track', 'tracks')} in ${archivo}` },
  guardada: { es: (nombre: string) => `Vista «${nombre}» guardada: está en la barra lateral`, en: (nombre: string) => `View «${nombre}» saved: it's in the sidebar` },
  nombreVista: { es: 'Nombre de la vista', en: 'View name' },
  guardar: { es: 'Guardar', en: 'Save' },
  cancelar: { es: 'Cancelar', en: 'Cancel' },
  guardarTip: { es: 'Guardar los filtros, el orden y las columnas de ahora con un nombre', en: 'Save the current filters, order and columns under a name' },
  vistaActiva: { es: (nombre: string) => `Vista «${nombre}»`, en: (nombre: string) => `View «${nombre}»` },
  guardarVista: { es: 'Guardar vista', en: 'Save view' },
  aExcel: { es: 'A Excel', en: 'To Excel' },
  nuevoNombre: { es: 'Nuevo nombre de la vista', en: 'New name for the view' },
  borrar: { es: (nombre: string) => `¿Borrar «${nombre}»?`, en: (nombre: string) => `Delete «${nombre}»?` },
  si: { es: 'Sí', en: 'Yes' },
  no: { es: 'No', en: 'No' },
  volver: {
    es: (busca: string) => `Volver a esta vista${busca ? ` (busca «${busca}»)` : ''}. Doble clic para renombrar.`,
    en: (busca: string) => `Go back to this view${busca ? ` (searches «${busca}»)` : ''}. Double-click to rename.`,
  },
  borrarTip: { es: 'Borrar esta vista (tu música no se toca)', en: "Delete this view (your music isn't touched)" },
  borrarAria: { es: (nombre: string) => `Borrar la vista ${nombre}`, en: (nombre: string) => `Delete the view ${nombre}` },
})

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')

export const VISTA_TIP = T.vistaTip
export const EXCEL_TIP = T.excelTip

/** Los temas a la vista a un .csv para Excel, con las columnas que se ven. */
export async function toExcel(ids: number[], shown: Set<SortKey>, name: string) {
  try {
    const cols = COLUMNS.filter((c) => shown.has(c.key)).map((c) => ({ key: c.key, label: c.label }))
    const r = await window.paila.tableCsv(ids, cols, name)
    if (r) toast(T.listo(r.count, r.path.split(/[\\/]/).pop()), 'ok')
    return r
  } catch (e) { toast(clean(e), 'error'); return null }
}

/** "Guardar vista" (con su nombre) y "A Excel", para la cabecera de la biblioteca. */
export function TablaAcciones({ suggested, active, onSave, onExcel }: { suggested: string; active: string | null; onSave: (name: string) => Promise<unknown>; onExcel: () => void }) {
  const [naming, setNaming] = useState<string | null>(null)
  const save = async () => {
    if (!naming?.trim()) return
    try { await onSave(naming); toast(T.guardada(naming.trim()), 'ok'); setNaming(null) } catch (e) { toast(clean(e), 'error') }
  }
  return (
    <span className="tabla-acciones">
      {naming != null ? (
        <span className="row" style={{ gap: 6 }}>
          <input autoFocus type="text" value={naming} maxLength={60} placeholder={T.nombreVista} aria-label={T.nombreVista} onChange={(e) => setNaming(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') setNaming(null) }} />
          <Boton size="sm" disabled={!naming.trim()} onClick={save}>{T.guardar}</Boton>
          <Boton size="sm" variant="ghost" onClick={() => setNaming(null)}>{T.cancelar}</Boton>
        </span>
      ) : (
        <Boton size="sm" variant="ghost" onClick={() => setNaming(active ?? suggested)} title={T.guardarTip}>
          <Icon name="plus" size={13} /> {active ? T.vistaActiva(active) : T.guardarVista}
        </Boton>
      )}
      <Info tip={VISTA_TIP} />
      <Boton size="sm" variant="ghost" onClick={onExcel} title={EXCEL_TIP}>{T.aExcel}</Boton>
    </span>
  )
}

/** Las vistas guardadas en la barra lateral: clic para volver; renombrar o borrar con los botones chicos. */
export function VistasLista({ views, active, onApply, onRemove, onRename }: { views: SavedView[]; active: string | null; onApply: (v: SavedView) => void; onRemove: (id: string) => void; onRename: (id: string, name: string) => Promise<void> }) {
  const [editing, setEditing] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  return (
    <>
      {views.map((v) => editing === v.id ? (
        <input key={v.id} autoFocus className="side-input" defaultValue={v.name} maxLength={60} aria-label={T.nuevoNombre}
          onBlur={(e) => { setEditing(null); if (e.target.value.trim() && e.target.value !== v.name) onRename(v.id, e.target.value).catch((err) => toast(clean(err), 'error')) }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null) }} />
      ) : confirm === v.id ? (
        <div key={v.id} className="side-item side-confirm small">
          {T.borrar(v.name)} <button className="link" onClick={() => { setConfirm(null); onRemove(v.id) }}>{T.si}</button> <button className="link" onClick={() => setConfirm(null)}>{T.no}</button>
        </div>
      ) : (
        <div key={v.id} className={`side-item side-vista ${active === v.id ? 'on' : ''}`} role="button" tabIndex={0} title={T.volver(v.query ?? '')}
          onClick={() => onApply(v)} onDoubleClick={() => setEditing(v.id)} onKeyDown={(e) => { if (e.key === 'Enter') onApply(v) }}>
          <Icon name="search" className="side-ico" /><span className="side-label">{v.name}</span>
          <button className="side-x" title={T.borrarTip} aria-label={T.borrarAria(v.name)} onClick={(e) => { e.stopPropagation(); setConfirm(v.id) }}><Icon name="close" size={11} /></button>
        </div>
      ))}
    </>
  )
}
