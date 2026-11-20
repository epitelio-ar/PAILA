// Configuración (Fase H): Actualizaciones (buscar sola al abrir, buscar ahora, "Qué hay de nuevo" en la versión instalada, de
// docs/NOVEDADES.md, o NOVEDADES.en.md en inglés) y "Exportar diagnóstico" (muestra archivo por archivo lo que va en el zip, sin datos personales).
import { useState } from 'react'
import type { DiagnosticPreviewFile } from '@paila/shared/types'
import { Aviso, Boton, Cabecera, Casilla, Info, Ventana } from '@paila/diseno'
import { negritas, novedadDe } from '@paila/shared/novedades'
import { textos, tr, fechaHora } from '@paila/shared/idioma'
import NOVEDADES_ES from '../../../../docs/NOVEDADES.md?raw'
import NOVEDADES_EN from '../../../../docs/NOVEDADES.en.md?raw'
import { useUpdates } from './UpdateNotice'
import { toast } from './toast'

const T = textos({
  queHay: { es: (v: string) => `Qué hay de nuevo en ${v}`, en: (v: string) => `What's new in ${v}` },
  tenesLaUltima: { es: (v: string) => `Tenés la última versión (${v}).`, en: (v: string) => `You have the latest version (${v}).` },
  actTitulo: { es: 'Actualizaciones', en: 'Updates' },
  actTip: {
    es: 'PAILA mira si hay una versión nueva en su página de GitHub y te avisa. Nunca se instala sola: vos elegís si actualizar, cuándo, o no avisar más de una versión. Actualizar no toca tu música ni tus playlists.',
    en: "PAILA checks whether there's a new version on its GitHub page and tells you. It never installs by itself: you choose whether to update, when, or to stop hearing about a version. Updating doesn't touch your music or your playlists.",
  },
  tenesPaila: { es: (v: string) => `Tenés PAILA ${v}.`, en: (v: string) => `You have PAILA ${v}.` },
  ultimaVez: { es: (cuando: string) => ` Última vez que se fijó: ${cuando}.`, en: (cuando: string) => ` Last checked: ${cuando}.` },
  buscarAlAbrir: { es: 'Buscar versiones nuevas al abrir PAILA', en: 'Look for new versions when PAILA opens' },
  buscarAlAbrirDetalle: { es: 'Solo pregunta qué versión es la última: no manda nada tuyo.', en: "It only asks which version is the latest: it doesn't send anything of yours." },
  buscando: { es: 'Buscando…', en: 'Looking…' },
  buscarAhora: { es: 'Buscar ahora', en: 'Look now' },
  algoMal: { es: 'Si algo anda mal', en: 'If something goes wrong' },
  algoMalTip: {
    es: 'Un archivo .zip con lo que hace falta para entender un problema: la versión, tu Windows, cuántos temas hay por formato, cuánto tarda el análisis y los errores. Sin tu música, sin los nombres de tus temas ni carpetas, sin tus claves y sin la base. Antes de guardarlo ves todo lo que lleva.',
    en: "A .zip file with what's needed to understand a problem: the version, your Windows, how many tracks there are per format, how long the analysis takes and the errors. No music, no track or folder names, no keys and no database. Before saving it you see everything it contains.",
  },
  algoMalTexto: { es: 'Si alguien te ayuda con PAILA, el diagnóstico le cuenta qué pasó sin mostrar nada tuyo.', en: "If someone is helping you with PAILA, the diagnostic tells them what happened without showing anything of yours." },
  exportarDiag: { es: 'Exportar diagnóstico…', en: 'Export diagnostic…' },
  diagTitulo: { es: 'Exportar diagnóstico', en: 'Export diagnostic' },
  diagSub: { es: 'Esto es todo lo que va en el zip. Tocá un archivo para ver su contenido exacto.', en: 'This is everything that goes in the zip. Tap a file to see its exact contents.' },
  diagNoLleva: {
    es: 'No lleva tu música, los nombres de tus temas, carpetas o playlists, tus rutas, tus claves, tu usuario de Windows ni la base de PAILA. Donde un error nombraba algo tuyo, dice <ruta>, «…» o <archivo>.',
    en: 'It does not include your music, the names of your tracks, folders or playlists, your paths, your keys, your Windows username or the PAILA database. Where an error named something of yours, it says <path>, «…» or <file>.',
  },
  diagGuardado: { es: 'Diagnóstico guardado. Mandalo por donde te lo pidieron (correo, GitHub).', en: 'Diagnostic saved. Send it wherever you were asked to (email, GitHub).' },
  guardarZip: { es: 'Guardar el zip…', en: 'Save the zip…' },
  cancelar: { es: 'Cancelar', en: 'Cancel' },
})

const when = (iso: string) => fechaHora(iso, { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })

const Texto = ({ t }: { t: string }) => <>{negritas(t).map((p, i) => (p.negrita ? <b key={i}>{p.texto}</b> : p.texto))}</>

/** Lo que trajo la versión instalada, plegado: se abre con un clic. */
export function QueHayDeNuevo({ version }: { version: string }) {
  const n = novedadDe(tr({ es: NOVEDADES_ES, en: NOVEDADES_EN }), version)
  if (!n) return null
  const sueltos = n.renglones.filter((r) => !r.nivel), puntos = n.renglones.filter((r) => r.nivel)
  return (
    <details className="novedades">
      <summary>{T.queHay(n.version)}</summary>
      {n.titulo && <p className="novedades-titulo"><b>{n.titulo}</b> <span className="muted small">{n.fecha}</span></p>}
      {sueltos.map((r, i) => <p key={i}><Texto t={r.texto} /></p>)}
      <ul>{puntos.map((r, i) => <li key={i} className={r.nivel === 2 ? 'sub' : undefined}><Texto t={r.texto} /></li>)}</ul>
    </details>
  )
}

export function UpdatesSettings() {
  const [st, setSt] = useUpdates()
  if (!st) return null
  const check = async () => {
    const r = await window.paila.updatesCheck(); setSt(r)
    if (r.phase === 'quieta') toast(T.tenesLaUltima(r.current), 'info')
  }
  return (<>
    <h4>{T.actTitulo} <Info tip={T.actTip} /></h4>
    <p className="muted small">{T.tenesPaila(st.current)}{st.lastCheck ? T.ultimaVez(when(st.lastCheck)) : ''}</p>
    <QueHayDeNuevo version={st.current} />
    {!st.enabled && <Aviso>{st.why}</Aviso>}
    <Casilla checked={st.auto} disabled={!st.enabled} onChange={async (on) => setSt(await window.paila.updatesSetAuto(on))} label={T.buscarAlAbrir}
      detail={T.buscarAlAbrirDetalle} />
    <div className="row">
      <Boton size="sm" variant="ghost" disabled={!st.enabled || st.phase === 'buscando' || st.phase === 'bajando'} onClick={check}>{st.phase === 'buscando' ? T.buscando : T.buscarAhora}</Boton>
      {st.phase === 'error' && <span className="small hint hint-warn">{st.error}</span>}
    </div>
  </>)
}

export function DiagnosticSettings() {
  const [files, setFiles] = useState<DiagnosticPreviewFile[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const show = async () => { setBusy(true); try { setFiles(await window.paila.diagnosticPreview()) } finally { setBusy(false) } }
  const save = async () => {
    setBusy(true)
    try { const p = await window.paila.diagnosticSave(); if (p) { toast(T.diagGuardado, 'ok'); setFiles(null) } } finally { setBusy(false) }
  }
  return (<>
    <h4>{T.algoMal} <Info tip={T.algoMalTip} /></h4>
    <p className="muted small">{T.algoMalTexto}</p>
    <div className="row"><Boton size="sm" variant="ghost" disabled={busy} onClick={show}>{T.exportarDiag}</Boton></div>
    {files && (
      <Ventana onClose={() => setFiles(null)} busy={busy} className="diag-ventana">
        <Cabecera nivel={3} titulo={T.diagTitulo} sub={T.diagSub} />
        <Aviso tone="ok">{T.diagNoLleva}</Aviso>
        <div className="diag-lista">
          {files.map((f) => (
            <div key={f.name} className="diag-archivo">
              <button className="diag-nombre" onClick={() => setOpen(open === f.name ? null : f.name)} aria-expanded={open === f.name}>
                <b>{f.name}</b> <span className="muted small">{f.what}</span>
              </button>
              {open === f.name && <pre className="diag-contenido">{f.content}</pre>}
            </div>
          ))}
        </div>
        <div className="row">
          <Boton disabled={busy} onClick={save}>{T.guardarZip}</Boton>
          <Boton variant="ghost" disabled={busy} onClick={() => setFiles(null)}>{T.cancelar}</Boton>
        </div>
      </Ventana>
    )}
  </>)
}
