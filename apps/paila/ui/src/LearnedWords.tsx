// Lista "Palabras que PAILA aprendió a sacar" (dentro de Arreglar nombres y tags): cada palabra con sus números, ejemplos
// de tu biblioteca, una casilla para usarla o no y "No es basura" (no se propone nunca más). Ver core/junkwords.ts.
import { useEffect, useState } from 'react'
import type { LearnedReport, LearnedState, LearnedWord } from '@paila/shared/types'
import { n } from './format'
import { textos, cant } from '@paila/shared/idioma'
import { toast } from './toast'
import { Info } from '@paila/diseno'

const T = textos({
  corchetes: { es: 'entre corchetes', en: 'in square brackets' },
  parentesis: { es: 'entre paréntesis', en: 'in parentheses' },
  final: { es: 'al final del nombre', en: 'at the end of the name' },
  web: { es: 'una página web', en: 'a web address' },
  titulo: { es: 'Palabras que PAILA aprendió a sacar', en: 'Words PAILA learned to remove' },
  info: {
    es: 'Se aprende de los temas que PAILA reconoció con seguridad por el sonido (la huella acústica de AcoustID y la duración coinciden): lo que tiene el nombre del archivo y no el nombre oficial. Cuenta solo si sobra en muchos artistas y carpetas distintas y casi siempre (90 % o más). Nunca datos de versión ni algo que esté en un nombre oficial.',
    en: 'PAILA learns these from tracks it recognized with certainty by their sound (the AcoustID acoustic fingerprint and the length both match): whatever the file name has that the official name does not. A word only counts if it is extra across many different artists and folders, and almost always (90% or more). Never version details or anything that is part of an official name.',
  },
  deTemas: { es: (k: number) => `· de ${n(k)} temas reconocidos por el sonido`, en: (k: number) => `· from ${cant(k, 'track', 'tracks')} recognized by sound` },
  apagada: { es: ' · la regla está apagada', en: ' · the rule is off' },
  sinReconocidos: { es: 'Todavía no hay temas reconocidos por el sonido: hace falta la clave de AcoustID y buscar en «Completar desde internet».', en: 'No tracks have been recognized by sound yet: you need the AcoustID key, then search in "Fill in from the internet".' },
  ninguna: { es: 'Por ahora no aprendió ninguna: en tu biblioteca no hay basura repetida que no saque ya la lista fija.', en: 'It has not learned any yet: your library has no repeated junk that the fixed list does not already remove.' },
  vista: {
    es: (donde: string, t: number, a: number, c: number, pct: number, ap: number) => `· ${donde} · vista de más en ${n(t)} temas de ${n(a)} artistas y ${n(c)} carpetas (${pct} %) · se saca en ${n(ap)} temas`,
    en: (donde: string, t: number, a: number, c: number, pct: number, ap: number) => `· ${donde} · seen extra in ${cant(t, 'track', 'tracks')} by ${cant(a, 'artist', 'artists')} in ${cant(c, 'folder', 'folders')} (${pct}%) · removed from ${cant(ap, 'track', 'tracks')}`,
  },
  noEsBasuraTip: { es: 'No la vuelve a proponer nunca más', en: 'Never suggests it again' },
  noEsBasura: { es: 'No es basura', en: 'Not junk' },
  marcaste: { es: 'Marcaste como «no es basura»: ', en: 'You marked as "not junk": ' },
  volver: { es: 'Volver a usarla', en: 'Use it again' },
  ocultar: { es: 'Ocultar', en: 'Hide' },
  ver: { es: 'Ver', en: 'See' },
  casiEntran: { es: (k: number) => ` las que casi entran y por qué no (${k})`, en: (k: number) => ` the ones that almost made it, and why not (${k})` },
})
const WHERE: Record<LearnedWord['where'], string> = { get corchetes() { return T.corchetes }, get parentesis() { return T.parentesis }, get final() { return T.final }, get web() { return T.web } }
const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')

export function LearnedWords({ on, onChanged }: { on: boolean; onChanged: () => void }) {
  const [r, setR] = useState<LearnedReport | null>(null)
  const [why, setWhy] = useState(false)
  useEffect(() => { window.paila.learnedWords().then(setR).catch((e) => toast(clean(e), 'error')) }, [])
  const set = async (w: LearnedWord, s: LearnedState) => { try { setR(await window.paila.setLearnedWord(w.key, s)); onChanged() } catch (e) { toast(clean(e), 'error') } }
  if (!r) return null
  const live = r.words.filter((w) => w.state !== 'no_es'), notJunk = r.words.filter((w) => w.state === 'no_es')
  return (
    <div className={`box tidy-rules${on ? '' : ' skipped'}`}>
      <div className="box-head">
        <b>{T.titulo}</b>
        <Info tip={T.info} />
        <span className="muted small">{T.deTemas(r.identified)}{!on ? T.apagada : ''}</span>
      </div>
      {!r.identified && <div className="box-row" style={{ gridTemplateColumns: '1fr', cursor: 'default' }}><span className="small muted">{T.sinReconocidos}</span></div>}
      {r.identified > 0 && !live.length && <div className="box-row" style={{ gridTemplateColumns: '1fr', cursor: 'default' }}><span className="small muted">{T.ninguna}</span></div>}
      {live.map((w) => (
        <label key={w.key} className={`choice tidy-rule${w.state === 'on' ? '' : ' off'}`}>
          <input type="checkbox" checked={w.state === 'on'} onChange={(e) => set(w, e.target.checked ? 'on' : 'off')} />
          <div className="choice-body">
            <div><b>{w.shown}</b> <span className="muted small">{T.vista(WHERE[w.where], w.tracks, w.artists, w.folders, Math.round(w.ratio * 100), w.applies)}</span>
              <button className="link small push-right" onClick={(e) => { e.preventDefault(); void set(w, 'no_es') }} title={T.noEsBasuraTip}>{T.noEsBasura}</button></div>
            {w.examples.map((x, i) => <div key={i} className="small tidy-ex">{x.from} → <b>{x.to}</b></div>)}
          </div>
        </label>
      ))}
      {notJunk.length > 0 && <div className="box-row" style={{ gridTemplateColumns: '1fr', cursor: 'default' }}><span className="small muted">{T.marcaste}{notJunk.map((w) => <button key={w.key} className="link small" style={{ marginRight: 8 }} title={T.volver} onClick={() => set(w, 'on')}>{w.shown}</button>)}</span></div>}
      {r.rejected.length > 0 && (
        <div className="box-row" style={{ gridTemplateColumns: '1fr', cursor: 'default' }}>
          <button className="link small" onClick={() => setWhy(!why)}>{why ? T.ocultar : T.ver}{T.casiEntran(r.rejected.length)}</button>
          {why && r.rejected.map((x, i) => <div key={i} className="small muted">{x.shown}: {x.why}</div>)}
        </div>
      )}
    </div>
  )
}
