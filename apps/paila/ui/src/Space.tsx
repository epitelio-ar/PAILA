// Pantalla Espacio: mapa de cuánto ocupa cada carpeta, formato y nota de calidad, para decidir qué liberar.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { JunkReport, OrganizeBatch, SavingsReport, ShrinkResult, SpaceNode } from '@paila/shared/types'
import { bytes, n } from './format'
import { squarify } from './treemap'
import { JobPanel, useJob } from './jobs'
import { Aviso, Boton, SERIE, Cabecera, Rico } from '@paila/diseno'
import { textos, cant, fechaHora, fecha } from '@paila/shared/idioma'
import { ConfirmarBoton, Resultado, type ResultadoTanda } from './Confirmar'
import { papeleraCambio } from './papelera'
import { AvisoRekordbox } from './AvisoRekordbox'
import { conTeclado } from './conTeclado'

const T = textos({
  sinNota: { es: 'sin nota', en: 'no grade' },
  nota: { es: (g: string) => `nota ${g}`, en: (g: string) => `grade ${g}` },
  toda: { es: 'Toda la biblioteca', en: 'Whole library' },
  enchico: { es: (b: string, k: string) => ` · ${b} en ${k} archivos`, en: (b: string, k: string) => ` · ${b} in ${k} files` },
  archivos: { es: (k: number) => cant(k, 'archivo', 'archivos'), en: (k: number) => cant(k, 'file', 'files') },
  leyenda: { es: '· En carpetas el color es el promedio por tamaño: rojo = mucha mala calidad.', en: '· For folders the color is the average by size: red = a lot of poor quality.' },
  titulo: { es: 'Espacio', en: 'Space' },
  sub: { es: 'Qué ocupa el disco, pintado por calidad.', en: 'What fills your disk, painted by quality.' },
  tMapa: { es: 'Mapa', en: 'Map' },
  tLimpieza: { es: 'Lo que no es música', en: "What isn't music" },
  tAhorro: { es: 'Cuánto puedo ahorrar', en: 'How much I can save' },
  mapaIntro: { es: 'Cada rectángulo es una carpeta o un archivo y su tamaño es lo que ocupa. Hacé clic en una carpeta para entrar y en un archivo para verlo en la biblioteca. El color muestra la **calidad**: las manchas rojas son donde está el espacio mal usado.', en: 'Each rectangle is a folder or a file, and its size is how much room it takes. Click a folder to go in, and a file to see it in the library. The color shows the **quality**: red patches are where space is poorly used.' },
  pintar: { es: 'Pintar por ', en: 'Paint by ' },
  pintarNota: { es: 'Nota de calidad', en: 'Quality grade' },
  pintarFormato: { es: 'Formato', en: 'Format' },
  limpiezaIntro: { es: 'Busca en tu Música lo que **no es música**: videos, comprimidos, archivos temporales, imágenes sueltas. Lo que elijas va a la **papelera** de PAILA (no se borra) y se puede restaurar. No mira los sample packs, inéditos ni sets, y las tapas llamadas cover o folder se dejan.', en: "Looks in your Music for what **isn't music**: videos, compressed files, temporary files, loose images. What you pick goes to PAILA's **trash** (it isn't deleted) and can be restored. It skips sample packs, unreleased tracks and sets, and covers named cover or folder are left alone." },
  buscando: { es: 'Buscando…', en: 'Searching…' },
  buscarDeNuevo: { es: 'Buscar de nuevo', en: 'Search again' },
  buscar: { es: 'Buscar archivos que no son música', en: "Search for files that aren't music" },
  nada: { es: 'No encontré nada. Tu Música está limpia.', en: 'I found nothing. Your Music is clean.' },
  porTipo: { es: (k: string, v: string, b: string) => `**${k}**: ${v} archivos, ${b}`, en: (k: string, v: string, b: string) => `**${k}**: ${v} files, ${b}` },
  vacias: { es: (k: string) => `Además hay ${k} carpetas vacías: no tienen ningún archivo.`, en: (k: string) => `There are also ${k} empty folders: they have no files at all.` },
  sacarVacias: { es: (k: string) => `Sacar ${k} carpetas vacías`, en: (k: string) => `Remove ${k} empty folders` },
  sacarPreg: { es: (k: string) => `¿Sacar ${k} carpetas vacías?`, en: (k: string) => `Remove ${k} empty folders?` },
  sacarAviso: { es: 'Solo las que no tienen ningún archivo, de la más adentro a la de afuera; nunca en sample packs, inéditos, sets ni lo excluido. Se deshace desde el Historial: las vuelve a crear.', en: 'Only the ones with no files at all, from the innermost out; never in sample packs, unreleased tracks, sets or anything excluded. You can undo it from the History: it creates them again.' },
  verVacias: { es: 'Ver cuáles', en: 'See which' },
  ocultarVacias: { es: 'Ocultar', en: 'Hide' },
  sacadas: { es: (k: string) => `Se sacaron ${k} carpetas vacías.`, en: (k: string) => `${k} empty folders were removed.` },
  mandar: { es: (k: string, b: string) => `Mandar ${k} archivos (${b}) a la papelera`, en: (k: string, b: string) => `Send ${k} files (${b}) to the trash` },
  mandarPreg: { es: (k: string, b: string) => `¿Mandar ${k} archivos (${b}) a la papelera?`, en: (k: string, b: string) => `Send ${k} files (${b}) to the trash?` },
  sePuedeDeshacer: { es: 'Se puede deshacer.', en: 'This can be undone.' },
  anteriores: { es: 'Limpiezas anteriores', en: 'Previous clean-ups' },
  restaurados: { es: ' · restaurados', en: ' · restored' },
  yaNoSePuede: { es: (d: string) => ` · ya no se pueden restaurar: se vació la papelera el ${d}`, en: (d: string) => ` · can no longer be restored: the trash was emptied on ${d}` },
  restaurar: { es: 'Restaurar', en: 'Restore' },
  restaurarPreg: { es: (k: number) => `¿Restaurar ${cant(k, 'archivo', 'archivos')} a donde estaban?`, en: (k: number) => `Put ${cant(k, 'file', 'files')} back where they were?` },
  ahorroIntro: { es: 'Cuánto espacio se puede liberar **sin perder calidad**. PAILA nunca convierte de con pérdida a sin pérdida.', en: 'How much space can be freed **without losing quality**. PAILA never converts from lossy to lossless.' },
  wavFlac: { es: 'WAV y AIFF → FLAC', en: 'WAV and AIFF → FLAC' },
  wavFlacSub: { es: ' mismo audio, alrededor de 45 % menos de espacio', en: ' same audio, about 45% less space' },
  wavLinea: { es: (k: string, b: string, a: string) => `${k} archivos (${b}) → ahorro estimado **${a}**`, en: (k: string, b: string, a: string) => `${k} files (${b}) → estimated saving **${a}**` },
  wavExplica: { es: 'Cada conversión se **verifica** comparando el audio bit a bit con el original; si no coincide, no se reemplaza. Conserva tags y tapa. El WAV original va a la Papelera (Reemplazos), así que se puede deshacer; por eso el espacio se libera recién cuando **vaciás la papelera**. Las conversiones no se hacen sobre samples ni proyectos.', en: 'Each conversion is **verified** by comparing the audio bit by bit with the original; if it does not match, it is not replaced. Tags and cover are kept. The original WAV goes to the Trash (Replacements), so it can be undone; that is why the space is only freed once you **empty the trash**. Samples and projects are never converted.' },
  cancelar: { es: 'Cancelar', en: 'Cancel' },
  convertirPreg: { es: (k: string) => `¿Convertir ${k} archivos a FLAC?`, en: (k: string) => `Convert ${k} files to FLAC?` },
  convertirAviso: { es: 'Puede tardar un buen rato. El análisis se pausa solo mientras tanto.', en: 'It can take quite a while. The analysis pauses by itself meanwhile.' },
  convertirBtn: { es: 'Convertir a FLAC…', en: 'Convert to FLAC…' },
  listoConv: { es: (k: string) => `Listo: ${k} convertidos.`, en: (k: string) => `Done: ${k} converted.` },
  originales: { es: 'Los originales quedaron en la Papelera: **liberás {b} cuando la vacíes**.', en: 'The originals were left in the Trash: **you free up {b} once you empty it**.' },
  dupIdent: { es: 'Duplicados idénticos', en: 'Identical duplicates' },
  dupIdentSub: { es: ' el mismo archivo copiado', en: ' the same file, copied' },
  dupGrupos: { es: '{g} grupos → sobran **{b}**. Resolvelos desde **Duplicados**.', en: '{g} groups → **{b}** too much. Sort them out from **Duplicates**.' },
  dupLeer: { es: 'Hay que leer los archivos para calcularlo (puede tardar un minuto).', en: 'The files have to be read to work this out (it can take a minute).' },
  calcDeNuevo: { es: 'Calcular de nuevo', en: 'Calculate again' },
  calcular: { es: 'Calcular', en: 'Calculate' },
  falsos: { es: 'FLAC falsos', en: 'Fake FLACs' },
  falsosSub: { es: ' sin pérdida en el nombre, pero con pérdida de verdad', en: ' lossless in the name, but really lossy' },
  falsosLinea: { es: '{k} archivos ({b}). Si los pasaras a MP3 320, que es lo que realmente tienen, se liberarían **{a}** sin perder nada audible.', en: '{k} files ({b}). If you turned them into MP3 320, which is what they really are, you would free up **{a}** without losing anything you can hear.' },
  falsosNota: { es: 'Esto es solo un cálculo: PAILA no los convierte sola. Mirá "Lossless falsos" en el Centro de problemas para decidir caso por caso.', en: 'This is only an estimate: PAILA does not convert them by itself. Look at "Fake lossless" in the Problem center to decide case by case.' },
  kBasura: { es: 'Archivos auxiliares y temporales', en: 'Helper and temporary files' },
  kLista: { es: 'Playlists viejas (.m3u)', en: 'Old playlists (.m3u)' },
  kImagen: { es: 'Imágenes sueltas', en: 'Loose images' },
  kProyecto: { es: 'Análisis de otros programas (.asd…)', en: 'Analysis files from other programs (.asd…)' },
  kVideo: { es: 'Videos', en: 'Videos' },
  kComprimido: { es: 'Comprimidos sin abrir', en: 'Unopened compressed files' },
  mandaron: { es: (k: string) => `Se mandaron ${k} archivos.`, en: (k: string) => `${k} files were sent.` },
  restauraron: { es: (k: string) => `Se restauraron ${k} archivos.`, en: (k: string) => `${k} files were restored.` },
})

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
// Los mismos colores fijos de las notas que usan la tabla, el Inicio y los gráficos (tokens de @paila/diseno).
const GRADE_COLOR: Record<string, string> = { 'A+': 'var(--nota-ap)', A: 'var(--nota-a)', B: 'var(--nota-b)', C: 'var(--nota-c)', D: 'var(--nota-d)', F: 'var(--nota-f)', '-': 'var(--borde-fuerte)' }
const SCORE: Record<string, number> = { 'A+': 100, A: 100, B: 85, C: 65, D: 35, F: 0 }
const FMT_HUE = SERIE

function colorFor(nd: SpaceNode, mode: 'nota' | 'formato', formats: string[]): string {
  if (mode === 'formato') {
    const top = Object.entries(nd.f).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
    return FMT_HUE[Math.max(0, formats.indexOf(top)) % FMT_HUE.length]
  }
  const entries = Object.entries(nd.g)
  if (!nd.ch && entries.length === 1) return GRADE_COLOR[entries[0][0]] ?? GRADE_COLOR['-']
  // carpeta: el color de la nota que corresponde al puntaje medio (por tamaño) de lo que tiene nota; gris si nada tiene nota
  let w = 0, s = 0
  for (const [g, b] of entries) if (SCORE[g] !== undefined) { w += b; s += SCORE[g] * b }
  if (!w) return GRADE_COLOR['-']
  const media = s / w
  return GRADE_COLOR[media >= 95 ? 'A' : media >= 78 ? 'B' : media >= 55 ? 'C' : media >= 25 ? 'D' : 'F']
}

function Treemap({ root, mode, onOpenTrack }: { root: SpaceNode; mode: 'nota' | 'formato'; onOpenTrack: (id: number) => void }) {
  const [path, setPath] = useState<number[]>([])
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 900, h: 460 })
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: 460 }))
    ro.observe(el); setSize({ w: el.clientWidth, h: 460 })
    return () => ro.disconnect()
  }, [])
  const trail = useMemo(() => { const out = [root]; for (const i of path) { const nx = out[out.length - 1].ch?.[i]; if (!nx) break; out.push(nx) } return out }, [root, path])
  const cur = trail[trail.length - 1]
  const formats = useMemo(() => Object.entries(root.f).sort((a, b) => b[1] - a[1]).map(([k]) => k), [root])
  const rects = useMemo(() => squarify((cur.ch ?? []).map((c, i) => ({ item: { c, i }, value: c.b })), 0, 0, size.w, size.h), [cur, size])

  return (
    <div>
      <div className="small" style={{ marginBottom: 6 }}>
        {trail.map((t, i) => <span key={i}><button className="link" onClick={() => setPath(path.slice(0, i))}>{i === 0 ? T.toda : t.n}</button>{i < trail.length - 1 && ' › '}</span>)}
        <span className="muted">{T.enchico(bytes(cur.b), n(cur.c))}</span>
      </div>
      <div ref={box} className="treemap" style={{ height: size.h }}>
        {rects.map(({ item: { c, i }, x, y, w, h }) => (
          <div key={i} className="tm-cell" style={{ left: x, top: y, width: Math.max(0, w - 2), height: Math.max(0, h - 2), background: colorFor(c, mode, formats) }}
            title={`${c.n}\n${bytes(c.b)} · ${T.archivos(c.c)}${mode === 'nota' ? '\n' + Object.entries(c.g).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([g, b]) => `${g === '-' ? T.sinNota : T.nota(g)}: ${bytes(b)}`).join(' · ') : ''}`}
            onClick={() => (c.ch ? setPath([...path, i]) : c.id != null && onOpenTrack(c.id))} {...conTeclado(() => (c.ch ? setPath([...path, i]) : c.id != null && onOpenTrack(c.id)))} aria-label={c.n}>
            {w > 70 && h > 22 && <span className="tm-label">{c.n}{w > 110 && h > 40 && <small>{bytes(c.b)}</small>}</span>}
          </div>
        ))}
      </div>
      <div className="tm-legend small muted">
        {mode === 'nota'
          ? Object.entries(GRADE_COLOR).map(([g, c]) => <span key={g}><i style={{ background: c }} />{g === '-' ? T.sinNota : g}</span>)
          : formats.slice(0, 8).map((f, k) => <span key={f}><i style={{ background: FMT_HUE[k % FMT_HUE.length] }} />{f.toUpperCase()}</span>)}
        <span>{T.leyenda}</span>
      </div>
    </div>
  )
}

/** Espacio: el "WinDirStat" de PAILA. Mapa por nota, archivos que no son música y calculadora de ahorro. */
export default function Space({ onOpenTrack, onChanged }: { onOpenTrack: (id: number) => void; onChanged: () => void }) {
  const [tab, setTab] = useState<'mapa' | 'limpieza' | 'ahorro'>('mapa')
  const [tree, setTree] = useState<SpaceNode | null>(null)
  const [mode, setMode] = useState<'nota' | 'formato'>('nota')
  const [junk, setJunk] = useState<JunkReport | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [sav, setSav] = useState<SavingsReport | null>(null)
  const [dups, setDups] = useState<{ groups: number; bytes: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [res, setRes] = useState<ResultadoTanda | null>(null)
  const shrinkJob = useJob('shrink')
  const [shrink, setShrink] = useState<ShrinkResult | null>(null)
  const [batches, setBatches] = useState<OrganizeBatch[]>([])
  const [verVacias, setVerVacias] = useState(false)

  useEffect(() => { window.paila.spaceTree().then(setTree).catch((e) => setMsg(clean(e))) }, [])
  useEffect(() => { if (tab === 'ahorro' && !sav) window.paila.spaceSavings().then(setSav) }, [tab, sav])
  useEffect(() => { if (tab === 'limpieza') window.paila.organizeBatches().then((b) => setBatches(b.filter((x) => x.files === 0))) }, [tab, junk])

  const scanJunk = async () => {
    setBusy(true); setMsg(null); setRes(null)
    try { const j = await window.paila.spaceJunk(); setJunk(j); setPicked(new Set(j.files.filter((f) => f.kind === 'basura').map((f) => `${f.rootId}|${f.rel}`))) } catch (e) { setMsg(clean(e)) } finally { setBusy(false) }
  }
  const trashJunk = async () => {
    setBusy(true)
    try {
      const r = await window.paila.spaceTrash([...picked].map((k) => ({ rootId: Number(k.split('|')[0]), rel: k.slice(k.indexOf('|') + 1) })))
      const hecho: ResultadoTanda = { hechos: T.mandaron(n(r.moved)), fallados: r.failed, deshacer: 'papelera' }
      // buscar de nuevo borra el resultado: va después (antes se perdía y no se veía nunca)
      await scanJunk(); onChanged(); papeleraCambio()
      setRes(hecho)
    } catch (e) { setMsg(clean(e)); setBusy(false) }
  }
  const removeEmpty = async () => {
    if (!junk) return
    setBusy(true)
    try {
      const r = await window.paila.spaceEmpty(junk.emptyDirs)
      const hecho: ResultadoTanda = { hechos: T.sacadas(n(r.removed)), fallados: r.failed, deshacer: 'historial' }
      await scanJunk(); setRes(hecho)
    } catch (e) { setMsg(clean(e)); setBusy(false) }
  }
  const undo = async (b: OrganizeBatch) => {
    try { const r = await window.paila.organizeUndo(b.batchId); setMsg(null); setRes({ hechos: T.restauraron(n(r.extras)), fallados: r.failed }); setBatches((await window.paila.organizeBatches()).filter((x) => x.files === 0)) } catch (e) { setMsg(clean(e)) }
  }
  const doShrink = async () => {
    setBusy(true); setShrink(null); setMsg(null)
    try { const r = await window.paila.spaceShrink(); setShrink(r); onChanged(); setSav(await window.paila.spaceSavings()) } catch (e) { setMsg(clean(e)) } finally { setBusy(false) }
  }

  const pickedBytes = (junk?.files ?? []).filter((f) => picked.has(`${f.rootId}|${f.rel}`)).reduce((s, f) => s + f.size, 0)
  const KIND_LABEL: Record<string, string> = { basura: T.kBasura, lista: T.kLista, imagen: T.kImagen, proyecto: T.kProyecto, video: T.kVideo, comprimido: T.kComprimido }

  return (
    <div className="page">
      <Cabecera nivel={2} titulo={T.titulo} sub={T.sub} />
      <div className="tabs">
        {(['mapa', 'limpieza', 'ahorro'] as const).map((t) => <button key={t} className={`tab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>{t === 'mapa' ? T.tMapa : t === 'limpieza' ? T.tLimpieza : T.tAhorro}</button>)}
      </div>
      {msg && <Aviso>{msg}</Aviso>}
      {res && <Resultado r={res} />}

      {tab === 'mapa' && (<>
        <p className="muted"><Rico texto={T.mapaIntro} /></p>
        <div className="row"><label className="small">{T.pintar}<select value={mode} onChange={(e) => setMode(e.target.value as 'nota' | 'formato')}><option value="nota">{T.pintarNota}</option><option value="formato">{T.pintarFormato}</option></select></label></div>
        {!tree ? <div className="spinner" /> : <Treemap root={tree} mode={mode} onOpenTrack={onOpenTrack} />}
      </>)}

      {tab === 'limpieza' && (<>
        <p className="muted"><Rico texto={T.limpiezaIntro} /></p>
        <div className="row"><Boton disabled={busy} onClick={scanJunk}>{busy && !junk ? T.buscando : junk ? T.buscarDeNuevo : T.buscar}</Boton></div>
        {junk && (<>
          <div className="callout">
            {Object.entries(junk.byKind).length === 0 ? T.nada : Object.entries(junk.byKind).sort((a, b) => b[1].bytes - a[1].bytes).map(([k, v]) => <div key={k}>• <Rico texto={T.porTipo(KIND_LABEL[k] ?? k, n(v.count), bytes(v.bytes))} /></div>)}
            {junk.emptyDirs.length > 0 && <div className="muted small">{T.vacias(n(junk.emptyDirs.length))} <Boton size="sm" variant="ghost" onClick={() => setVerVacias((v) => !v)}>{verVacias ? T.ocultarVacias : T.verVacias}</Boton></div>}
          </div>
          {junk.emptyDirs.length > 0 && (<>
            <div className="row"><ConfirmarBoton variant="ghost" disabled={busy} onSi={removeEmpty} deshacer="historial" pregunta={T.sacarPreg(n(junk.emptyDirs.length))} aviso={<span className="small">{T.sacarAviso}</span>}>{T.sacarVacias(n(junk.emptyDirs.length))}</ConfirmarBoton></div>
            {verVacias && <div className="listbox" style={{ maxHeight: 240 }}>{junk.emptyDirs.slice(0, 400).map((d) => <div key={`${d.rootId}|${d.rel}`} className="listbox-row"><span>{d.rel}/</span></div>)}</div>}
          </>)}
          {junk.files.length > 0 && (<>
            <div className="actionbar"><ConfirmarBoton disabled={busy || !picked.size} onSi={trashJunk} deshacer="papelera" pregunta={T.mandarPreg(n(picked.size), bytes(pickedBytes))}>{T.mandar(n(picked.size), bytes(pickedBytes))}</ConfirmarBoton><span className="muted small">{T.sePuedeDeshacer}</span></div>
            <div className="listbox" style={{ maxHeight: 420 }}>
              {[...junk.files].sort((a, b) => b.size - a.size).slice(0, 400).map((f) => {
                const k = `${f.rootId}|${f.rel}`
                return (
                  <label key={k} className="listbox-row"><span title={f.why}><input type="checkbox" checked={picked.has(k)} onChange={(e) => setPicked((s) => { const t = new Set(s); e.target.checked ? t.add(k) : t.delete(k); return t })} /> {f.rel} <span className="muted small">({KIND_LABEL[f.kind] ?? f.kind})</span></span><span className="muted">{bytes(f.size)}</span></label>
                )
              })}
            </div>
          </>)}
        </>)}
        {batches.length > 0 && (<><h4>{T.anteriores}</h4>{batches.map((b) => (
          <div key={b.batchId} className="box"><div className="box-head"><b>{fechaHora(b.createdAt)}</b><span className="muted small"> {T.archivos(b.extras)}{b.undone ? T.restaurados : b.purgedAt ? T.yaNoSePuede(fecha(b.purgedAt)) : ''}</span>{!b.undone && !b.purgedAt && <span className="push-right"><ConfirmarBoton size="sm" variant="ghost" onSi={() => undo(b)} deshacer="atras" pregunta={T.restaurarPreg(b.extras)}>{T.restaurar}</ConfirmarBoton></span>}</div></div>
        ))}</>)}
      </>)}

      {tab === 'ahorro' && (<>
        <p className="muted"><Rico texto={T.ahorroIntro} /></p>
        {!sav ? <div className="spinner" /> : (<>
          <div className="box">
            <div className="box-head"><b>{T.wavFlac}</b><span className="muted small">{T.wavFlacSub}</span></div>
            <div className="box-row" style={{ gridTemplateColumns: '1fr', cursor: 'default' }}>
              <span><Rico texto={T.wavLinea(n(sav.wavAiff.count), bytes(sav.wavAiff.bytes), bytes(sav.wavAiff.saving))} /></span>
              <span className="muted small"><Rico texto={T.wavExplica} /></span>
              <AvisoRekordbox n={sav.wavAiff.inRekordbox} que="formato" />
              {shrinkJob && <JobPanel job={shrinkJob} unit="archivos" onDismiss={() => window.paila.dismissJob('shrink')}>{shrinkJob.running && <Boton variant="ghost" size="sm" disabled={shrinkJob.cancelling} onClick={() => window.paila.cancelJob('shrink')}>{T.cancelar}</Boton>}</JobPanel>}
              {shrinkJob?.running ? null : (
                <div><ConfirmarBoton disabled={busy || !!shrinkJob?.running || !sav.wavAiff.count} onSi={doShrink} deshacer="historial" pregunta={T.convertirPreg(n(sav.wavAiff.count))} aviso={<><AvisoRekordbox n={sav.wavAiff.inRekordbox} que="formato" /><span className="small">{T.convertirAviso}</span></>}>{T.convertirBtn}</ConfirmarBoton></div>
              )}
              {shrink && <Resultado r={{ hechos: T.listoConv(n(shrink.converted)), fallados: shrink.failed, deshacer: 'historial', extra: shrink.converted > 0 ? <div><Rico texto={T.originales} partes={{ b: bytes(shrink.savedBytes) }} /></div> : undefined }} />}
            </div>
          </div>

          <div className="box">
            <div className="box-head"><b>{T.dupIdent}</b><span className="muted small">{T.dupIdentSub}</span></div>
            <div className="box-row" style={{ gridTemplateColumns: '1fr auto', cursor: 'default' }}>
              <span>{dups ? <Rico texto={T.dupGrupos} partes={{ g: n(dups.groups), b: bytes(dups.bytes) }} /> : T.dupLeer}</span>
              <Boton variant="ghost" size="sm" disabled={busy} onClick={async () => { setBusy(true); try { setDups(await window.paila.spaceDuplicateSavings()) } finally { setBusy(false) } }}>{dups ? T.calcDeNuevo : T.calcular}</Boton>
            </div>
          </div>

          <div className="box">
            <div className="box-head"><b>{T.falsos}</b><span className="muted small">{T.falsosSub}</span></div>
            <div className="box-row" style={{ gridTemplateColumns: '1fr', cursor: 'default' }}>
              <span><Rico texto={T.falsosLinea} partes={{ k: n(sav.fakeLossless.count), b: bytes(sav.fakeLossless.bytes), a: bytes(sav.fakeLossless.saving) }} /></span>
              <span className="muted small">{T.falsosNota}</span>
            </div>
          </div>
        </>)}
      </>)}
    </div>
  )
}
