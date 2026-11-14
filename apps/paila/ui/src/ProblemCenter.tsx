// Centro de problemas: lo que PAILA encontró en tu Música, en grupos, cada uno con su arreglo a un clic (que lleva a la vista previa:
// nada se aplica solo). Usa los mismos números y explicaciones que las tarjetas de Inicio.
import { useMemo } from 'react'
import type { LibraryStats } from '@paila/shared/tableview'
import { Boton, Cabecera, Info, PantallaVacia, Rico } from '@paila/diseno'
import { textos, plural, num } from '@paila/shared/idioma'
import { Icon, type IconName } from './icons'
import { PROBLEMS, type ProblemKey } from './problems'
import { bytes, n } from './format'
import type { PageKey } from './nav'
import { useProfile } from './profile'
import logo from './assets/logo.png'

const T = textos({
  lista: { es: 'Faltan o suenan mal', en: 'Missing or low quality' },
  original: { es: 'Buscar el original', en: 'Look for the original' },
  arreglar: { es: 'Arreglar nombres y tags', en: 'Fix names and tags' },
  convertir: { es: 'Convertir…', en: 'Convert…' },
  recortar: { es: 'Recortar…', en: 'Trim…' },
  titulo: { es: 'Centro de problemas', en: 'Problem center' },
  sub: { es: 'Lo que PAILA encontró en tu Música. Tocá una fila para ver los temas.', en: 'What PAILA found in your Music. Click a row to see the tracks.' },
  nada: { es: 'No hay nada para arreglar', en: 'Nothing to fix' },
  sinAnalizar: { es: 'Todavía no hay temas analizados', en: 'No tracks analyzed yet' },
  enOrden: { es: 'Tu Música está en orden. Si más adelante aparece algo, lo vas a ver acá.', en: "Your Music is in good shape. If something turns up later, you'll see it here." },
  cuando: { es: 'Cuando PAILA analice tu Música, acá vas a ver lo que conviene mirar.', en: "Once PAILA has analyzed your Music, you'll see here what's worth a look." },
  verTemas: { es: (x: string) => `Ver los temas: ${x}`, en: (x: string) => `See the tracks: ${x}` },
  pie: {
    es: (k: number) => `${num(k)} ${plural(k, 'tipo de problema sin casos', 'tipos de problemas sin casos')}. Duplicados, nombres y carpetas se ven en {dups}, Arreglar nombres y tags y Organizar carpetas.`,
    en: (k: number) => `${num(k)} problem ${plural(k, 'type', 'types')} with no cases. Duplicates, names and folders show up in {dups}, Fix names and tags and Organize folders.`,
  },
  dups: { es: 'Duplicados', en: 'Duplicates' },
})

/** `prep`: lo que se deja listo antes de ir (por ejemplo, tildar la casilla de la Lista que los muestra). */
interface Arreglo { page: PageKey; cta: string; prep?: () => Promise<unknown> }
interface Estilo { icon: IconName; tone: 'error' | 'atencion' | 'info' }

/** Qué pantalla arregla cada problema (los que no tienen arreglo propio solo se pueden mirar en la tabla). */
const ARREGLO: Partial<Record<ProblemKey, Arreglo>> = {
  fake_lossless: { page: 'wishlist', cta: T.lista },
  upscaled: { page: 'wishlist', cta: T.lista },
  fake_hires: { page: 'wishlist', cta: T.lista },
  low: { page: 'wishlist', cta: T.lista },
  // son B: en la Lista entran solo con su casilla (destildada de fábrica), así que se tilda antes de ir
  mp3like: { page: 'wishlist', cta: T.original, prep: async () => window.paila.wanted({ ...(await window.paila.wantedCriteria()), mp3like: true }) },
  no_tags: { page: 'tidy', cta: T.arreglar },
  rekordbox: { page: 'rekordbox', cta: T.convertir },
  silence: { page: 'silencios', cta: T.recortar },
}
const ESTILO: Record<ProblemKey, Estilo> = {
  fake_lossless: { icon: 'alert', tone: 'error' }, fake_hires: { icon: 'alert', tone: 'atencion' }, upscaled: { icon: 'alert', tone: 'atencion' },
  low: { icon: 'down', tone: 'atencion' }, as_recorded: { icon: 'info', tone: 'info' }, mp3like: { icon: 'info', tone: 'info' }, damaged: { icon: 'alert', tone: 'error' },
  no_tags: { icon: 'wand', tone: 'atencion' }, missing: { icon: 'search', tone: 'info' }, rekordbox: { icon: 'headphones', tone: 'atencion' },
  bpm_doubtful: { icon: 'activity', tone: 'info' }, silence: { icon: 'info', tone: 'info' },
}
/** Los problemas que solo le importan a quien usa las herramientas para DJ: sin ellas no se ven (hallazgo 9). */
export const PROBLEMAS_DJ: ReadonlySet<ProblemKey> = new Set<ProblemKey>(['rekordbox', 'bpm_doubtful'])
const COLOR = { error: 'var(--error)', atencion: 'var(--atencion)', info: 'var(--info)' }
const FONDO = { error: 'var(--error-suave)', atencion: 'var(--atencion-suave)', info: 'var(--info-suave)' }

export default function ProblemCenter({ stats, onProblem, onGo }: { stats: LibraryStats; onProblem: (k: ProblemKey) => void; onGo: (p: PageKey) => void }) {
  const { djTools } = useProfile()
  const visibles = useMemo(() => PROBLEMS.filter((p) => djTools || !PROBLEMAS_DJ.has(p.key)), [djTools])
  const grupos = useMemo(() => visibles.map((p) => ({ ...p, ...stats.music.problems[p.key] })).filter((p) => p.count > 0).sort((a, b) => b.count - a.count), [stats, visibles])
  const sinProblemas = visibles.length - grupos.length
  return (
    <div className="page problemas">
      <Cabecera nivel={2} titulo={T.titulo} sub={T.sub} />
      {!stats.music.total || !grupos.length ? (
        <PantallaVacia imagen={logo} titulo={stats.music.total ? T.nada : T.sinAnalizar}>
          {stats.music.total ? T.enOrden : T.cuando}
        </PantallaVacia>
      ) : (
        <div className="grupos-problemas">
          {grupos.map((g) => {
            const e = ESTILO[g.key]
            const fix = ARREGLO[g.key]
            return (
              <div key={g.key} className="grupo-problema una-linea clicable" role="button" tabIndex={0} title={`${T.verTemas(g.label)}. ${g.help}`}
                onClick={() => onProblem(g.key)} onKeyDown={(ev) => { if (ev.key === 'Enter' && ev.target === ev.currentTarget) onProblem(g.key) }}>
                <div className="gp-ico" style={{ background: FONDO[e.tone], color: COLOR[e.tone] }}><Icon name={e.icon} size={18} /></div>
                <div className="gp-texto">
                  <div className="gp-titulo"><b className="num">{n(g.count)}</b> {g.label} <Info tip={g.help} /> <span className="muted small num">· {bytes(g.bytes)}</span></div>
                </div>
                <div className="gp-acciones">
                  {fix && <Boton size="sm" onClick={async (ev) => { ev.stopPropagation(); try { await fix.prep?.() } finally { onGo(fix.page) } }}>{fix.cta}</Boton>}
                </div>
              </div>
            )
          })}
          {sinProblemas > 0 && <p className="muted small gp-pie"><Icon name="check" size={13} className="ic-inline" /> <Rico texto={T.pie(sinProblemas)} partes={{ dups: <button className="link" onClick={() => onGo('dups')}>{T.dups}</button> }} /></p>}
        </div>
      )}
    </div>
  )
}
