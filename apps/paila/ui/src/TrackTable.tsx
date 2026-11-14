// Tabla de temas: columnas, orden, selección múltiple, edición en la celda y arrastre hacia playlists.
import { Icon } from './icons'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { generoPrincipal } from '@paila/shared/generos'
import type { EditableField, Track } from '@paila/shared/types'
import { SORT_VALUES as V, type SortKey } from '@paila/shared/trackinfo'
import { bytes, display, duration, folder, format, sampleRate } from './format'
import { DRAG_TYPE } from './Playlists'
import EmptyState from './EmptyState'
import type { TableRows } from './hooks/useBigTable'
import { GRADE_HELP, hasFlag } from './problems'
import { Boton, Info, Nota, filaAlto, useCabina } from '@paila/diseno'
import { defaultColumns } from '@paila/shared/profile'
import { useProfile } from './profile'
import { useDensidad } from './hooks/useDensidad'
import { camelotColor } from './camelot'
import { colorDe, iniciales, useThumb } from './thumbs'
import { Sello } from './sellos'
import { useEstilo } from '@paila/diseno'
import { bpmShown } from './tempo'
import { T } from './TrackTable.textos'

/** Temas de Música que todavía no tienen la pasada precisa (BPM y tono en gris). */
const pending = (t: Track) => t.kind === 'musica' && !hasFlag(t, 'dj_precise')
/** Todavía no se analizó (ni nota ni veredicto): la celda dice que falta, en vez de quedar en blanco. */
const notYet = (t: Track) => !t.grade && !t.isLabel && !t.error && !t.missing
const Falta = ({ dj }: { dj?: boolean }) => <span className="muted sin-analizar" title={dj ? T.sinDj : T.sinAnalizar}>…</span>
const djTitle = (t: Track, what: 'bpm' | 'key') => {
  if (pending(t)) return T.estimado
  if (!hasFlag(t, 'dj_precise')) return ''
  if (what === 'bpm') return hasFlag(t, 'bpm_doubtful') ? T.bpmDudoso : hasFlag(t, 'bpm_ok') ? T.bpmOk : T.revisado
  return hasFlag(t, 'key_doubtful') ? T.keyDudoso : hasFlag(t, 'key_ok') ? T.bpmOk : T.revisado
}

export type { SortKey }

interface Column {
  key: SortKey
  label: string
  width: string
  help?: string
  num?: boolean
  value: (t: Track) => string | number
  render?: (t: Track) => React.ReactNode
}

export const COLUMNS: Column[] = [
  {
    key: 'artist', label: T.artista, width: 'minmax(100px, 1.2fr)', value: V.artist,
    render: (t) => { const d = display(t); return <span className={d.fromName && d.artist ? 'from-name' : ''}>{d.artist}</span> },
  },
  {
    key: 'title', label: T.titulo, width: 'minmax(140px, 1.8fr)', value: V.title,
    render: (t) => {
      const d = display(t)
      return <span className={d.fromName ? 'from-name' : ''} title={d.fromName ? T.sinTags : undefined}>{d.title}</span>
    },
  },
  {
    key: 'grade', label: T.nota, width: '54px', value: V.grade,
    help: T.notaHelp,
    render: (t) => (t.grade ? <Nota grade={t.grade} title={`${t.isLabel || ''}. ${GRADE_HELP[t.grade]}`} /> : notYet(t) ? <Falta /> : null),
  },
  {
    key: 'bpm', label: 'BPM', width: '66px', num: true, value: V.bpm,
    help: T.bpmHelp,
    render: (t) => t.bpm == null ? (t.kind === 'musica' && !t.error && !t.missing ? <Falta dj={!notYet(t)} /> : null) : <span className={hasFlag(t, 'bpm_doubtful') ? 'doubt' : pending(t) ? 'muted' : ''} title={bpmShown(t)!.title ?? djTitle(t, 'bpm')}>
      {hasFlag(t, 'bpm_doubtful') && <Icon name="alert" size={12} className="ic-inline" />}{bpmShown(t)!.text}{hasFlag(t, 'bpm_ok') && !hasFlag(t, 'bpm_doubtful') && <span className="ok-mark"> <Icon name="check" size={12} className="ic-inline" /></span>}
    </span>,
  },
  {
    key: 'camelot', label: T.tono, width: '62px', value: V.camelot,
    help: T.tonoHelp,
    render: (t) => !t.camelot ? (t.kind === 'musica' && !t.error && !t.missing ? <Falta dj={!notYet(t)} /> : null) : <span className={`tono ${hasFlag(t, 'key_doubtful') ? 'doubt' : pending(t) ? 'pend' : ''}`} title={[t.musicKey, djTitle(t, 'key')].filter(Boolean).join(' · ')}>
      {hasFlag(t, 'key_doubtful') && <Icon name="alert" size={12} className="ic-inline" />}<b className="camelot" style={{ background: camelotColor(t.camelot) ?? undefined }}>{t.camelot}</b>{hasFlag(t, 'key_ok') && <span className="ok-mark"> <Icon name="check" size={12} className="ic-inline" /></span>}
    </span>,
  },
  {
    key: 'energy', label: T.energia, width: '64px', num: true, value: V.energy,
    help: T.energiaHelp,
    render: (t) => t.energy != null && <span className="energia" title={T.energiaDe(t.energy)} aria-label={T.energiaDe(t.energy)}>{Array.from({ length: 10 }, (_, i) => <i key={i} className={i < t.energy! ? (i >= 7 ? 'on alta' : 'on') : ''} />)}</span>,
  },
  { key: 'album', label: T.album, width: 'minmax(90px, 1.1fr)', value: V.album, render: (t) => t.album },
  { key: 'year', label: T.anio, width: '56px', num: true, value: V.year, render: (t) => t.year },
  { key: 'genre', label: T.genero, width: 'minmax(60px, .6fr)', value: V.genre, render: (t) => generoPrincipal(t.genre) }, // uno solo; todos, en la ficha
  {
    key: 'format', label: T.formato, width: '68px', value: V.format,
    help: T.formatoHelp,
    render: (t) => <span className={`fmt fmt-${format(t).toLowerCase()}`}>{format(t)}</span>,
  },
  {
    key: 'kbps', label: 'kbps', width: '92px', num: true, value: V.kbps,
    render: (t) => <>{t.kbps}{t.kbps != null && t.effKbps != null && t.effKbps < t.kbps * 0.85 && !['FLAC', 'WAV', 'AIFF', 'ALAC'].includes(format(t)) && <span className="kbps-real solo-actual" title={T.diceKbps(t.kbps, Math.round(t.effKbps))}> → ~{Math.round(t.effKbps)}</span>} <Sello t={t} /></>,
    help: T.kbpsHelp,
  },
  {
    key: 'sampleRate', label: T.muestreo, width: '104px', num: true, value: V.sampleRate, render: sampleRate,
    help: T.muestreoHelp,
  },
  { key: 'duration', label: T.duracion, width: '72px', num: true, value: V.duration, render: (t) => duration(t.duration) },
  { key: 'size', label: T.tamanio, width: '78px', num: true, value: V.size, render: (t) => bytes(t.size) },
  { key: 'folder', label: T.carpeta, width: 'minmax(90px, 1.3fr)', value: V.folder, render: (t) => <span className="muted">{folder(t)}</span> },
]

/** En la tabla cómoda, Artista y Título se unen en una sola columna de dos renglones. */
const TEMA: Column = {
  key: 'title', label: T.tema, width: 'minmax(220px, 3fr)', value: V.title,
  render: (t) => {
    const d = display(t)
    return (
      <div className="tema" title={d.fromName ? T.sinTags : undefined}>
        <div className={`t1${d.fromName ? ' from-name' : ''}`}>{d.title}</div>
        <div className="t2">{d.artist}</div>
      </div>
    )
  },
}
const temaUnido = (cols: Column[], compacta: boolean): Column[] => {
  const i = cols.findIndex((c) => c.key === 'artist' || c.key === 'title')
  if (compacta || i < 0) return cols
  const resto = cols.filter((c) => c.key !== 'artist' && c.key !== 'title')
  resto.splice(i, 0, TEMA)
  return resto
}

/** Columnas que se editan en la celda: clic en la fila ya elegida (como renombrar en el Explorador). */
const CELL_FIELD: Partial<Record<SortKey, [EditableField, keyof Track]>> = {
  // idioma-ok (nombres de campos)
  artist: ['artist', 'artist'], title: ['title', 'title'], album: ['album', 'album'], year: ['year', 'year'], genre: ['genre', 'genre'],
}

/** Columnas que se ven de entrada: las que más se usan para elegir qué escuchar, tocar o arreglar. El resto se activa desde "Columnas". */
const BASE_COLS: SortKey[] = ['artist', 'title', 'grade', 'album', 'year', 'format', 'kbps']
/** Las que suman las herramientas para DJ y producción (el orden de la tabla es el de COLUMNS, no el de esta lista). */
const DJ_COLS: SortKey[] = ['bpm', 'camelot']

/** Qué columnas se ven (se acuerda en esta compu). `setAll`: las de una vista guardada (null = las de fábrica del perfil). */
export function useColumns(): [Set<SortKey>, (k: SortKey) => void, (keys: SortKey[] | null) => void] {
  const { djTools } = useProfile()
  const fromProfile = () => new Set(defaultColumns(djTools, BASE_COLS, DJ_COLS))
  const [shown, setShown] = useState<Set<SortKey>>(() => {
    try { const v = JSON.parse(localStorage.getItem('paila.cols') ?? 'null') as SortKey[] | null; if (v?.length) return new Set(v) } catch { /* sin almacenamiento */ }
    return fromProfile()
  })
  // al prender o apagar las herramientas para DJ, las columnas vuelven a las de fábrica (lo elegido a mano se borra al guardarlas)
  const key = djTools
  const last = useRef<boolean>(key)
  useEffect(() => {
    if (last.current === key) return
    last.current = key
    let custom = false // si ya había elegido columnas a mano y la opción recién terminó de cargar, se respetan
    try { custom = localStorage.getItem('paila.cols') != null } catch { /* sin almacenamiento */ }
    if (!custom) setShown(fromProfile())
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (k: SortKey) => setShown((prev) => {
    const next = new Set(prev)
    if (next.has(k)) { if (next.size > 2) next.delete(k) } else next.add(k) // siempre queda alguna columna
    try { localStorage.setItem('paila.cols', JSON.stringify([...next])) } catch { /* sin almacenamiento */ }
    return next
  })
  const setAll = (keys: SortKey[] | null) => {
    const valid = (keys ?? []).filter((k) => COLUMNS.some((c) => c.key === k))
    try { if (valid.length >= 2) localStorage.setItem('paila.cols', JSON.stringify(valid)); else localStorage.removeItem('paila.cols') } catch { /* sin almacenamiento */ }
    setShown(valid.length >= 2 ? new Set(valid) : fromProfile())
  }
  return [shown, toggle, setAll]
}
/** La tapita de la fila (se pide si la fila queda a la vista un momento: al scrollear rápido no se piden todas). */
function TapaFila({ t }: { t: Track }) {
  const src = useThumb(t.id, 180)
  const name = display(t).artist || display(t).title
  return <div className="tapa-fila">{src ? <img src={src} alt="" /> : <span style={{ background: colorDe(name) }}>{iniciales(name)}</span>}</div>
}
function useTapas(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(() => { try { return localStorage.getItem('paila.tapas') !== '0' } catch { return true } })
  return [on, (v) => { try { localStorage.setItem('paila.tapas', v ? '1' : '0') } catch { /* sin almacenamiento */ } setOn(v) }]
}

/** Filas de más que se piden arriba y abajo de lo visible (biblioteca grande). */
const PREFETCH = 60

interface Props {
  /** Los temas a la vista (de la lista completa o, en una biblioteca grande, pedidos de a poco al proceso principal). */
  rows: TableRows
  sort: { key: SortKey; dir: 1 | -1 }
  onSort: (key: SortKey) => void
  selected: number | null
  multi: Set<number>
  /** Temas que se arrastran al soltar una fila sobre una playlist. */
  dragIds: (id: number) => number[]
  /** Cambios pendientes de tags, por "id:campo" (valor nuevo). */
  pending: Map<string, string | null>
  onEdit: (id: number, field: EditableField, value: string | null) => void
  onSelect: (id: number, mod: { ctrl: boolean; shift: boolean }) => void
  onOpen: (id: number) => void
  /** Las columnas que se ven (useColumns, en App: las usan las vistas guardadas y "A Excel"). */
  shown: Set<SortKey>
  onToggleCol: (k: SortKey) => void
}

export default function TrackTable({ rows, sort, onSort, selected, multi, dragIds, pending, onEdit, onSelect, onOpen, shown, onToggleCol: toggleCol }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  // en una ventana angosta la tabla se desplaza de costado: el encabezado la acompaña (antes quedaba quieto, desalineado, y
  // empujaba toda la ventana con una segunda barra de desplazamiento; prueba de usabilidad, pantalla chica, 27/10/2026)
  const headRef = useRef<HTMLDivElement>(null)
  const [cabina] = useCabina()
  const [compacta, setCompacta] = useDensidad(rows.ids.length)
  const ROW_H = filaAlto(cabina, compacta) // más alta en cómoda y en modo cabina (letra más grande)
  const virt = useVirtualizer({ count: rows.ids.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_H, overscan: 20 })
  useEffect(() => { virt.measure() }, [ROW_H]) // eslint-disable-line react-hooks/exhaustive-deps
  const items = virt.getVirtualItems()
  // biblioteca grande: pedir las filas que se ven y unas cuantas más arriba y abajo (al desplazarse ya están)
  const first = items[0]?.index ?? 0, last = items[items.length - 1]?.index ?? -1
  useEffect(() => { if (last >= first) rows.need(rows.ids.slice(Math.max(0, first - PREFETCH), last + 1 + PREFETCH), first) }, [first, last, rows])
  const [editing, setEditing] = useState<{ id: number; key: SortKey } | null>(null)
  const lastClick = useRef({ id: -1, t: 0 })
  const [colsOpen, setColsOpen] = useState(false)
  const [tapas, setTapas] = useTapas()
  const cols = useMemo(() => temaUnido(COLUMNS.filter((c) => shown.has(c.key)), compacta), [shown, compacta])
  const tapaW = compacta ? (cabina ? 34 : 26) : (cabina ? 50 : 40)
  // en historieta la columna kbps lleva el sello (SUENA A ~128, SIN PÉRDIDA…) y los encabezados en Anton ocupan más: más ancho
  const [estilo] = useEstilo()
  const style = useMemo(() => {
    // en cabina la letra es más grande: "320 → ~128" no entraba en 92px
    const ancho = (c: Column) => (estilo !== 'historieta' ? (c.key === 'kbps' && cabina ? '132px' : c.width) : c.key === 'kbps' ? '180px' : c.key === 'format' ? '84px' : c.width)
    return { gridTemplateColumns: (tapas ? `${tapaW}px ` : '') + cols.map(ancho).join(' ') + ' 30px' }
  }, [cols, tapas, tapaW, estilo, cabina])

  return (
    <div className={`table dens-${compacta ? 'compacta' : 'comoda'}`}>
      <div className="thead" ref={headRef} style={style}>
        {tapas && <div className="th" />}
        {cols.map((c) => c === TEMA ? (
          <div key={c.key} className="th th-dual">
            {(['title', 'artist'] as const).map((k) => <button key={k} onClick={() => onSort(k)}>{k === 'title' ? T.tema : T.artista}{sort.key === k && <span className="arrow"><Icon name={sort.dir === 1 ? 'up' : 'down'} size={12} /></span>}</button>)}
          </div>
        ) : (
          <button key={c.key} className={`th ${c.num ? 'num' : ''}`} onClick={() => onSort(c.key)} title={c.help}>
            {c.label}{c.help && <span className="info">ⓘ</span>}
            {sort.key === c.key && <span className="arrow"><Icon name={sort.dir === 1 ? 'up' : 'down'} size={12} /></span>}
          </button>
        ))}
        <button className="th cols-toggle" onClick={() => setColsOpen((o) => !o)} title={T.elegirCols} aria-label={T.columnas}>⋯</button>
        {colsOpen && (
          <div className="cols-menu" onMouseLeave={() => setColsOpen(false)}>
            <b className="small">{T.densidad}<Info tip={T.densidadTip} /></b>
            <div className="row" style={{ gap: 6 }}>
              <Boton size="sm" variant={compacta ? 'ghost' : 'primary'} onClick={() => setCompacta(false)}><Icon name="comoda" size={14} /> {T.comoda}</Boton>
              <Boton size="sm" variant={compacta ? 'primary' : 'ghost'} onClick={() => setCompacta(true)}><Icon name="compacta" size={14} /> {T.compacta}</Boton>
            </div>
            <label><input type="checkbox" checked={tapas} onChange={() => setTapas(!tapas)} />{T.tapas}</label>
            <b className="small">{T.columnas}</b>
            {COLUMNS.map((c) => <label key={c.key}><input type="checkbox" checked={shown.has(c.key)} onChange={() => toggleCol(c.key)} />{c.label}</label>)}
          </div>
        )}
      </div>
      <div className="tbody" ref={scrollRef} onScroll={(e) => { if (headRef.current) headRef.current.style.transform = `translateX(${-e.currentTarget.scrollLeft}px)` }} tabIndex={0} aria-label={T.lista} onKeyDown={(e) => {
        if (editing || (e.target as HTMLElement).tagName === 'INPUT') return
        if (e.key === 'Enter' && selected != null) { e.preventDefault(); onOpen(selected); return }
        const dir = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
        if (!dir || e.ctrlKey || e.metaKey || e.shiftKey || !rows.ids.length) return
        e.preventDefault()
        const at = selected == null ? -1 : rows.ids.indexOf(selected)
        const to = Math.max(0, Math.min(rows.ids.length - 1, at + (at < 0 ? (dir > 0 ? 1 : 0) : dir)))
        onSelect(rows.ids[to], { ctrl: false, shift: false })
        virt.scrollToIndex(to)
      }}>
        <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
          {items.map((v) => {
            const id = rows.ids[v.index]
            const t = rows.get(id)
            // todavía en camino (biblioteca grande): una fila vacía del mismo alto
            if (!t) return <div key={id} data-id={id} className="tr loading-row" style={{ ...style, height: ROW_H, transform: `translateY(${v.start}px)` }}>{tapas && <div className="td" />}<div className="td muted">…</div></div>
            return (
              <div
                key={t.id}
                className={`tr ${selected === t.id || multi.has(t.id) ? 'sel' : ''} ${t.error ? 'err' : ''} ${t.missing ? 'missing' : ''}`}
                title={t.missing ? T.desaparecido : undefined}
                style={{ ...style, height: ROW_H, transform: `translateY(${v.start}px)` }}
                onClick={(e) => {
                  const wasOnly = selected === t.id && multi.size <= 1 && !e.ctrlKey && !e.metaKey && !e.shiftKey
                  const slow = Date.now() - lastClick.current.t > 450 && lastClick.current.id === t.id
                  const col = (e.target as HTMLElement).closest('[data-col]')?.getAttribute('data-col') as SortKey | null
                  lastClick.current = { id: t.id, t: Date.now() }
                  if (wasOnly && slow && col && CELL_FIELD[col] && !['wma', 'wmv', 'asf'].includes(t.ext)) { setEditing({ id: t.id, key: col }); return }
                  onSelect(t.id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })
                }}
                draggable={!editing}
                onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(dragIds(t.id))); e.dataTransfer.effectAllowed = 'copy' }}
                onDoubleClick={() => { setEditing(null); onOpen(t.id) }}
              >
                {tapas && <div className="td td-tapa"><TapaFila t={t} /></div>}
                {cols.map((c) => {
                  const cf = CELL_FIELD[c.key]
                  const pend = cf && pending.has(`${t.id}:${cf[0]}`) ? pending.get(`${t.id}:${cf[0]}`) ?? '' : undefined
                  if (cf && editing && editing.id === t.id && editing.key === c.key) {
                    const cur = pend ?? ((t[cf[1]] as string | null) ?? '')
                    const done = (v: string) => { setEditing(null); if (v.trim() !== cur.trim()) onEdit(t.id, cf[0], v.trim() || null) }
                    return (
                      <div key={c.key} className="td" data-col={c.key}>
                        <input className="cell-input" autoFocus defaultValue={cur} onClick={(e) => e.stopPropagation()}
                          onBlur={(e) => done(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') done((e.target as HTMLInputElement).value); if (e.key === 'Escape') setEditing(null) }} />
                      </div>
                    )
                  }
                  return (
                    <div key={c.key} data-col={c.key} className={`td ${c.num ? 'num' : ''} ${pend !== undefined ? 'pend' : ''}`}>
                      {pend !== undefined ? pend || T.vacio : c.render ? c.render(t) : c.value(t)}
                    </div>
                  )
                })}
                <div className="td" />
              </div>
            )
          })}
        </div>
        {!rows.ids.length && rows.loading && <div className="center"><div className="spinner" /></div>}
        {!rows.ids.length && !rows.loading && <EmptyState title={T.nadaT}>{T.nada}</EmptyState>}
      </div>
    </div>
  )
}
