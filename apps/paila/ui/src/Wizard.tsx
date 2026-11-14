// Asistente de carpetas: elegir una carpeta de música, ver qué encontró PAILA y ajustar el tipo de cada colección.
import { Icon } from './icons'
import { useEffect, useState } from 'react'
import { KINDS, type CollectionKind, type FolderAnalysis, type RootInfo } from '@paila/shared/types'
import { bytes, n } from './format'
import { Aviso, Boton, Cabecera, Rico } from '@paila/diseno'
import EstiloChooser from './EstiloChooser'
import figurita from './assets/figurita.png'
import { TraerDeOtraCompu } from './Mudanza'
import { textos } from '@paila/shared/idioma'

const T = textos({
  lead: { es: 'Ordená, revisá y mejorá tu música.', en: 'Tidy up, check and improve your music.' },
  empeza: { es: 'Empezá eligiendo la carpeta donde tenés tu música. PAILA solo va a **mirar**: no cambia ni mueve nada sin preguntarte.', en: "Start by choosing the folder where your music lives. PAILA will only **look**: it won't change or move anything without asking you." },
  comoVer: { es: '¿Cómo querés que se vea?', en: 'How do you want it to look?' },
  comoVerInfo: { es: 'Los dos son oscuros y hacen lo mismo. Se cambia cuando quieras desde la barra lateral o en Configuración, y NAPIA se ve igual.', en: 'Both are dark and do the same thing. You can change it any time from the sidebar or in Settings, and NAPIA looks the same.' },
  elegir: { es: 'Elegir carpeta…', en: 'Choose folder…' },
  cancelar: { es: 'Cancelar', en: 'Cancel' },
  mirando: { es: 'Mirando qué hay en la carpeta…', en: "Looking at what's in the folder…" },
  soloLee: { es: 'Solo se leen nombres y tamaños. Con algunos miles de archivos tarda unos segundos.', en: 'Only names and sizes are read. With a few thousand files it takes a few seconds.' },
  encontre: { es: 'Esto es lo que encontré', en: "Here's what I found" },
  enVolumen: { es: ' en ', en: ' on ' },
  resumen: { es: (a: string, b: string) => `: ${a} archivos de audio, ${b} en total.`, en: (a: string, b: string) => `: ${a} audio files, ${b} in total.` },
  adentroEsta: { es: 'Adentro está ', en: 'Inside there is ' },
  carpetasQueTenias: { es: (n: number) => `${n} carpetas que ya tenías`, en: (n: number) => `${n} folders you already had` },
  unir: { es: ', que ya es parte de tu biblioteca. Se van a unir: sus temas siguen con sus playlists, análisis, historial y papelera, y lo que ya habías elegido para sus carpetas se respeta. No se mueve ningún archivo.', en: ', which is already part of your library. They will be joined: their tracks keep their playlists, analysis, history and trash, and what you already chose for their folders is kept. No files are moved.' },
  decime: { es: 'Decime qué es cada carpeta. Ya te propuse lo que me pareció; cambiá lo que no esté bien.', en: "Tell me what each folder is. I've already suggested what seemed right; change whatever isn't." },
  pasaMouse: { es: 'Pasá el mouse por cada tipo para ver qué significa.', en: 'Hover over each type to see what it means.' },
  carpeta: { es: 'Carpeta', en: 'Folder' },
  audio: { es: 'Audio', en: 'Audio' },
  tamano: { es: 'Tamaño', en: 'Size' },
  es: { es: 'Es…', en: 'It is…' },
  despues: { es: 'Después de escanear, PAILA empieza a **escuchar cada tema** para saber cómo suena de verdad. Corre de fondo: podés usar PAILA mientras tanto, pausarlo o elegir si va más rápido o más liviano desde Análisis.', en: 'After scanning, PAILA starts to **listen to every track** to learn how it really sounds. It runs in the background: you can keep using PAILA meanwhile, pause it, or choose whether it goes faster or lighter from Analysis.' },
  seCambia: { es: 'Esto se puede cambiar cuando quieras desde la barra lateral.', en: 'You can change this any time from the sidebar.' },
  otra: { es: 'Elegir otra carpeta', en: 'Choose another folder' },
  guardando: { es: 'Guardando…', en: 'Saving…' },
  guardarVolver: { es: 'Guardar y volver a escanear', en: 'Save and scan again' },
  listoEscanear: { es: 'Listo, escanear', en: 'Done, scan' },
})

const KIND_ORDER: CollectionKind[] = ['musica', 'produccion', 'proyectos', 'sets', 'revisar', 'excluir']

/** Tipo efectivo de una carpeta según reglas ya guardadas (para "Ajustar colecciones"). */
function kindFromRules(rel: string, rules: RootInfo['rules']): CollectionKind | null {
  let best: RootInfo['rules'][number] | null = null
  for (const r of rules) {
    if ((r.rel === '' || rel === r.rel || rel.startsWith(r.rel + '/')) && (!best || r.rel.length > best.rel.length)) best = r
  }
  return best ? best.kind : null
}

interface Props {
  /** La primera vez que se abre PAILA (todavía no hay ninguna carpeta): se puede elegir cómo se ve. */
  primera?: boolean
  existing?: RootInfo // si viene, se están ajustando las colecciones de una carpeta ya agregada
  onDone: () => void
  onCancel?: () => void
}

/** Saca el prefijo técnico que agrega Electron a los errores del proceso principal. */
const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')

export default function Wizard({ existing, primera, onDone, onCancel }: Props) {
  const [step, setStep] = useState<'welcome' | 'analyzing' | 'review'>(existing ? 'analyzing' : 'welcome')
  const [analysis, setAnalysis] = useState<FolderAnalysis | null>(null)
  const [kinds, setKinds] = useState<Record<string, CollectionKind>>({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function analyze(path: string) {
    setStep('analyzing'); setError('')
    try {
      const a = await window.paila.analyzeFolder(path)
      setAnalysis(a)
      const k: Record<string, CollectionKind> = {}
      for (const s of a.suggestions) k[s.rel] = (existing && kindFromRules(s.rel, existing.rules)) || s.kind
      setKinds(k)
      setStep('review')
    } catch (e) {
      setError(clean(e)); setStep('welcome')
    }
  }

  // Al ajustar, se analiza directo la carpeta existente.
  useEffect(() => { if (existing) analyze(existing.path) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function pick() {
    const p = await window.paila.pickFolder()
    if (p) analyze(p)
  }

  async function save() {
    if (!analysis) return
    setSaving(true)
    try {
      await window.paila.addRoot(analysis.path, Object.entries(kinds).map(([rel, kind]) => ({ rel, kind })))
      await window.paila.scanStart()
      onDone()
    } catch (e) {
      setError(clean(e)); setSaving(false)
    }
  }

  if (step === 'welcome') {
    return (
      <div className="wizard center">
        <img className="wizard-figu" src={figurita} alt="" />
        <h1 className="brand-big">PAILA</h1>
        <p className="lead">{T.lead}</p>
        <p className="muted"><Rico texto={T.empeza} /></p>
        {primera && !existing && (
          <div className="use-ask">
            <Cabecera nivel={4} titulo={T.comoVer} info={T.comoVerInfo} />
            <EstiloChooser />
          </div>
        )}
        <Boton size="lg" onClick={pick}>{T.elegir}</Boton>
        {onCancel && <Boton variant="ghost" onClick={onCancel}>{T.cancelar}</Boton>}
        {!existing && <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}><TraerDeOtraCompu bienvenida /></div>}
        {error && <p className="error">{error}</p>}
      </div>
    )
  }

  if (step === 'analyzing' || !analysis) {
    return (
      <div className="wizard center">
        <div className="spinner" />
        <p className="lead">{T.mirando}</p>
        <p className="muted">{T.soloLee}</p>
      </div>
    )
  }

  return (
    <div className="wizard review">
      <header>
        <h2>{T.encontre}</h2>
        <p className="muted">
          <b>{analysis.path}</b>{analysis.volumeLabel && <>{T.enVolumen}<b>{analysis.volumeLabel}</b></>}{T.resumen(n(analysis.totals.audio), bytes(analysis.totals.bytes))}
        </p>
        {analysis.joins.length > 0 && !existing && (
          <Aviso tone="info">
            {T.adentroEsta}{analysis.joins.length === 1 ? <b>{analysis.joins[0]}</b> : <>{T.carpetasQueTenias(analysis.joins.length)}</>}{T.unir}
          </Aviso>
        )}
        <p>{T.decime}</p>
        <div className="legend">
          {KIND_ORDER.map((k) => (
            <span key={k} className={`kind-chip k-${k}`} title={KINDS[k].help}>{KINDS[k].label}</span>
          ))}
          <span className="muted small">{T.pasaMouse}</span>
        </div>
      </header>

      <div className="review-list">
        <div className="review-row head">
          <span>{T.carpeta}</span><span className="num">{T.audio}</span><span className="num">{T.tamano}</span><span>{T.es}</span>
        </div>
        {analysis.suggestions.map((s) => (
          <div key={s.rel} className={`review-row ${kinds[s.rel] === 'excluir' ? 'dim' : ''}`}>
            <span style={{ paddingLeft: (s.depth - 1) * 22 }}>
              <span className="folder-name"><Icon name="folder" size={14} className="ic-inline" /> {s.name}</span>
              {s.depth > 1 && <span className="muted small"> {s.rel}</span>}
              {s.reason && <span className="reason"><Icon name="sparkle" size={14} className="ic-inline" /> {s.reason}</span>}
            </span>
            <span className="num">{n(s.audio)}</span>
            <span className="num">{bytes(s.bytes)}</span>
            <select value={kinds[s.rel]} onChange={(e) => setKinds({ ...kinds, [s.rel]: e.target.value as CollectionKind })} className={`k-${kinds[s.rel]}`}>
              {KIND_ORDER.map((k) => <option key={k} value={k}>{KINDS[k].label}</option>)}
            </select>
          </div>
        ))}
      </div>
      {!existing && (
        <p className="muted small">
          <Rico texto={T.despues} />
        </p>
      )}

      <footer>
        {error && <span className="error">{error}</span>}
        <span className="muted small">{T.seCambia}</span>
        {onCancel && <Boton variant="ghost" onClick={onCancel}>{T.cancelar}</Boton>}
        {!existing && <Boton variant="ghost" onClick={() => setStep('welcome')}>{T.otra}</Boton>}
        <Boton size="lg" disabled={saving} onClick={save}>{saving ? T.guardando : existing ? T.guardarVolver : T.listoEscanear}</Boton>
      </footer>
    </div>
  )
}
