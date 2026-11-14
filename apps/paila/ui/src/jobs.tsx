// Procesos largos en la interfaz: lista al día de lo que está corriendo, panel de avance y el indicador de la barra.
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { JobState } from '@paila/shared/types'
import { EtaMeter } from '@paila/shared/eta'
import { Barra, Pildora, Rico } from '@paila/diseno'
import { n } from './format'
import { textos, tr } from '@paila/shared/idioma'

const T = textos({
  menosDe1: { es: 'menos de 1 min', en: 'less than 1 min' },
  unos: { es: (m: number) => `unos ${m} min`, en: (m: number) => `about ${m} min` },
  cancelando: { es: 'Cancelando…', en: 'Canceling…' },
  enMarcha: { es: 'En marcha', en: 'Running' },
  enFila: { es: 'En fila', en: 'Queued' },
  esperando: {
    es: (job: string, service: string) => `Empieza solo cuando termine «${job}»: las dos usan ${service}, que pide ir despacio. Podés cambiar de pantalla.`,
    en: (job: string, service: string) => `It starts on its own when «${job}» finishes: both use ${service}, which asks to go slowly. You can switch screens.`,
  },
  fallo: { es: 'Falló', en: 'Failed' },
  termino: { es: 'Terminó', en: 'Finished' },
  avance: { es: (a: string, b: string, pct: number, unit: string) => `**${a}** de ${b} ${unit} (${pct}%)`, en: (a: string, b: string, pct: number, unit: string) => `**${a}** of ${b} ${unit} (${pct}%)` },
  trabajando: { es: 'Trabajando…', en: 'Working…' },
  porMin: { es: (r: string, unit: string) => `${r} ${unit}/min`, en: (r: string, unit: string) => `${r} ${unit}/min` },
  falta: { es: (t: string) => `falta ${t}`, en: (t: string) => `${t} left` },
  encontrados: { es: (a: string) => `${a} encontrados`, en: (a: string) => `${a} found` },
  conProblemas: { es: (a: string) => `${a} con problemas`, en: (a: string) => `${a} with problems` },
  ahora: { es: 'Ahora: ', en: 'Now: ' },
  verProblemas: { es: (a: string) => `Ver los ${a} con problemas y por qué`, en: (a: string) => `See the ${a} with problems and why` },
  ymas: { es: (a: string) => `… y ${a} más.`, en: (a: string) => `… and ${a} more.` },
  cerrar: { es: 'Cerrar', en: 'Close' },
})

const JobsCtx = createContext<JobState[]>([])

/** Mantiene al día la lista de procesos largos (viven en el proceso principal: sobreviven a cambiar de pantalla). */
export function JobsProvider({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = useState<JobState[]>([])
  useEffect(() => {
    window.paila.jobs().then(setJobs)
    return window.paila.onJobs(setJobs)
  }, [])
  return <JobsCtx.Provider value={jobs}>{children}</JobsCtx.Provider>
}

const useJobs = () => useContext(JobsCtx)
export const useJob = (kind: string): JobState | null => useContext(JobsCtx).find((j) => j.kind === kind) ?? null

const mmss = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

/** Tiempo restante legible a partir del ritmo: "unos 3 min", "1 h 20 min". */
const eta = (min: number) => (min < 1 ? T.menosDe1 : min < 60 ? T.unos(Math.round(min)) : `${Math.floor(min / 60)} h ${Math.round(min % 60)} min`)

/**
 * Panel de un proceso en curso: barra, cuántos van, ritmo, tiempo restante, qué está haciendo ahora y cómo terminó.
 * Sirve para todos los procesos largos: se ve igual en cualquier pantalla.
 */
export function JobPanel({ job, unit = tr({ es: 'archivos', en: 'files' }), onDismiss, children }: { job: JobState; unit?: string; onDismiss?: () => void; children?: React.ReactNode }) {
  const [now, setNow] = useState(Date.now())
  // los problemas se abren solos si son pocos; tocar el «N con problemas» los abre o los cierra
  const [verProb, setVerProb] = useState<boolean | null>(null)
  useEffect(() => { if (!job.running) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [job.running])
  const end = job.finishedAt ?? now
  const elapsed = end - job.startedAt
  const known = job.total > 0
  const pct = known ? Math.min(100, Math.round((job.done * 100) / job.total)) : 0
  // ritmo de lo último (promedio que se corre, @paila/shared/eta), no el promedio desde el arranque: en Completar desde
  // internet lo ya buscado sale volando y lo nuevo va a un pedido por segundo, y el promedio prometía 10 min de algo que
  // tardó 37 (prueba del autor del 28/10)
  // en fila no se mide, y al salir de la fila se mide de cero (la espera no es ritmo)
  const meter = useRef(new EtaMeter()), desde = useRef(job.startedAt), enFila = useRef(!!job.waiting)
  useEffect(() => {
    if (desde.current !== job.startedAt) { desde.current = job.startedAt; meter.current.reset() }
    if (enFila.current && !job.waiting) meter.current.reset()
    enFila.current = !!job.waiting
    if (job.running && !job.waiting) meter.current.add(now, job.done, job.errors)
  }, [now, job.startedAt, job.running, job.waiting, job.done, job.errors])
  const est = known && job.running && !job.waiting ? meter.current.estimate(job.total - job.done) : null
  const perMin = est?.perMinute ?? null
  const left = est?.minutes ?? null

  return (
    <div className={`job ${job.running ? 'running' : job.failed ? 'failed' : 'finished'}`}>
      <div className="job-head">
        <b>{job.label}</b>
        <Pildora tone={job.running ? (job.cancelling ? 'atencion' : 'info') : job.failed ? 'atencion' : 'ok'}>
          {job.running ? (job.cancelling ? T.cancelando : job.waiting ? T.enFila : T.enMarcha) : job.failed ? T.fallo : T.termino}
        </Pildora>
        <span className="push-right muted small">{mmss(elapsed)}</span>
      </div>
      {/* sin total conocido: animación mientras corre; en fila: vacía y quieta; terminado: barra llena (sin animación) */}
      <Barra big value={job.waiting ? 0 : known || !job.running ? (known && job.running ? pct : 100) : null} />
      <div className="job-stats">
        {known ? <span><Rico texto={T.avance(n(job.done), n(job.total), pct, unit)} /></span> : <span>{job.running && !job.waiting ? T.trabajando : ''}{job.done ? ` ${n(job.done)} ${unit}` : ''}</span>}
        {job.running && perMin != null && <span className="muted">{T.porMin(perMin >= 10 ? n(Math.round(perMin)) : n(Math.round(perMin * 10) / 10), unit)}</span>}
        {job.running && left != null && <span className="muted">{T.falta(eta(left))}</span>}
        {job.found > 0 && <span className="job-ok">{T.encontrados(n(job.found))}</span>}
        {job.errors > 0 && <button className="link job-bad" onClick={() => setVerProb(!(verProb ?? (!job.running && job.problems.length <= 3)))}>{T.conProblemas(n(job.errors))}</button>}
      </div>
      {job.running && job.waiting && <div className="job-now muted">{T.esperando(job.waiting.job, job.waiting.service)}</div>}
      {job.running && job.current && <div className="job-now ellipsis" title={job.current}><span className="muted">{T.ahora}</span>{job.current}</div>}
      {job.summary && <div className="job-summary">{job.summary}</div>}
      {job.problems.length > 0 && (
        <details className="job-problems" open={verProb ?? (!job.running && job.problems.length <= 3)} onToggle={(e) => setVerProb(e.currentTarget.open)}>
          <summary>{T.verProblemas(n(job.problems.length))}</summary>
          <ul>{job.problems.slice(0, 100).map((p, i) => <li key={i}><b title={p.name}>{p.name.split(/[\/]/).pop()}</b><span>{p.error}</span></li>)}</ul>
          {job.problems.length > 100 && <div className="muted small">{T.ymas(n(job.problems.length - 100))}</div>}
        </details>
      )}
      {children}
      {!job.running && onDismiss && <button className="link" onClick={onDismiss}>{T.cerrar}</button>}
    </div>
  )
}

/** Cartelito fijo en la barra de arriba con el proceso largo que esté corriendo (el análisis tiene su propia barra). */
export function JobsChip({ onGo }: { onGo?: (kind: string) => void }) {
  const running = useJobs().filter((j) => j.running)
  if (!running.length) return null
  const j = running.find((x) => !x.waiting) ?? running[0] // primero el que trabaja, no el que espera en fila
  const pct = j.total > 0 ? Math.round((j.done * 100) / j.total) : null
  return (
    <button className="jobs-chip" onClick={() => j.kind === 'napia' ? void window.paila.traerNapia() : onGo?.(j.kind)} title={`${j.label}${j.current ? ` · ${j.current}` : ''}`}>
      <span className="spinner mini" />
      <span className="ellipsis">{j.label}{running.length > 1 ? ` (+${running.length - 1})` : ''}</span>
      {pct != null && <b>{pct}%</b>}
    </button>
  )
}
