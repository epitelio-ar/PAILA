// Pestaña "Volumen parejo" (ReplayGain): calcula cuánto subir o bajar cada tema y cada disco, con la medición del análisis,
// y lo arma en Cambios pendientes. Solo se escribe un dato en el tag: el audio no se toca.
import { useEffect, useRef, useState } from 'react'
import type { GainPlan } from '@paila/shared/types'
import { JobPanel, useJob } from './jobs'
import { n } from './format'
import { toast } from './toast'
import { Boton, Info, Rico } from '@paila/diseno'
import { textos, num } from '@paila/shared/idioma'
import { conTeclado } from './conTeclado'

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
const un = (x: number) => num(x, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const db = (x: number | null) => (x == null ? '–' : `${x > 0 ? '+' : ''}${un(x)} dB`)
const T = textos({
  what: { es: 'ReplayGain es un dato que se guarda en el tag de cada tema: cuánto hay que subirlo o bajarlo para que suene al mismo volumen que los demás (la referencia es -18 LUFS). El reproductor lo aplica al escuchar; el archivo y su sonido no cambian. Lo usan foobar2000, MusicBee, VLC, Kodi, Plex, Jellyfin, Navidrome, Poweramp y muchos más. Rekordbox no lo usa: tiene su propio ajuste (Auto Gain).', en: "ReplayGain is a value saved in each track's tag: how much to raise or lower it so it plays at the same volume as the rest (the reference is -18 LUFS). The player applies it while you listen; the file and its sound don't change. foobar2000, MusicBee, VLC, Kodi, Plex, Jellyfin, Navidrome, Poweramp and many more use it. Rekordbox doesn't: it has its own setting (Auto Gain)." },
  album: { es: 'Además del volumen de cada tema, el del disco entero: así un disco suena parejo con los demás pero respeta que dentro del disco haya temas más suaves y más fuertes (como lo quiso el artista). En el reproductor se elige "por tema" o "por disco".', en: 'On top of the volume of each track, the volume of the whole album: this way an album plays at an even level with the others but keeps its softer and louder tracks as the artist intended. In the player you pick "per track" or "per album".' },
  other: { es: 'Ya tienen un volumen parejo que escribió otro programa (por ejemplo foobar2000 o Mp3tag). PAILA lo compara con lo que mide: si la diferencia es de menos de 1 dB (no se nota), se deja como está.', en: "They already have an even volume written by another program (for example foobar2000 or Mp3tag). PAILA compares it with what it measures: if the difference is under 1 dB (you can't hear it), it's left as it is." },
  wrong: { es: 'Tenían un volumen parejo de otro programa que no coincide con lo que se escucha (1 dB o más de diferencia; pasa con el ReplayGain viejo, que medía distinto, o si el tema cambió después). Se corrigen con los demás, y se puede deshacer. La marca "Sound Check" de iTunes no se toca.', en: "They had an even volume from another program that doesn't match what you hear (1 dB or more apart; it happens with old ReplayGain, which measured differently, or if the track changed afterwards). They're fixed along with the rest, and you can undo. iTunes' \"Sound Check\" mark is left alone." },
  lufs: { es: 'LUFS es la unidad con la que se mide el volumen como lo percibe el oído (no el pico más alto). Lo midió el análisis de PAILA.', en: "LUFS is the unit that measures volume the way the ear hears it (not the highest peak). PAILA's analysis measured it." },
  intro: {
    es: 'Para que no haya saltos de volumen entre un tema y otro (o entre un disco viejo y uno nuevo) en los reproductores que lo respetan. PAILA lo calcula con la medición de volumen del análisis {lufs} y lo guarda **solo como dato en el tag**: el sonido no se toca.',
    en: "So there are no jumps in volume from one track to the next (or between an old album and a new one) in players that respect it. PAILA works it out from the volume measured by the analysis {lufs} and saves it **only as a value in the tag**: the sound isn't touched.",
  },
  queEs: { es: ' ¿Qué es ReplayGain? ⓘ', en: ' What is ReplayGain? ⓘ' },
  aviso: { es: 'Rekordbox y las bandejas de DJ no usan ReplayGain (Rekordbox tiene su propio "Auto Gain"): esto es para escuchar en casa, en el celular o en un servidor de música.', en: "Rekordbox and DJ decks don't use ReplayGain (Rekordbox has its own \"Auto Gain\"): this is for listening at home, on your phone or on a music server." },
  unidad: { es: 'temas', en: 'tracks' },
  cancelar: { es: 'Cancelar', en: 'Cancel' },
  calculando: { es: 'Calculando…', en: 'Calculating…' },
  calcularDeNuevo: { es: 'Calcular de nuevo', en: 'Calculate again' },
  calcular: { es: 'Calcular el volumen parejo', en: 'Calculate the even volume' },
  proponer: { es: (c: string) => `Sumar ${c} temas a lo que vas a aplicar`, en: (c: string) => `Add ${c} tracks to what you are going to apply` },
  arreglarMal: { es: (c: string) => `Arreglar solo los ${c} que venían con el volumen mal ⓘ`, en: (c: string) => `Fix only the ${c} that came with the wrong volume ⓘ` },
  quedo: { es: (c: string) => `Quedó el volumen parejo de ${c} temas en Cambios pendientes. Revisalo abajo y aplicá; se puede deshacer desde el Historial.`, en: (c: string) => `The even volume of ${c} tracks is now in Pending changes. Review it below and Apply; you can undo from History.` },
  listos: { es: 'Listos: ', en: 'Ready: ' },
  deEsos: { es: (c: string) => ` (de esos, ${c} venían con el volumen mal puesto por otro programa ⓘ)`, en: (c: string) => ` (of those, ${c} came with the volume set wrong by another program ⓘ)` },
  yaIgual: { es: ' · ya lo tienen igual: ', en: ' · already the same: ' },
  otroBien: { es: (c: string) => ` · con el de otro programa, bien: ${c} ⓘ`, en: (c: string) => ` · fine with another program's: ${c} ⓘ` },
  faltaAnalizarTip: { es: 'El volumen se mide en el análisis: cuando terminen de analizarse, calculá de nuevo.', en: 'The volume is measured in the analysis: when they finish being analyzed, calculate again.' },
  faltaAnalizar: { es: (c: string) => ` · falta analizar: ${c} ⓘ`, en: (c: string) => ` · still to analyze: ${c} ⓘ` },
  noEscribirTip: { es: "En los WMA no se escriben tags (se rompe el archivo): convertilos primero en 'Programas de DJ'.", en: "Tags can't be written in WMA files (it breaks the file): convert them first in 'DJ software'." },
  noEscribir: { es: (c: string) => ` · no se pueden escribir: ${c} ⓘ`, en: (c: string) => ` · can't be written: ${c} ⓘ` },
  porDisco: { es: ' · por disco ⓘ', en: ' · per album ⓘ' },
  disco: { es: 'disco ', en: 'album ' },
  nTemas: { es: (c: string) => `${c} temas`, en: (c: string) => `${c} tracks` },
  colTema: { es: 'Tema', en: 'Track' },
  colVolumen: { es: 'Volumen', en: 'Volume' },
  colAjuste: { es: 'Ajuste', en: 'Adjustment' },
  corrige: { es: (d: string) => `Corrige el de otro programa (${d})`, en: (d: string) => `Fixes the one from another program (${d})` },
})

export default function AlbumsGain({ onStaged }: { onStaged: () => void }) {
  const job = useJob('gain')
  const [plan, setPlan] = useState<GainPlan | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => { window.paila.gainLast().then(setPlan).catch(() => {}) }, [])
  const was = useRef(false)
  useEffect(() => { if (was.current && !job?.running) window.paila.gainLast().then(setPlan); was.current = !!job?.running }, [job?.running])
  const calc = () => window.paila.gainPlan().catch((e) => toast(clean(e), 'error'))
  const stage = async (onlyWrong = false) => {
    try { const k = await window.paila.gainStage(onlyWrong); onStaged(); toast(T.quedo(n(k))) } catch (e) { toast(clean(e), 'error') }
  }

  return (<>
    <p className="muted small">
      <Rico texto={T.intro} partes={{ lufs: <Info tip={T.lufs} /> }} />
      <span className="info" title={T.what}>{T.queEs}</span>
    </p>
    <div className="callout small">{T.aviso}</div>
    {job && <JobPanel job={job} unit={T.unidad} onDismiss={() => window.paila.dismissJob('gain')}>{job.running && <Boton variant="ghost" size="sm" disabled={job.cancelling} onClick={() => window.paila.cancelJob('gain')}>{T.cancelar}</Boton>}</JobPanel>}
    <div className="row">
      <Boton disabled={!!job?.running} onClick={calc}>{job?.running ? T.calculando : plan ? T.calcularDeNuevo : T.calcular}</Boton>
      {plan && plan.ready > 0 && <Boton onClick={() => stage()}>{T.proponer(n(plan.ready))}</Boton>}
      {plan && plan.wrong > 0 && <Boton variant="ghost" onClick={() => stage(true)} title={T.wrong}>{T.arreglarMal(n(plan.wrong))}</Boton>}
    </div>
    {plan && (
      <div className="callout">
        {T.listos}<b>{n(plan.ready)}</b>{plan.wrong ? <span title={T.wrong}>{T.deEsos(n(plan.wrong))}</span> : null}{T.yaIgual}{n(plan.same)}{plan.other ? <span title={T.other}>{T.otroBien(n(plan.other))}</span> : null}
        {plan.notAnalyzed ? <span title={T.faltaAnalizarTip}>{T.faltaAnalizar(n(plan.notAnalyzed))}</span> : null}
        {plan.cantWrite ? <span title={T.noEscribirTip}>{T.noEscribir(n(plan.cantWrite))}</span> : null}
        <span className="info" title={T.album}>{T.porDisco}</span>
      </div>
    )}
    {plan?.albums.map((a) => {
      const k = `${a.key}|${a.album}`
      return (
        <div key={k} className="box">
          <div className="box-head" style={{ cursor: 'pointer' }} onClick={() => setOpen(open === k ? null : k)} {...conTeclado(() => setOpen(open === k ? null : k))}>
            <b>{a.artist || a.album}</b>{a.artist && <span> — {a.album}</span>}
            {a.key && <span className="pill" title={T.album}>{T.disco}{db(a.gain)}</span>}
            <span className="muted small push-right">{T.nTemas(n(a.tracks.length))}</span>
          </div>
          {open === k && <div className="box-row" style={{ gridTemplateColumns: '1fr', cursor: 'default' }}>
            <table className="simple small">
              <thead><tr><th>{T.colTema}</th><th title={T.lufs}>{T.colVolumen}</th><th>{T.colAjuste}</th><th /></tr></thead>
              <tbody>{a.tracks.slice(0, 300).map((t) => <tr key={t.id}><td>{t.rel.split('/').pop()}</td><td>{t.lufs == null ? '–' : `${un(t.lufs)} LUFS`}</td><td>{db(t.gain)}</td><td className="muted">{t.why ?? (t.wrong != null ? <span title={T.wrong}>{T.corrige(db(t.wrong))}</span> : '')}</td></tr>)}</tbody>
            </table>
          </div>}
        </div>
      )
    })}
  </>)
}
