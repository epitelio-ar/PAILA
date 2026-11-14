// Ventana Reemplazar un tema: compara el archivo actual con otro mejor (A/B) y lo cambia conservando tags y playlists.
import { Icon } from './icons'
import { useEffect, useState } from 'react'
import type { ReplaceCompare, ReplaceOptions, ReplaceSide, Track } from '@paila/shared/types'
import { bytes, display, duration } from './format'
import { GRADE_HELP } from './problems'
import { ABPlayer } from './ABPlayer'
import { Ventana, Nota, Boton, Info } from '@paila/diseno'
import { textos, num } from '@paila/shared/idioma'
import { ConfirmarBoton, Resultado } from './Confirmar'

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
const dec = (x: number, d = 1) => num(x, { maximumFractionDigits: d })

const T = textos({
  sinAnalisis: { es: 'sin análisis', en: 'not analyzed' },
  lufsTip: { es: 'LUFS: qué tan fuerte suena el tema en promedio, como lo oye el oído. Más cerca de 0 = más fuerte.', en: 'LUFS: how loud the track sounds on average, as the ear hears it. Closer to 0 = louder.' },
  espectro: { es: 'Espectrograma', en: 'Spectrogram' },
  espectroTip: { es: 'Espectrograma: una foto del sonido. Si el color se corta de golpe en una línea horizontal, el archivo perdió los agudos (fue un MP3).', en: 'Spectrogram: a picture of the sound. If the color stops abruptly at a horizontal line, the file lost its high frequencies (it was an MP3).' },
  sinEspectro: { es: 'Sin espectrograma', en: 'No spectrogram' },
  titulo: { es: (t: string) => `Reemplazar: ${t}`, en: (t: string) => `Replace: ${t}` },
  intro: { es: 'El tema sigue siendo el mismo para PAILA: no pierde sus playlists. El archivo viejo va a la Papelera y podés volver atrás desde ahí.', en: "The track stays the same for PAILA: it keeps its playlists. The old file goes to the Trash and you can go back from there." },
  enRb: { es: 'Este tema ya está en tu Rekordbox. Si cambia el nombre o la extensión, en Rekordbox vas a tener que relocalizarlo y podés perder sus cue points. Con "Mismo nombre y carpeta" cambia solo la extensión.', en: 'This track is already in your Rekordbox. If the name or extension changes, you will have to relocate it in Rekordbox and may lose its cue points. With "Same name and folder" only the extension changes.' },
  listo: { es: (rel: string) => `Listo. El tema ahora usa ${rel}. PAILA lo va a analizar de nuevo para ponerle su nota. El archivo viejo está en la Papelera (sección Reemplazos).`, en: (rel: string) => `Done. The track now uses ${rel}. PAILA will analyze it again to give it a grade. The old file is in the Trash (Replacements section).` },
  cerrar: { es: 'Cerrar', en: 'Close' },
  elegir: { es: 'Elegir el archivo nuevo…', en: 'Choose the new file…' },
  analizando: { es: 'Analizando el archivo nuevo (unos segundos)…', en: 'Analyzing the new file (a few seconds)…' },
  actual: { es: 'Actual', en: 'Current' },
  nuevo: { es: 'Nuevo', en: 'New' },
  a: { es: 'A: actual', en: 'A: current' },
  b: { es: 'B: nuevo', en: 'B: new' },
  mantenerTags: { es: 'Mantener mis tags (el nuevo hereda artista, título, álbum…)', en: 'Keep my tags (the new one inherits artist, title, album…)' },
  sinTags: { es: ' — el nuevo no trae tags, conviene dejarlo tildado', en: " — the new one has no tags, so it's best to leave this ticked" },
  mantenerTapa: { es: 'Mantener mi tapa', en: 'Keep my cover' },
  mismoNombre: { es: 'Mismo nombre y carpeta (cambia solo la extensión)', en: 'Same name and folder (only the extension changes)' },
  mantenerPlaylists: { es: 'Mantener las playlists (siempre)', en: 'Keep the playlists (always)' },
  reemplazando: { es: 'Reemplazando…', en: 'Replacing…' },
  reemplazar: { es: 'Reemplazar', en: 'Replace' },
  reemplazarPreg: { es: (t: string) => `¿Reemplazar el archivo de «${t}» por el nuevo?`, en: (t: string) => `Replace the file of "${t}" with the new one?` },
  otro: { es: 'Elegir otro archivo…', en: 'Choose another file…' },
  copia: { es: 'El archivo que elegiste se copia: el original queda donde estaba.', en: 'The file you chose is copied: the original stays where it was.' },
})

function Side({ title, s, name }: { title: string; s: ReplaceSide; name?: string }) {
  return (
    <div className="rep-side">
      <h4>{title}</h4>
      {name && <div className="small muted rep-name" title={name}>{name}</div>}
      <div className="rep-grade">
        {s.grade ? <Nota grade={s.grade} big title={GRADE_HELP[s.grade as keyof typeof GRADE_HELP]} /> : <span className="muted">{T.sinAnalisis}</span>}
        <b>{s.label ?? ''}</b>
      </div>
      <div className="small">{s.ext.toUpperCase()}{s.kbps ? ` · ${s.kbps} kbps` : ''}{s.sampleRate ? ` · ${dec(s.sampleRate / 1000)} kHz` : ''}{s.bits ? ` / ${s.bits} bits` : ''}</div>
      <div className="small muted">{duration(s.duration)} · {bytes(s.size)}{s.lufs != null && <> · {dec(s.lufs)} LUFS <Info tip={T.lufsTip} /></>}</div>
      {s.spectrogram ? <img className="spectro" src={s.spectrogram} alt={T.espectro} title={T.espectroTip} /> : <div className="muted small">{T.sinEspectro}</div>}
      {s.why.length > 0 && <ul className="small">{s.why.slice(0, 3).map((w, i) => <li key={i}>{w}</li>)}</ul>}
    </div>
  )
}

/** Reemplazo básico: elegir el archivo nuevo, compararlo con el actual y reemplazar conservando tags, tapa, nombre y playlists. */
export default function Replace({ track, initialFile, onClose, onDone }: { track: Track; initialFile?: string; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<string | null>(null)
  const [cmp, setCmp] = useState<ReplaceCompare | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [opts, setOpts] = useState<ReplaceOptions>({ keepTags: true, keepCover: true, sameName: true })
  const [inRb, setInRb] = useState(false)
  useEffect(() => { window.paila.inRekordbox([track.id]).then((x) => setInRb(x.length > 0)) }, [track.id])
  const d = display(track)

  const pick = async (given?: string) => {
    setErr(null)
    const f = given ?? await window.paila.pickReplacement()
    if (!f) return
    setFile(f); setCmp(null); setBusy(true)
    try { setCmp(await window.paila.compareReplacement(track.id, f)) } catch (e) { setErr(clean(e)) } finally { setBusy(false) }
  }
  useEffect(() => { pick(initialFile) /* abre el selector de archivos al entrar (o usa el que viene de la Bandeja) */ }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const apply = async () => {
    if (!file) return
    setBusy(true); setErr(null)
    try { const rel = await window.paila.applyReplacement(track.id, file, opts); setDone(rel); onDone() } catch (e) { setErr(clean(e)) } finally { setBusy(false) }
  }

  return (
    <Ventana onClose={onClose} className="rep-modal">
        <h2>{T.titulo(d.title)}</h2>
        <p className="muted small">{T.intro}</p>
        {inRb && <p className="warn-inline"><Icon name="alert" size={13} className="ic-inline" /> {T.enRb}</p>}
        {done ? (
          <>
            <Resultado r={{ hechos: T.listo(done), deshacer: 'historial' }} />
            <Boton onClick={onClose}>{T.cerrar}</Boton>
          </>
        ) : (<>
          {!file && !busy && <Boton onClick={() => pick()}>{T.elegir}</Boton>}
          {busy && !cmp && <div className="row"><div className="spinner" /> <span className="muted">{T.analizando}</span></div>}
          {err && <p className="error">{err}</p>}
          {cmp && (<>
            {cmp.warnings.map((w, i) => <p key={i} className="warn-inline"><Icon name="alert" size={13} className="ic-inline" /> {w}</p>)}
            <div className="rep-grid">
              <Side title={T.actual} s={cmp.current} name={track.rel} />
              <Side title={T.nuevo} s={cmp.candidate} name={cmp.candidate.path} />
            </div>
            <ABPlayer sources={[{ label: T.a, url: cmp.audio.current }, { label: T.b, url: cmp.audio.candidate }]} />
            <div className="rep-opts">
              <label><input type="checkbox" checked={opts.keepTags} onChange={(e) => setOpts({ ...opts, keepTags: e.target.checked })} /> {T.mantenerTags}{!cmp.candidate.artist && !cmp.candidate.title && T.sinTags}</label>
              <label><input type="checkbox" checked={opts.keepCover} onChange={(e) => setOpts({ ...opts, keepCover: e.target.checked })} /> {T.mantenerTapa}</label>
              <label><input type="checkbox" checked={opts.sameName} onChange={(e) => setOpts({ ...opts, sameName: e.target.checked })} /> {T.mismoNombre}</label>
              <label className="muted"><input type="checkbox" checked disabled /> {T.mantenerPlaylists}</label>
            </div>
            <div className="modal-pie">
              <ConfirmarBoton disabled={busy} onSi={apply} deshacer="historial" pregunta={T.reemplazarPreg(d.title)}>{busy ? T.reemplazando : T.reemplazar}</ConfirmarBoton>
              <Boton variant="ghost" disabled={busy} onClick={() => pick()}>{T.otro}</Boton>
              <span className="muted small">{T.copia}</span>
            </div>
          </>)}
        </>)}
    </Ventana>
  )
}
