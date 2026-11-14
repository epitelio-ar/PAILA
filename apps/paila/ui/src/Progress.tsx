// Pantalla Análisis (qué se está analizando): avance en vivo del escaneo y del análisis de calidad, tema por tema.
import { Icon } from './icons'
import { useEffect, useState } from 'react'
import type { AnalysisInsights, ScanStatus } from '@paila/shared/types'
import { etaText, type Eta } from './eta'
import { IntensityPicker } from './Intensity'
import { Barra, Info, Nota, colorNota, Cabecera, Rico } from '@paila/diseno'
import { textos, num } from '@paila/shared/idioma'
import { conTeclado } from './conTeclado'
import { pasada, textoPausa } from './pausa'
import { T as TA } from './App.textos'
import { buscarEnBiblioteca, buscarNota } from './buscarEn'

const nf = (n: number) => num(n)

const T = textos({
  cerrar: { es: 'Cerrar', en: 'Close' },
  titulo: { es: 'Análisis', en: 'Analysis' },
  sub: { es: 'Qué se está analizando y cuánto falta.', en: "What's being analyzed and how much is left." },
  noCorre: { es: 'El análisis no está corriendo ahora.', en: "The analysis isn't running right now." },
  escucha: { es: ' PAILA escucha cada tema para saber su calidad real, su BPM y su tono. Podés seguir usándola mientras tanto.', en: ' PAILA listens to every track to learn its real quality, its BPM and its key. You can keep using it meanwhile.' },
  sinRitmoCreible: { es: 'sin ritmo creíble (muchos errores seguidos)', en: 'no reliable pace (too many errors in a row)' },
  porMinuto: { es: (r: string) => `${r} por minuto`, en: (r: string) => `${r} per minute` },
  sinRitmo: { es: 'sin ritmo todavía', en: 'no pace yet' },
  avancePasada: {
    es: (a: string, b: string, pct: number, ritmo: string, total: string) => `Esta pasada: **${a}** de ${b} temas (${pct}%) · ${ritmo} · los ${total} temas ya están escuchados`,
    en: (a: string, b: string, pct: number, ritmo: string, total: string) => `This pass: **${a}** of ${b} tracks (${pct}%) · ${ritmo} · all ${total} tracks already listened to`,
  },
  pasadaEta: { es: (t: string) => `Calidad, BPM y tono: listos {info}. Para terminar esta pasada: **${t}**`, en: (t: string) => `Quality, BPM and key: done {info}. To finish this pass: **${t}**` },
  tanda: { es: (a: string, b: string) => ` · la pasada de ahora: ${a} de ${b}`, en: (a: string, b: string) => ` · the current pass: ${a} of ${b}` },
  avance: { es: (a: string, b: string, pct: number, ritmo: string, tanda: string) => `**${a}** de ${b} temas (${pct}%) · ${ritmo}${tanda}`, en: (a: string, b: string, pct: number, ritmo: string, tanda: string) => `**${a}** of ${b} tracks (${pct}%) · ${ritmo}${tanda}` },
  huellas: { es: (n: string, min: number) => `Calidad, BPM y tono: listos. **Faltan las huellas de ${n} temas** {info}: se agregan solas en la próxima pasada (unos ${min} min).`, en: (n: string, min: number) => `Quality, BPM and key: done. **Fingerprints are missing for ${n} tracks** {info}: they're added on their own in the next pass (about ${min} min).` },
  huellasTip: { es: 'Dos huellas por tema: la del sonido (para verificar que guardar tags no cambia el audio) y la acústica (para encontrar el mismo tema aunque tenga otro nombre, y para reconocerlo en internet con AcoustID). Se agregan solas en una pasada liviana que se puede pausar.', en: 'Two fingerprints per track: the sound one (to check that saving tags does not change the audio) and the acoustic one (to find the same track even under another name, and to recognize it online with AcoustID). They are added on their own in a light pass that you can pause.' },
  motor: { es: (n: string) => `Calidad, BPM y tono: listos. **El motor mejoró: se vuelven a revisar ${n} temas** {info}: solos, en la próxima pasada.`, en: (n: string) => `Quality, BPM and key: done. **The engine got better: ${n} tracks will be checked again** {info}: on their own, in the next pass.` },
  motorTip: { es: 'La nota de calidad ahora decide sola, juntando pistas: además del sonido, mira las etiquetas del archivo (el link de YouTube de donde se bajó, el programa que lo armó) y los nombres que tuvo. Un vinilo o un master con los agudos suaves queda como «suena como fue grabado» (B); lo bajado de YouTube o de una página, como D. Solo se vuelven a leer los archivos sin pérdida (y unos pocos más, como los dañados). De paso se calculan el BPM y el tono de los temas de Música que no los tenían. Es una lectura sin huellas, y se puede pausar.', en: 'The quality grade now decides by itself, putting clues together: besides the sound, it looks at the file\'s labels (the YouTube link it was downloaded from, the program that made it) and the names it had. A vinyl rip or a master with soft highs is graded "sounds as it was recorded" (B); something downloaded from YouTube or a website gets a D. Only lossless files are read again (and a few more, like damaged ones). Along the way, the BPM and key of the Music tracks that had none are worked out. It is a read without fingerprints, and you can pause it.' },
  precisa: { es: (n: string) => `Calidad, BPM y tono: listos. **Pasada precisa: faltan ${n} temas** {info}: va sola, sin apuro.`, en: (n: string) => `Quality, BPM and key: done. **Precise pass: ${n} tracks to go** {info}: it runs on its own, no rush.` },
  precisaTip: { es: 'Una segunda escucha en segundo plano que confirma el BPM y el tono con otros métodos (y Deezer, si está prendido). No cambia valores: marca «confirmado» o «dudoso» en la tabla. Se puede pausar y respeta la intensidad.', en: 'A second listen in the background that confirms the BPM and key with other methods (and Deezer, if it is turned on). It does not change values: it marks "confirmed" or "doubtful" in the table. You can pause it and it respects the intensity.' },
  todoAnalizado: { es: 'Todo analizado.', en: 'Everything analyzed.' },
  pausaCalculo: { es: 'En pausa: el tiempo restante se calcula al seguir.', en: 'Paused: the time left is worked out when it resumes.' },
  tiempoEstimado: { es: (t: string) => `Tiempo estimado para terminar: **${t}**`, en: (t: string) => `Estimated time to finish: **${t}**` },
  ultimos: { es: 'Últimos analizados', en: 'Latest analyzed' },
  verTema: { es: 'Ver este tema', en: 'See this track' },
  nadaAun: { es: 'Todavía no hay nada analizado.', en: 'Nothing has been analyzed yet.' },
  notas: { es: 'Notas hasta ahora', en: 'Grades so far' },
  verNota: { es: (g: string) => `Ver en la biblioteca los temas con nota ${g}`, en: (g: string) => `See the tracks graded ${g} in the library` },
  verCuriosidad: { es: 'Buscarlo en la biblioteca', en: 'Find it in the library' },
  curiosidades: { es: 'Curiosidades', en: 'Fun facts' },
  falsos: { es: (a: string, b: string) => `**${a}** lossless que parecen falsos y **${b}** MP3 inflados (todavía sin confirmar a oído) {info}.`, en: (a: string, b: string) => `**${a}** lossless files that look fake and **${b}** inflated MP3s (not yet confirmed by ear) {info}.` },
  falsosTip: { es: 'Lossless (sin pérdida) es calidad de CD o mejor. Un lossless falso es un MP3 pasado a FLAC o WAV: pesa como un CD y suena como el MP3. Un MP3 inflado es uno de pocos kbps re-codificado a más: pesa más pero no suena mejor.', en: 'Lossless is CD quality or better. A fake lossless is an MP3 converted to FLAC or WAV: it weighs like a CD and sounds like the MP3. An inflated MP3 is a low-kbps one re-encoded to a higher rate: it weighs more but does not sound better.' },
  masRapido: { es: (bpm: number) => `Más rápido: **{t}** (${bpm} BPM)`, en: (bpm: number) => `Fastest: **{t}** (${bpm} BPM)` },
  masLento: { es: (bpm: number) => `Más lento: **{t}** (${bpm} BPM)`, en: (bpm: number) => `Slowest: **{t}** (${bpm} BPM)` },
  tonos: { es: 'Tonos más usados: ', en: 'Most used keys: ' },
  masFuerte: { es: (lufs: string) => `Más fuerte: **{t}** (${lufs} LUFS)`, en: (lufs: string) => `Loudest: **{t}** (${lufs} LUFS)` },
  masSuave: { es: (lufs: string) => `Más suave: **{t}** (${lufs} LUFS)`, en: (lufs: string) => `Quietest: **{t}** (${lufs} LUFS)` },
})

/** Pantalla Análisis: se abre desde la barra de progreso y se actualiza cada 4 segundos. */
export default function Progress({ scan, eta, onClose, onOpenTrack }: { scan: ScanStatus; eta: Eta; onClose: () => void; onOpenTrack: (id: number) => void }) {
  const [d, setD] = useState<AnalysisInsights | null>(null)
  useEffect(() => {
    let alive = true
    const load = () => window.paila.analysisInsights().then((x) => { if (alive) setD(x) })
    load()
    const t = setInterval(load, 4000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  // con todo escuchado, una pasada aparte (precisa, huellas, motor nuevo) tiene su propio avance: la barra grande sigue a esa
  // pasada y no queda clavada en 100 % (el autor, 01/11: "cuando hace la pasada precisa no se reinicia la barra")
  const enPasada = !!d && d.done >= d.total && scan.running && scan.job === 'analysis' && scan.toProbe > 0
  const pct = enPasada ? Math.round((scan.probed * 100) / scan.toProbe) : d && d.total ? Math.round((d.done * 100) / d.total) : 0
  const ritmo = eta.doubtful ? T.sinRitmoCreible : (eta.perMinute ?? d?.perMinute) ? T.porMinuto(nf(eta.perMinute ?? d!.perMinute)) : T.sinRitmo
  const tipPasada = d?.prints ? T.huellasTip : d?.quality ? T.motorTip : T.precisaTip
  const c = d?.curiosities
  const maxGrade = d ? Math.max(1, ...Object.values(d.grades)) : 1
  const lufs = (x: number) => num(x, { maximumFractionDigits: 1 })
  const busca = (t: string) => <button type="button" className="tocable" title={T.verCuriosidad} onClick={() => buscarEnBiblioteca(t)}>{t}</button>

  return (
    <div className="page progress-screen">
      <button className="close" onClick={onClose} title={T.cerrar}><Icon name="close" size={14} /></button>
      <Cabecera nivel={2} titulo={T.titulo} sub={T.sub} />
      <p className="muted">
        {scan.running && scan.job === 'analysis' ? (scan.paused ? `${textoPausa(scan)} · ${pasada(scan)}.${scan.heldBy ? ` ${TA.pausaSigue}` : ''}` : scan.phase) : T.noCorre}{T.escucha}
      </p>

      {!d ? <div className="spinner" /> : (<>
        <div className="progress-big">
          <Barra big value={pct} />
          <div><Rico texto={enPasada ? T.avancePasada(nf(scan.probed), nf(scan.toProbe), pct, ritmo, nf(d.total)) : T.avance(
            nf(d.done), nf(d.total), pct, ritmo,
            scan.running && scan.job === 'analysis' && scan.toProbe ? T.tanda(nf(scan.probed), nf(scan.toProbe)) : '',
          )} /></div>
          <div className="eta-line">{enPasada
            ? (scan.paused ? T.pausaCalculo : <Rico texto={T.pasadaEta(etaText(eta.doubtful ? null : eta.minutes, eta.doubtful))} partes={{ info: <Info tip={tipPasada} /> }} />)
            : d.done >= d.total
            ? (d.prints ? <Rico texto={T.huellas(nf(d.prints), Math.max(1, Math.round(d.prints * 0.3 / 60)))} partes={{ info: <Info tip={T.huellasTip} /> }} />
              : d.quality ? <Rico texto={T.motor(nf(d.quality))} partes={{ info: <Info tip={T.motorTip} /> }} />
                : d.precise ? <Rico texto={T.precisa(nf(d.precise))} partes={{ info: <Info tip={T.precisaTip} /> }} />
                  : T.todoAnalizado)
            : scan.running && scan.paused ? T.pausaCalculo
              : <Rico texto={T.tiempoEstimado(etaText(scan.running ? (eta.doubtful ? null : eta.minutes) : d.etaMinutes, scan.running && eta.doubtful))} />}</div>
        </div>

        <IntensityPicker />

        <div className="progress-grid">
          <section>
            <h4>{T.ultimos}</h4>
            <ul className="recent">
              {d.recent.map((r) => (
                <li key={r.id} onClick={() => onOpenTrack(r.id)} {...conTeclado(() => onOpenTrack(r.id))} title={T.verTema}>
                  <Nota grade={r.grade} />
                  <span className="rt"><b>{r.title}</b><span className="muted small"> {r.artist}</span></span>
                  <span className="muted small">{r.label ?? r.ext.toUpperCase()}{r.bpm ? ` · ${Math.round(r.bpm)} BPM` : ''}{r.camelot ? ` · ${r.camelot}` : ''}</span>
                </li>
              ))}
              {!d.recent.length && <li className="muted">{T.nadaAun}</li>}
            </ul>
          </section>

          <section>
            <h4>{T.notas}</h4>
            {/* cada nota se toca: la biblioteca con esos temas (la persona 2, 01/11: tocaba las notas para ver cuáles eran y no pasaba nada) */}
            {(['A+', 'A', 'B', 'C', 'D', 'F'] as const).map((g) => (d.grades[g] ?? 0) > 0
              ? <button type="button" key={g} className="gbar tocable" title={T.verNota(g)} onClick={() => buscarNota(g)}><Nota grade={g} /><i style={{ width: `${((d.grades[g] ?? 0) * 100) / maxGrade}%`, background: colorNota(g) }} /><span className="muted small">{nf(d.grades[g] ?? 0)}</span></button>
              : <div key={g} className="gbar"><Nota grade={g} /><i style={{ width: 0 }} /><span className="muted small">0</span></div>)}

            <h4>{T.curiosidades}</h4>
            <ul className="cur">
              <li><Icon name="search" size={14} className="ic-inline" /> <Rico texto={T.falsos(nf(c!.fakeLossless), nf(c!.upscaled))} partes={{ info: <Info tip={T.falsosTip} /> }} /></li>
              {c!.fastest && <li><Icon name="bolt" size={12} className="ic-inline" /> <Rico texto={T.masRapido(Math.round(c!.fastest.bpm))} partes={{ t: busca(c!.fastest.title) }} /></li>}
              {c!.slowest && <li><Icon name="down" size={14} className="ic-inline" /> <Rico texto={T.masLento(Math.round(c!.slowest.bpm))} partes={{ t: busca(c!.slowest.title) }} /></li>}
              {c!.topKeys.length > 0 && <li><Icon name="note" size={14} className="ic-inline" /> {T.tonos}{c!.topKeys.map((k) => `${k.camelot} (${nf(k.n)})`).join(', ')}</li>}
              {c!.loudest && <li><Icon name="speaker" size={14} className="ic-inline" /> <Rico texto={T.masFuerte(lufs(c!.loudest.lufs))} partes={{ t: busca(c!.loudest.title) }} /></li>}
              {c!.quietest && <li><Icon name="ring" size={14} className="ic-inline" /> <Rico texto={T.masSuave(lufs(c!.quietest.lufs))} partes={{ t: busca(c!.quietest.title) }} /></li>}
            </ul>
          </section>
        </div>
      </>)}
    </div>
  )
}
