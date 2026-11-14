// Rekordbox nivel pro (Fase F), dos secciones de la pantalla Programas de DJ: traer lo que ya hiciste en Rekordbox y
// Serato (solo leyendo), y calcular la grilla y los cues sugeridos por playlist, con el tiempo estimado antes de arrancar.
import { useEffect, useState } from 'react'
import type { DjImportResult, GridEngineInfo, GridPlan, PlaylistNode } from '@paila/shared/types'
import { textos, num, plural } from '@paila/shared/idioma'
import { n } from './format'
import { JobPanel, useJob } from './jobs'
import { Aviso, Boton, Info, Rico } from '@paila/diseno'

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')

export const TIPS = textos({
  grilla: {
    es: 'La grilla marca dónde cae cada golpe del tema y cuál es el primero de cada compás (el "1"). Con ella, Rekordbox y las CDJ sincronizan y los loops caen justo.',
    en: 'The beat grid marks where each beat of the track falls and which one starts each bar (the "1"). With it, Rekordbox and CDJs can sync and loops land right on the beat.',
  },
  cue: {
    es: 'Un cue point es una marca en el tema para saltar ahí: los "hot cues" van en los pads (A, B, C…) y los "memory cues" se ven en la forma de onda.',
    en: 'A cue point is a marker in a track that you can jump to: "hot cues" go on the pads (A, B, C…) and "memory cues" show on the waveform.',
  },
  memory: {
    es: 'Memory cue: una marca que se ve en la forma de onda y se recorre con los botones de memoria de la CDJ.',
    en: 'Memory cue: a marker that shows on the waveform and that you step through with the memory buttons on the CDJ.',
  },
  mytag: {
    es: '"My tag" es una etiqueta tuya de Rekordbox (por ejemplo "Pico" o "Cierre"). En el XML viaja dentro del comentario si en Rekordbox está prendido "Agregar My Tag a los comentarios".',
    en: '"My Tag" is a label of your own in Rekordbox (for example "Peak" or "Closer"). In the XML it travels inside the comment if "Add My Tag to comments" is turned on in Rekordbox.',
  },
  beatthis: {
    es: 'Beat This! es una red neuronal (de la Universidad JKU de Linz) que escucha el tema y marca cada golpe y el primero de cada compás. Acierta más que el método de siempre. Es gratis (licencia MIT) y viene con PAILA (191 MB), así que anda sin que hagas nada.',
    en: 'Beat This! is a neural network (from JKU Linz university) that listens to the track and marks every beat and the first beat of each bar. It is more accurate than the usual method. It is free (MIT license) and comes with PAILA (191 MB), so it works without you doing anything.',
  },
  gpu: {
    es: 'La placa de video (la parte de la compu que dibuja la pantalla) hace las cuentas de Beat This! unas 15 veces más rápido que el procesador.',
    en: 'The graphics card (the part of your computer that draws the screen) does the math for Beat This! about 15 times faster than the processor.',
  },
  degara: {
    es: 'Sin Beat This!, PAILA usa el mismo método que para el BPM de todos los días (degara, de Essentia): es más rápido pero a veces se engancha medio golpe corrido o no acierta el 1 del compás.',
    en: 'Without Beat This!, PAILA uses the same method as for everyday BPM (degara, from Essentia): it is faster, but sometimes it locks on half a beat off or misses the 1 of the bar.',
  },
  serato: {
    es: 'Serato DJ guarda los cue points, los loops y la grilla adentro del archivo (en los tags). PAILA los lee sin tocar nada.',
    en: 'Serato DJ stores cue points, loops and the beat grid inside the file (in the tags). PAILA reads them without touching anything.',
  },
  variable: {
    es: 'Grilla variable: en los temas tocados sin metrónomo (rock en vivo, discos viejos) el tempo se mueve y una grilla fija se corre de a poco. PAILA la arma compás por compás, como el análisis dinámico de Rekordbox.',
    en: 'Variable grid: in tracks played without a metronome (live rock, old records) the tempo drifts and a fixed grid slowly slips. PAILA builds it bar by bar, like the dynamic analysis in Rekordbox.',
  },
  saltear: {
    es: 'Deja sin grilla el tema que se está calculando y sigue con el próximo, sin cancelar la tanda. Sirve para uno que tarda demasiado (un mix entero, por ejemplo). Después lo podés calcular solo, desde una playlist.',
    en: 'Leaves the track being calculated without a grid and goes on with the next one, without cancelling the batch. Useful for one that takes too long (a whole mix, for example). You can calculate it later on its own, from a playlist.',
  },
  sets: {
    es: 'Un set es un mix entero: tarda lo que cien temas y casi nunca se pincha encima de otro, así que la grilla de toda la Música los deja afuera. Si querés la grilla de uno, ponelo en una playlist y elegila acá.',
    en: 'A set is a whole mix: it takes as long as a hundred tracks and is hardly ever mixed over another one, so the grid for all the Music leaves sets out. If you want the grid of one, put it in a playlist and pick it here.',
  },
  rehacer: {
    es: 'Para encontrar los temas que se mueven, PAILA también escucha los que ya tienen grilla de Rekordbox o Serato. Tu grilla no se toca: solo se usa la de PAILA al exportar si marcás esa opción.',
    en: 'To find the tracks that drift, PAILA also listens to the ones that already have a Rekordbox or Serato grid. Your grid is not touched: PAILA\'s is only used when exporting, if you tick that option.',
  },
  desfase: {
    es: 'En muchos MP3, Rekordbox cuenta el tiempo entre 0,025 y 0,05 s distinto que la mayoría de los programas (depende de con qué se hizo el MP3). PAILA lo corrige solo al exportar, así la grilla y los cues no quedan corridos.',
    en: 'In many MP3s, Rekordbox counts time 0.025 to 0.05 s differently from most programs (it depends on what made the MP3). PAILA fixes this on its own when exporting, so the grid and cues don\'t end up shifted.',
  },
})

const T = textos({
  importIntro: {
    es: 'Así, cuando PAILA exporta de nuevo, **no se pierde lo que ya hiciste**: tu grilla, tus cue points {cue}, las estrellas, los colores y los "my tags" {mytag}. PAILA solo lee: la base de Rekordbox no se toca (está cifrada y escribirla podría romperla).',
    en: 'This way, when PAILA exports again, **what you already did is not lost**: your beat grid, your cue points {cue}, the stars, the colors and the "my tags" {mytag}. PAILA only reads: the Rekordbox database is not touched (it is encrypted and writing to it could break it).',
  },
  leyendo: { es: 'Leyendo…', en: 'Reading…' },
  traerXml: { es: 'Traer mi rekordbox.xml…', en: 'Import my rekordbox.xml…' },
  revisando: { es: 'Revisando los archivos…', en: 'Checking the files…' },
  buscarSerato: { es: 'Buscar marcadores de Serato', en: 'Look for Serato markers' },
  comoSacarXml: {
    es: 'En Rekordbox: **Archivo → Exportar colección en formato xml**. Después elegís ese archivo acá.',
    en: 'In Rekordbox: **File → Export Collection in xml format**. Then you choose that file here.',
  },
  resXml: {
    es: (t: number, m: number, porNombre: number) => `De **${num(t)}** temas del XML, **${num(m)}** están en PAILA${porNombre ? ` (${num(porNombre)} encontrados por nombre porque cambiaron de carpeta)` : ''}.`,
    en: (t: number, m: number, porNombre: number) => `Of the **${num(t)}** tracks in the XML, **${num(m)}** are in PAILA${porNombre ? ` (${num(porNombre)} found by name because they moved folders)` : ''}.`,
  },
  resSerato: {
    es: (t: number, m: number) => `Se revisaron **${num(t)}** archivos: **${num(m)}** tienen marcadores de Serato.`,
    en: (t: number, m: number) => `**${num(t)}** files were checked: **${num(m)}** have Serato markers.`,
  },
  resumen: {
    es: (g: number, c: number, s: number, col: number, mt: number) => `Grilla: ${num(g)} · cue points: ${num(c)} · estrellas: ${num(s)} · colores: ${num(col)} · my tags: ${num(mt)}`,
    en: (g: number, c: number, s: number, col: number, mt: number) => `Beat grid: ${num(g)} · cue points: ${num(c)} · stars: ${num(s)} · colors: ${num(col)} · my tags: ${num(mt)}`,
  },
  ojoPorNombre: {
    es: (k: number) => `Ojo: en Rekordbox esos ${num(k)} siguen en la carpeta vieja. Al importar el XML nuevo, Rekordbox puede mostrarlos como temas nuevos; los viejos aparecen como "no encontrados" y se arreglan con **Reubicar** (clic derecho) o borrándolos de la colección de Rekordbox.`,
    en: (k: number) => `Heads up: in Rekordbox those ${num(k)} are still in the old folder. When you import the new XML, Rekordbox may show them as new tracks; the old ones appear as "not found" and you fix them with **Relocate** (right-click) or by deleting them from the Rekordbox collection.`,
  },
  sinPareja: {
    es: (k: number, ej: string) => `${num(k)} ${plural(k, 'tema', 'temas')} de tu Música en Rekordbox no están en PAILA, por ejemplo: ${ej}.`,
    en: (k: number, ej: string) => `${num(k)} ${plural(k, 'track', 'tracks')} from your Music in Rekordbox ${k === 1 ? 'is' : 'are'} not in PAILA, for example: ${ej}.`,
  },
  unidad: { es: 'temas', en: 'tracks' },
  // grilla y cues
  gridIntro: {
    es: 'PAILA calcula la grilla {grilla} y sugiere cue points (Intro, Drop, Break y Outro, como en Rekordbox, al principio de cada frase de 8 compases). Viajan en el rekordbox.xml: Rekordbox ya no tiene que analizar esos temas. Si un tema ya tenía grilla o cues de Rekordbox o Serato, **ganan los tuyos**. El corrimiento de los MP3 {desfase} se corrige solo.',
    en: 'PAILA calculates the beat grid {grilla} and suggests cue points (Intro, Drop, Break and Outro, as in Rekordbox, at the start of each 8-bar phrase). They travel in the rekordbox.xml: Rekordbox no longer has to analyze those tracks. If a track already had a Rekordbox or Serato grid or cues, **yours win**. The MP3 offset {desfase} is fixed automatically.',
  },
  seCalcula: { es: 'Se calcula con {como}.', en: 'It is calculated with {como}.' },
  conGpu: {
    es: 'Beat This! {bt} con la placa de video {gpu} ({nombre})',
    en: 'Beat This! {bt} with the graphics card {gpu} ({nombre})',
  },
  conCpu: {
    es: 'Beat This! {bt} con el procesador (lento: no se encontró una placa de video que sirva)',
    en: 'Beat This! {bt} with the processor (slow: no usable graphics card was found)',
  },
  metodoRapido: { es: 'el método rápido {degara}', en: 'the fast method {degara}' },
  elegirCarpeta: { es: 'Elegir la carpeta de Beat This!…', en: 'Choose the Beat This! folder…' },
  carpetaDebeTener: { es: 'Tiene que tener {a} y {b}.', en: 'It must contain {a} and {b}.' },
  toda: { es: 'Toda la Música', en: 'All the Music' },
  volverACalcular: { es: 'Volver a calcular los que ya tienen grilla de PAILA', en: 'Recalculate the ones that already have a PAILA grid' },
  escucharTambien: { es: 'Escuchar también los que tienen grilla de Rekordbox o Serato {info}', en: 'Also listen to the ones that have a Rekordbox or Serato grid {info}' },
  paraCalcular: {
    es: (k: number, t: string, ya: number) => `**${num(k)}** ${plural(k, 'tema', 'temas')} para calcular: unos **${t}**${ya ? ` (${num(ya)} ya tienen grilla)` : ''}. Mientras tanto el análisis se pausa y podés seguir usando PAILA.`,
    en: (k: number, t: string, ya: number) => `**${num(k)}** ${plural(k, 'track', 'tracks')} to calculate: about **${t}**${ya ? ` (${num(ya)} already ${ya === 1 ? 'has' : 'have'} a grid)` : ''}. Meanwhile the analysis pauses and you can keep using PAILA.`,
  },
  todosTienen: { es: (k: number) => `Todos (${num(k)}) ya tienen grilla.`, en: (k: number) => `All ${num(k)} already have a grid.` },
  son: {
    es: (t: string) => `Son **${t}**: conviene dejar la compu enchufada. `,
    en: (t: string) => `That is **${t}**: it is best to leave your computer plugged in. `,
  },
  arranco: { es: '¿Arranco?', en: 'Shall I start?' },
  siCalcular: { es: 'Sí, calcular', en: 'Yes, calculate' },
  no: { es: 'No', en: 'No' },
  calcular: { es: 'Calcular grilla y cues', en: 'Calculate beat grid and cues' },
  cancelar: { es: 'Cancelar', en: 'Cancel' },
  saltear: { es: 'Saltear este', en: 'Skip this one' },
  setsAfuera: {
    es: (k: number) => `${plural(k, 'El set de la Música (un mix entero) no entra', `Los ${num(k)} sets de la Música (mixes enteros) no entran`)} {info}`,
    en: (k: number) => `${plural(k, 'The set in the Music (a whole mix) is left out', `The ${num(k)} sets in the Music (whole mixes) are left out`)} {info}`,
  },
  cuandoTermine: { es: 'Cuando termine esta tanda podés elegir otra lista.', en: 'When this batch finishes you can choose another list.' },
})

/** Traer de Rekordbox (su rekordbox.xml) y de Serato (lo que está en los archivos). Nunca escribe en Rekordbox. */
export function ImportSection() {
  const [res, setRes] = useState<DjImportResult | null>(null)
  const [busy, setBusy] = useState<'rb' | 'serato' | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const run = async (which: 'rb' | 'serato') => {
    setBusy(which); setMsg(null)
    try { const r = which === 'rb' ? await window.paila.rekordboxImport() : await window.paila.seratoImport(); if (r) setRes(r) } catch (e) { setMsg(clean(e)) } finally { setBusy(null) }
  }
  return (
    <>
      <p className="muted small">
        <Rico texto={T.importIntro} partes={{ cue: <Info tip={TIPS.cue} />, mytag: <Info tip={TIPS.mytag} /> }} />
      </p>
      {msg && <Aviso tone="error">{msg}</Aviso>}
      <div className="row">
        <Boton disabled={!!busy} onClick={() => run('rb')}>{busy === 'rb' ? T.leyendo : T.traerXml}</Boton>
        <Boton variant="ghost" disabled={!!busy} onClick={() => run('serato')}>{busy === 'serato' ? T.revisando : T.buscarSerato}</Boton>
        <Info tip={TIPS.serato} />
      </div>
      <p className="muted small"><Rico texto={T.comoSacarXml} /></p>
      {res && (
        <div className="callout">
          <Rico texto={res.source === 'rekordbox' ? T.resXml(res.tracks, res.matched, res.byName) : T.resSerato(res.tracks, res.matched)} />
          <div className="small">{T.resumen(res.grids, res.cues, res.stars, res.colours, res.myTags)}</div>
          {res.byName > 0 && <div className="small"><Rico texto={T.ojoPorNombre(res.byName)} /></div>}
          {res.unmatched.length > 0 && <div className="small muted">{T.sinPareja(res.unmatched.length, res.unmatched.slice(0, 3).map((p) => p.split('/').pop()).join(', '))}</div>}
        </div>
      )}
    </>
  )
}

/**
 * Con una tanda en marcha no se elige otra lista ni se muestra su estimación: en la misma pantalla había dos tiempos distintos
 * ("33 de 589, falta 1 h 56 min" y "pop: unos 33 min"). Arriba queda solo qué lista se está calculando (el título de la tanda).
 */
export const sePuedeElegir = (job: { running: boolean } | null) => !job?.running

const mins = (s: number) => (s < 90 ? `${Math.max(1, Math.round(s))} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${num(s / 3600, { maximumFractionDigits: 1 })} h`)

/** Grilla y cues sugeridos, por playlist o (con aviso del tiempo) toda la Música. */
export function GridSection({ playlists }: { playlists: PlaylistNode[] }) {
  const lists = playlists.filter((p) => p.kind !== 'folder')
  const [engine, setEngine] = useState<GridEngineInfo | null>(null)
  const [target, setTarget] = useState<number | 'todo'>(lists[0]?.id ?? 'todo')
  const [force, setForce] = useState(false)
  const [theirs, setTheirs] = useState(false)
  const [plan, setPlan] = useState<GridPlan | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const job = useJob('grid')

  useEffect(() => { window.paila.gridEngine(true).then(setEngine).catch(() => null) }, [])
  const elegir = sePuedeElegir(job)
  useEffect(() => {
    setPlan(null); setConfirm(false)
    if (!elegir) return
    window.paila.gridPlan(target === 'todo' ? null : target, force, theirs).then(setPlan).catch((e) => setMsg(clean(e)))
  }, [target, force, theirs, engine?.gpu, engine?.beatThis, job?.running])

  const chooseModels = async () => { try { const r = await window.paila.gridChooseModels(); if (r) setEngine(r) } catch (e) { setMsg(clean(e)) } }
  const start = async () => { setConfirm(false); setMsg(null); try { await window.paila.gridRun(target === 'todo' ? null : target, force, theirs) } catch (e) { setMsg(clean(e)) } }
  const bt = <Info tip={TIPS.beatthis} />
  const how = !engine ? '…' : engine.gpu ? <Rico texto={T.conGpu} partes={{ bt, gpu: <Info tip={TIPS.gpu} />, nombre: engine.gpu }} /> : engine.beatThis ? <Rico texto={T.conCpu} partes={{ bt }} /> : <Rico texto={T.metodoRapido} partes={{ degara: <Info tip={TIPS.degara} /> }} />
  const big = !!plan && plan.seconds > 20 * 60

  return (
    <>
      <p className="muted small">
        <Rico texto={T.gridIntro} partes={{ grilla: <Info tip={TIPS.grilla} />, desfase: <Info tip={TIPS.desfase} /> }} />
      </p>
      {msg && <Aviso tone="error">{msg}</Aviso>}
      <div className="small"><Rico texto={T.seCalcula} partes={{ como: how }} /></div>
      {engine && !engine.beatThis && (
        <div className="row" style={{ marginTop: 6 }}>
          <Boton variant="ghost" size="sm" onClick={chooseModels}>{T.elegirCarpeta}</Boton>
          <span className="muted small">{engine.missing} <Rico texto={T.carpetaDebeTener} partes={{ a: <code>beat-this/</code>, b: <code>npm/</code> }} /></span>
        </div>
      )}
      {elegir && <div className="row" style={{ marginTop: 8 }}>
        <select value={String(target)} onChange={(e) => setTarget(e.target.value === 'todo' ? 'todo' : Number(e.target.value))}>
          {lists.map((p) => <option key={p.id} value={p.id}>{p.name} ({n(p.count)})</option>)}
          <option value="todo">{T.toda}</option>
        </select>
        <label className="small"><input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> {T.volverACalcular}</label>
        <label className="small"><input type="checkbox" checked={theirs} onChange={(e) => setTheirs(e.target.checked)} /> <Rico texto={T.escucharTambien} partes={{ info: <Info tip={TIPS.rehacer} /> }} /></label>
      </div>}
      {elegir && plan && (
        <p className="small">
          {plan.tracks - plan.already > 0
            ? <Rico texto={T.paraCalcular(plan.tracks - plan.already, mins(plan.seconds), plan.already)} />
            : T.todosTienen(plan.tracks)}
          {plan.setsOut ? <> <Rico texto={T.setsAfuera(plan.setsOut)} partes={{ info: <Info tip={TIPS.sets} /> }} /></> : null}
        </p>
      )}
      {job && <JobPanel job={job} unit={T.unidad} onDismiss={() => window.paila.dismissJob('grid')}>{job.running && <>
        <Boton variant="ghost" size="sm" disabled={job.cancelling} onClick={() => window.paila.gridSkip()}>{T.saltear}</Boton><Info tip={TIPS.saltear} />
        <Boton variant="ghost" size="sm" disabled={job.cancelling} onClick={() => window.paila.cancelJob('grid')}>{T.cancelar}</Boton>
      </>}</JobPanel>}
      {!elegir && <p className="muted small">{T.cuandoTermine}</p>}
      {!job?.running && plan && plan.tracks > plan.already && (confirm
        ? <div className="actionrow"><span>{big ? <Rico texto={T.son(mins(plan.seconds))} /> : null}{T.arranco}</span><Boton onClick={start}>{T.siCalcular}</Boton><Boton variant="ghost" onClick={() => setConfirm(false)}>{T.no}</Boton></div>
        : <div><Boton onClick={() => (big || target === 'todo' ? setConfirm(true) : start())}>{T.calcular}</Boton></div>)}
    </>
  )
}
