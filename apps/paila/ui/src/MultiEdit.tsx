// Panel de edición de varios temas a la vez: cambiar tags en conjunto y aplicar acciones sobre la selección.
import { Icon } from './icons'
import { useState } from 'react'
import { useEffect } from 'react'
import type { EditableField, PendingChange, SavedAction, TagAction, Track } from '@paila/shared/types'
import { Aviso, Boton } from '@paila/diseno'
import { ClearField } from './Detail'
import { textos, cant } from '@paila/shared/idioma'

const T = textos({
  mejorarNapia: { es: (n: number) => `Buscar mejor copia con NAPIA (${n})`, en: (n: number) => `Look for better copies with NAPIA (${n})` },
  mejorarNapiaTip: { es: 'Abre NAPIA con estos temas y la nota de cada copia tuya: solo se queda con las claramente mejores. Lo que baje llega a la Bandeja.', en: 'Opens NAPIA with these tracks and the grade of each of your copies: it only keeps clearly better ones. What it downloads reaches the Inbox.' },
  artist: { es: 'Artista', en: 'Artist' },
  albumArtist: { es: 'Artista del álbum', en: 'Album artist' },
  title: { es: 'Título', en: 'Title' },
  album: { es: 'Álbum', en: 'Album' },
  track: { es: 'N.º de tema', en: 'Track no.' },
  year: { es: 'Año', en: 'Year' },
  genre: { es: 'Género', en: 'Genre' },
  propuestos: { es: (k: number) => `${k} cambios propuestos. Revisalos arriba en "Cambios pendientes" antes de aplicar.`, en: (k: number) => `${cant(k, 'change', 'changes')} suggested. Review them above in "Pending changes" before applying.` },
  nada: { es: 'No hay nada para cambiar con esa acción.', en: 'Nothing to change with that action.' },
  seleccionados: { es: (k: number) => `${k} temas seleccionados`, en: (k: number) => `${cant(k, 'track', 'tracks')} selected` },
  intro: { es: 'Lo que escribís se aplica a todos. Queda pendiente hasta que apretás Aplicar. Ctrl+clic suma temas, Mayús+clic selecciona un rango.', en: 'What you type is applied to all of them. It stays pending until you press Apply. Ctrl+click adds tracks, Shift+click selects a range.' },
  quitar: { es: 'Quitar selección', en: 'Clear selection' },
  wma: { es: (k: number) => `${k} temas .wma se saltean: no se pueden editar sin riesgo.`, en: (k: number) => `${cant(k, '.wma track is', '.wma tracks are')} skipped: they cannot be edited safely.` },
  tags: { es: 'Tags', en: 'Tags' },
  varios: { es: '‹varios›', en: '‹several›' },
  acciones: { es: 'Acciones', en: 'Actions' },
  reemplazarTexto: { es: 'Reemplazar texto', en: 'Replace text' },
  buscarPh: { es: 'Buscar (ej: [HD] o _)', en: 'Find (e.g. [HD] or _)' },
  reemplazarPh: { es: 'Reemplazar por (vacío = borrar)', en: 'Replace with (empty = delete)' },
  regex: { es: ' Expresión regular (avanzado)', en: ' Regular expression (advanced)' },
  proponer: { es: 'Sumar a lo que vas a aplicar', en: 'Add to what you are going to apply' },
  mayMin: { es: 'Mayúsculas y minúsculas', en: 'Upper and lower case' },
  tipoTitulo: { es: 'Tipo Título', en: 'Title Case' },
  tipoTituloTip: { es: 'La Vida de los Gatos', en: 'The Life of the Cats' },
  primeraMay: { es: 'Primera mayúscula', en: 'Sentence case' },
  primeraMayTip: { es: 'La vida de los gatos', en: 'The life of the cats' },
  minus: { es: 'minúsculas', en: 'lowercase' },
  mayus: { es: 'MAYÚSCULAS', en: 'UPPERCASE' },
  numerarTitulo: { es: 'Numerar temas', en: 'Number tracks' },
  enOrden: { es: 'En el orden en que se ven en la tabla.', en: 'In the order they appear in the table.' },
  conCero: { es: ' Con cero adelante (01, 02…)', en: ' With a leading zero (01, 02…)' },
  numerar: { es: 'Numerar', en: 'Number them' },
  nombreATags: { es: 'Nombre de archivo → Tags', en: 'File name → Tags' },
  campos: { es: 'Campos: %n% %artista% %titulo% %album% %año% %genero%', en: 'Fields: %n% %artista% %titulo% %album% %año% %genero%' }, // idioma-ok
  proponerSolo: { es: 'Sumar a lo que vas a aplicar', en: 'Add to what you are going to apply' },
  tagsANombre: { es: 'Tags → Nombre de archivo', en: 'Tags → File name' },
  tagsANombreNota: { es: 'Cambia el nombre del archivo (no la carpeta ni la extensión). Los temas a los que les falta algún dato se saltean, y los sample packs nunca se renombran.', en: 'Changes the file name (not the folder or the extension). Tracks that are missing some data are skipped, and sample packs are never renamed.' },
  proponerNombres: { es: 'Sumar los nombres a lo que vas a aplicar', en: 'Add the names to what you are going to apply' },
  tapa: { es: 'Tapa', en: 'Cover' },
  mismaTapa: { es: 'Poner la misma tapa…', en: 'Use the same cover…' },
  tapaPropuesta: { es: 'Tapa propuesta para todos. Revisala arriba antes de aplicar.', en: 'Cover suggested for all of them. Review it above before applying.' },
  quitarTapas: { es: 'Quitar tapas', en: 'Remove covers' },
  mas: { es: 'Más', en: 'More' },
  carpetaTags: { es: 'Carpeta → Tags (solo vacíos)', en: 'Folder → Tags (empty ones only)' },
  carpetaTagsTip: { es: 'Completa artista, álbum y año vacíos con los nombres de las carpetas (Artista / 2008 - Álbum).', en: 'Fills in empty artist, album and year from the folder names (Artist / 2008 - Album).' },
  mojibake: { es: 'Arreglar caracteres rotos', en: 'Fix broken characters' },
  mojibakeTip: { es: 'Arregla García → García en título, artista, álbum y género.', en: 'Fixes García → García in title, artist, album and genre.' },
  youtube: { es: 'Limpieza YouTube', en: 'YouTube cleanup' },
  youtubeTip: { es: 'Saca (Official Video), [HD], www.sitio.com y separa Artista - Título.', en: 'Removes (Official Video), [HD], www.site.com and splits Artist - Title.' },
  guardadas: { es: 'Acciones guardadas', en: 'Saved actions' },
  guardadasVacio: { es: 'Corré una acción y guardala con un nombre para repetirla con un clic.', en: 'Run an action and save it with a name to repeat it with one click.' },
  borrarTip: { es: 'Borrar esta acción guardada', en: 'Delete this saved action' },
  nombrePh: { es: 'Nombre para guardar la última acción', en: 'Name to save the last action' },
  guardar: { es: 'Guardar', en: 'Save' },
})

const FIELDS: [EditableField, string, keyof Track][] = [
  ['artist', T.artist, 'artist'], ['albumArtist', T.albumArtist, 'albumArtist'], ['title', T.title, 'title'], ['album', T.album, 'album'],
  ['track', T.track, 'track'], ['year', T.year, 'year'], ['genre', T.genre, 'genre'],
]
const LABEL = Object.fromEntries(FIELDS.map(([f, l]) => [f, l])) as Record<EditableField, string>
const WMA = ['wma', 'wmv', 'asf']

/** Panel para varios temas seleccionados: campos con ‹varios› y acciones masivas. Todo queda como cambio pendiente. */
export default function MultiEdit({ tracks, pending, onStage, onAction, onClose }: {
  tracks: Track[]; pending: PendingChange[]
  onStage: (ids: number[], f: EditableField, v: string | null) => void
  onAction: (a: TagAction) => Promise<number>
  onClose: () => void
}) {
  const [msg, setMsg] = useState<string | null>(null)
  const [find, setFind] = useState('')
  const [repl, setRepl] = useState('')
  const [regex, setRegex] = useState(false)
  const [rfield, setRfield] = useState<EditableField>('title')
  const [cfield, setCfield] = useState<EditableField>('title')
  const [pattern, setPattern] = useState('%n% - %artista% - %titulo%')
  const [pad, setPad] = useState(true)
  const [saved, setSaved] = useState<SavedAction[]>([])
  const [last, setLast] = useState<TagAction | null>(null)
  const [saveName, setSaveName] = useState('')
  useEffect(() => { window.paila.savedActions().then(setSaved) }, [])
  const [namePattern, setNamePattern] = useState('%n% - %artista% - %titulo%')

  const ids = tracks.map((t) => t.id)
  const editable = tracks.filter((t) => !WMA.includes(t.ext))
  const effective = (t: Track, f: EditableField, key: keyof Track) => {
    const c = pending.find((p) => p.fileId === t.id && p.field === f)
    return c ? c.after ?? '' : (t[key] as string | null) ?? ''
  }
  const run = async (a: TagAction) => {
    try {
      const n = await onAction(a)
      setLast(a)
      setMsg(n ? T.propuestos(n) : T.nada)
    } catch (e) { setMsg((e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')) }
  }

  return (
    <div className="detail-body">
      <h3>{T.seleccionados(tracks.length)}</h3>
      <p className="muted small">{T.intro}</p>
      <button className="link" onClick={onClose}>{T.quitar}</button>
      <div className="row"><Boton variant="ghost" size="sm" onClick={() => void window.paila.mejorarConNapia(ids)} title={T.mejorarNapiaTip}>{T.mejorarNapia(tracks.length)}</Boton></div>
      {editable.length < tracks.length && <Aviso>{T.wma(tracks.length - editable.length)}</Aviso>}

      <section>
        <h4>{T.tags}</h4>
        {FIELDS.map(([f, label, key]) => {
          const vals = new Set(editable.map((t) => effective(t, f, key)))
          const many = vals.size > 1
          const only = many ? '' : [...vals][0] ?? ''
          const filled = editable.filter((t) => effective(t, f, key) !== '')
          return (
            <div key={f} className={`tag-row ${editable.some((t) => pending.some((p) => p.fileId === t.id && p.field === f)) ? 'changed' : ''}`}>
              <label>{label}</label>
              <input key={`${ids.join(',')}-${f}-${many}-${only}`} defaultValue={only} placeholder={many ? T.varios : '—'}
                onBlur={(e) => { const v = e.target.value.trim(); if (many ? v !== '' : v !== only) onStage(editable.map((t) => t.id), f, v === '' ? null : v) }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
              {filled.length ? <ClearField label={label} count={filled.length} onClear={() => onStage(filled.map((t) => t.id), f, null)} /> : <span />}
            </div>
          )
        })}
      </section>

      <section>
        <h4>{T.acciones}</h4>
        <div className="panel">
          <b>{T.reemplazarTexto}</b>
          <div className="row">
            <select value={rfield} onChange={(e) => setRfield(e.target.value as EditableField)}>{FIELDS.map(([f, l]) => <option key={f} value={f}>{l}</option>)}</select>
          </div>
          <input placeholder={T.buscarPh} value={find} onChange={(e) => setFind(e.target.value)} />
          <input placeholder={T.reemplazarPh} value={repl} onChange={(e) => setRepl(e.target.value)} />
          <label className="small"><input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} />{T.regex}</label>
          <Boton disabled={!find} onClick={() => run({ type: 'replace', field: rfield, find, repl, regex })}>{T.proponer}</Boton>
        </div>

        <div className="panel">
          <b>{T.mayMin}</b>
          <select value={cfield} onChange={(e) => setCfield(e.target.value as EditableField)}>{FIELDS.map(([f, l]) => <option key={f} value={f}>{l}</option>)}</select>
          <div className="row">
            <Boton variant="ghost" onClick={() => run({ type: 'case', field: cfield, mode: 'title' })} title={T.tipoTituloTip}>{T.tipoTitulo}</Boton>
            <Boton variant="ghost" onClick={() => run({ type: 'case', field: cfield, mode: 'sentence' })} title={T.primeraMayTip}>{T.primeraMay}</Boton>
            <Boton variant="ghost" onClick={() => run({ type: 'case', field: cfield, mode: 'lower' })}>{T.minus}</Boton>
            <Boton variant="ghost" onClick={() => run({ type: 'case', field: cfield, mode: 'upper' })}>{T.mayus}</Boton>
          </div>
        </div>

        <div className="panel">
          <b>{T.numerarTitulo}</b>
          <span className="muted small">{T.enOrden}</span>
          <label className="small"><input type="checkbox" checked={pad} onChange={(e) => setPad(e.target.checked)} />{T.conCero}</label>
          <Boton variant="ghost" onClick={() => run({ type: 'number', pad })}>{T.numerar}</Boton>
        </div>

        <div className="panel">
          <b>{T.nombreATags}</b>
          <input value={pattern} onChange={(e) => setPattern(e.target.value)} />
          <span className="muted small">{T.campos}</span>
          <Boton variant="ghost" onClick={() => run({ type: 'filenameToTag', pattern })}>{T.proponerSolo}</Boton>
        </div>

        <div className="panel">
          <b>{T.tagsANombre}</b>
          <input value={namePattern} onChange={(e) => setNamePattern(e.target.value)} />
          <span className="muted small">{T.tagsANombreNota}</span>
          <Boton variant="ghost" onClick={() => run({ type: 'tagToFilename', pattern: namePattern })}>{T.proponerNombres}</Boton>
        </div>

        <div className="panel">
          <b>{T.tapa}</b>
          <div className="row">
            <Boton variant="ghost" onClick={() => window.paila.setCover(editable.map((t) => t.id), 'pick').then(async (ok) => { if (ok) { await onAction({ type: 'refresh' }); setMsg(T.tapaPropuesta) } })}>{T.mismaTapa}</Boton>
            <Boton variant="ghost" onClick={() => window.paila.setCover(editable.map((t) => t.id), 'remove').then(() => onAction({ type: 'refresh' }))}>{T.quitarTapas}</Boton>
          </div>
        </div>

        <div className="panel">
          <b>{T.mas}</b>
          <Boton variant="ghost" onClick={() => run({ type: 'folderToTag' })} title={T.carpetaTagsTip}>{T.carpetaTags}</Boton>
          <Boton variant="ghost" onClick={() => run({ type: 'mojibake' })} title={T.mojibakeTip}>{T.mojibake}</Boton>
          <Boton variant="ghost" onClick={() => run({ type: 'youtube' })} title={T.youtubeTip}>{T.youtube}</Boton>
        </div>
        {msg && <Aviso>{msg}</Aviso>}

        <div className="panel">
          <b>{T.guardadas}</b>
          {saved.length === 0 && <span className="muted small">{T.guardadasVacio}</span>}
          {saved.map((s) => (
            <div key={s.name} className="row">
              <Boton variant="ghost" onClick={() => run(s.action)}><Icon name="play" size={13} className="ic-inline" /> {s.name}</Boton>
              <button className="link" title={T.borrarTip} onClick={() => window.paila.deleteSavedAction(s.name).then(setSaved)}><Icon name="close" size={14} /></button>
            </div>
          ))}
          {last && last.type !== 'refresh' && (
            <div className="row">
              <input placeholder={T.nombrePh} value={saveName} onChange={(e) => setSaveName(e.target.value)} />
              <Boton variant="ghost" disabled={!saveName.trim()} onClick={() => window.paila.saveAction(saveName.trim(), last).then((l) => { setSaved(l); setSaveName('') })}>{T.guardar}</Boton>
            </div>
          )}
        </div>
      </section>
      <span hidden>{LABEL.title}</span>
    </div>
  )
}
