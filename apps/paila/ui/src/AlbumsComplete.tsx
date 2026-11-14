// Pestaña "Discos completos": busca la lista de temas oficial de cada disco (MusicBrainz y, con clave, Discogs), muestra qué
// falta y qué está repetido, deja elegir la edición cuando hay duda y manda lo que falta a la lista «Faltan o suenan mal».
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AlbumReport, AlbumStatus, AlbumsSummary } from '@paila/shared/types'
import type { PageKey } from './nav'
import { JobPanel, useJob } from './jobs'
import { duration, n } from './format'
import { toast } from './toast'
import { Boton, Info, Pildora, Rico } from '@paila/diseno'
import { textos, cant } from '@paila/shared/idioma'
import { conTeclado } from './conTeclado'

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
const T = textos({
  sEligirL: { es: 'Elegí la edición', en: 'Pick the edition' },
  sEligirH: { es: 'Dos ediciones (por ejemplo la normal y una con temas extra) coinciden igual de bien con lo que tenés: elegí cuál es la tuya.', en: 'Two editions (for example the regular one and one with extra tracks) match what you have equally well: pick which one is yours.' },
  sFaltanL: { es: 'Faltan temas', en: 'Missing tracks' },
  sFaltanH: { es: 'Tenés parte del disco: abajo están los temas que faltan.', en: 'You have part of the album: the missing tracks are listed below.' },
  sNoL: { es: 'No aparece en internet', en: 'Not found online' },
  sNoH: { es: 'No apareció en las bases de datos con esos temas (discos independientes, vinilos sin editar, nombres de álbum que no son el del disco). Con la clave de Discogs se encuentran más.', en: "It didn't show up in the databases with those tracks (indie releases, unreleased vinyl, album names that aren't the real title). With a Discogs key more are found." },
  sSinL: { es: 'Sin buscar', en: 'Not searched yet' },
  sSinH: { es: 'Todavía no se buscó su lista de temas.', en: "Its track list hasn't been looked up yet." },
  sCompletoL: { es: 'Completo', en: 'Complete' },
  sCompletoH: { es: 'Tenés todos los temas de esa edición.', en: 'You have all the tracks of that edition.' },
  sIgnoL: { es: 'Ignorado', en: 'Ignored' },
  sIgnoH: { es: 'Lo marcaste para no revisarlo.', en: 'You marked it to skip.' },
  edicion: { es: 'Un mismo disco sale en varias ediciones: la normal, la "deluxe" o "edición especial" con temas extra, la remasterizada, la japonesa con un tema de regalo. PAILA elige la que mejor coincide con lo que tenés; si dos coinciden igual, te pregunta.', en: 'The same album comes out in several editions: the regular one, the "deluxe" or "special edition" with extra tracks, the remastered one, the Japanese one with a bonus track. PAILA picks the one that best matches what you have; if two match equally, it asks you.' },
  intro: {
    es: (deezer: boolean, discogs: boolean) => `Busca la lista de temas oficial de cada disco en **MusicBrainz**${deezer ? ', **Deezer**' : ''}${discogs ? ' y **Discogs**' : ' (y en **Discogs** si cargás su clave en Configuración)'} y la compara con lo que tenés. Solo se envía el artista y el nombre del disco. **No cambia ningún archivo.**`,
    en: (deezer: boolean, discogs: boolean) => `Looks up the official track list of each album on **MusicBrainz**${deezer ? ', **Deezer**' : ''}${discogs ? ' and **Discogs**' : ' (and on **Discogs** if you add its key in Settings)'} and compares it with what you have. Only the artist and the album name are sent. **It doesn't change any file.**`,
  },
  paraRevisar: { es: (c: string) => `**${c}** discos para revisar`, en: (c: string) => `**${c}** albums to review` },
  noSeRevisan: { es: (c: string) => ` · ${c} no se revisan ⓘ`, en: (c: string) => ` · ${c} not reviewed ⓘ` },
  noSeRevisanTip: { es: 'Discos con menos de 3 temas juntos, o que están dentro de una carpeta-playlist (no en su carpeta ni en la de su artista): no tiene sentido decir que están incompletos.', en: "Albums with fewer than 3 tracks together, or inside a playlist folder (not in their own folder or their artist's): it makes no sense to call them incomplete." },
  faltanBuscar: { es: (c: string) => ` · faltan buscar **${c}** `, en: (c: string) => ` · still to search: **${c}** ` },
  cerca: { es: (min: number) => `(cerca de ${min} min; podés cambiar de pantalla)`, en: (min: number) => `(about ${min} min; you can switch screens)` },
  unidad: { es: 'discos', en: 'albums' },
  cancelar: { es: 'Cancelar', en: 'Cancel' },
  buscando: { es: 'Buscando…', en: 'Searching…' },
  seguir: { es: (c: string) => `Seguir buscando (${c})`, en: (c: string) => `Keep searching (${c})` },
  buscarListas: { es: 'Buscar las listas de temas', en: 'Look up the track lists' },
  buscarDeNuevo: { es: 'Buscar de nuevo', en: 'Search again' },
  buscarDeNuevoTip: { es: 'Vuelve a buscar todos los discos (por ejemplo, después de cargar la clave de Discogs, o si cambiaste los tags)', en: 'Searches all the albums again (for example after adding your Discogs key, or if you changed the tags)' },
  mandarFaltan: { es: (c: string) => `Mandar los ${c} que faltan a la lista «Faltan o suenan mal»`, en: (c: string) => `Send the ${c} missing tracks to the "Missing or low quality" list` },
  mandarFaltanTip: { es: "Suma cada tema que falta a la lista «Faltan o suenan mal», con el motivo 'falta del disco'. Después lo exportás desde ahí.", en: "Adds each missing track to the \"Missing or low quality\" list, with the reason 'missing from the album'. You can export it from there." },
  irLista: { es: 'Ir a la lista «Faltan o suenan mal»', en: 'Go to the "Missing or low quality" list' },
  sumados: { es: (c: string) => `${c} temas sumados a la lista «Faltan o suenan mal» (motivo: falta del disco).`, en: (c: string) => `${c} tracks added to the "Missing or low quality" list (reason: missing from the album).` },
  yaEstaban: { es: 'Esos temas ya estaban en la lista «Faltan o suenan mal».', en: 'Those tracks were already on the "Missing or low quality" list.' },
  sinEstado: { es: 'No hay discos con ese estado.', en: 'No albums with that status.' },
  sinDiscos: { es: 'No se encontraron discos: hace falta que los temas tengan el álbum en el tag (podés completarlo en "Arreglar nombres y tags").', en: 'No albums found: the tracks need the album in their tag (you can fill it in under "Fix names and tags").' },
  repetidoTip: { es: 'El mismo tema del disco en dos archivos o más. Duplicados te ayuda a quedarte con el mejor.', en: 'The same album track in two or more files. Duplicates helps you keep the best one.' },
  repetido: { es: (c: number) => cant(c, 'repetido', 'repetidos'), en: (c: number) => cant(c, 'repeat', 'repeats') },
  temasDir: { es: (c: string, d: string) => `${c} temas · ${d}`, en: (c: string, d: string) => `${c} tracks · ${d}` },
  edicionDe: { es: 'Edición: ', en: 'Edition: ' },
  temasCoinciden: { es: (t: number, m: number) => ` · ${t} temas, coinciden ${m}`, en: (t: number, m: number) => ` · ${t} tracks, ${m} match` },
  porVos: { es: ' · elegida por vos', en: ' · picked by you' },
  existe: { es: (m: number) => `Existe una edición con ${m} tema${m > 1 ? 's' : ''} más (`, en: (m: number) => `There is an edition with ${m} more track${m > 1 ? 's' : ''} (` },
  existeFin: { es: '): con la que tenés, el disco está completo.', en: '): with the one you have, the album is complete.' },
  teFaltan: { es: 'Te faltan:', en: "You're missing:" },
  mandarlos: { es: 'Mandarlos a la lista «Faltan o suenan mal»', en: 'Send them to the "Missing or low quality" list' },
  repetidos: { es: 'Repetidos:', en: 'Repeated:' },
  archivos: { es: (c: number) => `(${c} archivos)`, en: (c: number) => `(${c} files)` },
  extraTip: { es: 'Archivos de la carpeta del disco que no están en esa edición: un tema extra de otra edición, o algo que no es de este disco.', en: "Files in the album's folder that aren't in that edition: an extra track from another edition, or something that isn't from this album." },
  noEstan: { es: 'No están en esta edición: ', en: "Not in this edition: " },
  ediciones: { es: 'Ediciones:', en: 'Editions:' },
  queElija: { es: 'Que elija PAILA', en: 'Let PAILA choose' },
  hayDudas: { es: ' (hay dudas)', en: ' (not sure)' },
  opcion: { es: (t: number, f: number) => ` · ${t} temas, te faltan ${f}`, en: (t: number, f: number) => ` · ${t} tracks, you're missing ${f}` },
  noRevisar: { es: 'No revisar este disco', en: "Don't review this album" },
  noRevisarTip: { es: 'Por ejemplo, si no es un disco de verdad o no te interesa completarlo: no se revisa más', en: "For example, if it isn't a real album or you don't care about completing it: it won't be reviewed again" },
  volverRevisar: { es: 'Volver a revisarlo', en: 'Review it again' },
})

const STATUS: Record<AlbumStatus, { label: string; pill: string; help: string }> = {
  elegir: { label: T.sEligirL, pill: 'pill-amber', help: T.sEligirH },
  faltan: { label: T.sFaltanL, pill: 'pill-blue', help: T.sFaltanH },
  no_encontrado: { label: T.sNoL, pill: '', help: T.sNoH },
  sin_buscar: { label: T.sSinL, pill: '', help: T.sSinH },
  completo: { label: T.sCompletoL, pill: 'pill-green', help: T.sCompletoH },
  ignorado: { label: T.sIgnoL, pill: '', help: T.sIgnoH },
}

export default function AlbumsComplete({ onGo }: { onGo: (p: PageKey) => void }) {
  const job = useJob('albums')
  const [sum, setSum] = useState<AlbumsSummary | null>(null)
  const [pending, setPending] = useState(0)
  const [filter, setFilter] = useState<AlbumStatus | 'todos'>('todos')
  const [open, setOpen] = useState<string | null>(null)
  const load = useCallback(() => {
    window.paila.albumsReport().then(setSum).catch((e) => toast(clean(e), 'error'))
    window.paila.albumsPending().then(setPending).catch(() => {})
  }, [])
  useEffect(() => { load() }, [load])
  const was = useRef(false)
  useEffect(() => { if (was.current && !job?.running) load(); was.current = !!job?.running }, [job?.running, load])

  const counts = useMemo(() => {
    const c = {} as Record<AlbumStatus, number>
    for (const r of sum?.reports ?? []) c[r.status] = (c[r.status] ?? 0) + 1
    return c
  }, [sum])
  const shown = (sum?.reports ?? []).filter((r) => filter === 'todos' || r.status === filter)
  const withMissing = (sum?.reports ?? []).filter((r) => r.status === 'faltan')
  const missingCount = withMissing.reduce((a, r) => a + r.missing.length, 0)

  const run = (retry = false) => window.paila.albumsRun(retry).catch((e) => toast(clean(e), 'error'))
  const choose = async (r: AlbumReport, choice: string | null) => { try { setSum(await window.paila.albumsChoose(r.key, choice)) } catch (e) { toast(clean(e), 'error') } }
  const toWanted = async (keys: string[]) => {
    try {
      const added = await window.paila.albumsToWanted(keys)
      toast(added ? T.sumados(n(added)) : T.yaEstaban)
    } catch (e) { toast(clean(e), 'error') }
  }

  return (<>
    <p className="muted small">
      <Rico texto={T.intro(sum?.deezer !== false, !!sum?.discogs)} />
      <span className="info" title={T.edicion}> ⓘ</span>
    </p>
    {sum && !job?.running && (
      <div className="callout">
        <Rico texto={T.paraRevisar(n(sum.reports.length))} />
        {sum.skipped ? <span className="muted small" title={T.noSeRevisanTip}>{T.noSeRevisan(n(sum.skipped))}</span> : null}
        {pending > 0 && <><Rico texto={T.faltanBuscar(n(pending))} /><span className="muted small">{T.cerca(Math.max(1, Math.round(pending * 4 / 60)))}</span></>}
        <div className="row" style={{ marginTop: 6 }}>
          {(Object.keys(STATUS) as AlbumStatus[]).filter((s) => counts[s]).map((s) => (
            <button key={s} className={`pill ${STATUS[s].pill} ${filter === s ? 'on' : ''}`} style={{ marginLeft: 0, cursor: 'pointer', border: 0 }} title={STATUS[s].help} onClick={() => setFilter(filter === s ? 'todos' : s)}>
              {STATUS[s].label}: {n(counts[s])}
            </button>
          ))}
        </div>
      </div>
    )}
    {job && <JobPanel job={job} unit={T.unidad} onDismiss={() => window.paila.dismissJob('albums')}>{job.running && <Boton variant="ghost" size="sm" disabled={job.cancelling} onClick={() => window.paila.cancelJob('albums')}>{T.cancelar}</Boton>}</JobPanel>}
    <div className="row">
      {(job?.running || pending > 0) && <Boton disabled={!!job?.running || !sum} onClick={() => run(false)}>{job?.running ? T.buscando : pending < (sum?.reports.length ?? 0) ? T.seguir(n(pending)) : T.buscarListas}</Boton>}
      {sum && pending < sum.reports.length && <Boton variant="ghost" disabled={!!job?.running} onClick={() => run(true)} title={T.buscarDeNuevoTip}>{T.buscarDeNuevo}</Boton>}
      {missingCount > 0 && <Boton variant="ghost" onClick={() => toWanted(withMissing.map((r) => r.key))} title={T.mandarFaltanTip}>{T.mandarFaltan(n(missingCount))}</Boton>}
      <button className="link small" onClick={() => onGo('wishlist')}>{T.irLista}</button>
    </div>
    {sum && shown.length === 0 && <p className="muted">{sum.reports.length ? T.sinEstado : T.sinDiscos}</p>}
    {shown.length > 0 && <div className="lista-filas">{shown.map((r) => <AlbumBox key={`${r.key}|${r.dir}`} r={r} open={open === `${r.key}|${r.dir}`} onToggle={() => setOpen(open === `${r.key}|${r.dir}` ? null : `${r.key}|${r.dir}`)} onChoose={(c) => choose(r, c)} onWanted={() => toWanted([r.key])} />)}</div>}
  </>)
}

function AlbumBox({ r, open, onToggle, onChoose, onWanted }: { r: AlbumReport; open: boolean; onToggle: () => void; onChoose: (c: string | null) => void; onWanted: () => void }) {
  const e = r.edition
  const st = STATUS[r.status]
  return (
    <div className={`box ${r.status === 'ignorado' ? 'skipped' : ''}`}>
      <div className="box-head" onClick={onToggle} {...conTeclado(onToggle)} style={{ cursor: 'pointer' }}>
        <b>{r.artist}</b><span> — {r.album}</span>{r.year && <span className="muted small"> ({r.year})</span>}
        <span className={`pill ${st.pill}`} title={st.help}>{st.label}{r.status === 'faltan' ? ` (${r.missing.length})` : ''}</span>
        {r.repeated.length > 0 && <Pildora tone="atencion" title={T.repetidoTip}>{T.repetido(r.repeated.length)}</Pildora>}
        <span className="muted small push-right">{T.temasDir(n(r.tracks), r.dir)}</span>
      </div>
      {open && (
        <div className="box-row" style={{ gridTemplateColumns: '1fr', cursor: 'default' }}>
          {e && <span className="small">
            {T.edicionDe}<b>{e.title}</b>{e.note ? ` · ${e.note}` : ''} · {[e.date, e.country, e.format].filter(Boolean).join(' · ')}{T.temasCoinciden(e.tracks, e.matched)}
            {r.manual ? T.porVos : ''} <span className="muted">({e.source === 'discogs' ? 'Discogs' : e.source === 'deezer' ? 'Deezer' : 'MusicBrainz'})</span>
          </span>}
          {r.bigger && <span className="muted small">{T.existe(r.bigger.more)}{r.bigger.edition.title}{r.bigger.edition.note ? `, ${r.bigger.edition.note}` : ''}{r.bigger.edition.country ? `, ${r.bigger.edition.country}` : ''}{T.existeFin}</span>}
          {r.missing.length > 0 && <div className="small">
            <b>{T.teFaltan}</b>
            {/* idioma-ok */}
            <ol className="album-missing">{r.missing.map((m) => <li key={`${m.disc}-${m.pos}`} value={m.pos}>{m.disc > 1 ? `CD${m.disc} · ` : ''}{m.title}{m.artist && m.artist !== r.artist ? ` (${m.artist})` : ''}{m.length ? <span className="muted"> · {duration(m.length)}</span> : null}</li>)}</ol>
            <Boton variant="ghost" size="sm" onClick={onWanted}>{T.mandarlos}</Boton>
          </div>}
          {r.repeated.length > 0 && <div className="small"><b>{T.repetidos}</b> {r.repeated.map((x) => `${x.title} ${T.archivos(x.files.length)}`).join(' · ')}</div>}
          {r.extra.length > 0 && <div className="small muted" title={T.extraTip}>{T.noEstan}{r.extra.map((x) => x.split('/').pop()).join(' · ')} ⓘ</div>}
          {r.options.length > 1 && <div className="small">
            <b>{T.ediciones}</b> <Info tip={T.edicion} />
            <select value={r.manual && e ? e.ref : ''} onChange={(ev) => onChoose(ev.target.value || null)} style={{ marginLeft: 8 }}>
              <option value="">{T.queElija}{r.status === 'elegir' ? T.hayDudas : ''}</option>
              {r.options.map((o) => <option key={o.ref} value={o.ref}>{o.title}{o.note ? ` (${o.note})` : ''} · {[o.date?.slice(0, 4), o.country, o.format].filter(Boolean).join(' · ')}{T.opcion(o.tracks, o.missing)}</option>)}
            </select>
          </div>}
          <div className="row">
            {r.status !== 'ignorado'
              ? <button className="link small" onClick={() => onChoose('ignorar')} title={T.noRevisarTip}>{T.noRevisar}</button>
              : <button className="link small" onClick={() => onChoose(null)}>{T.volverRevisar}</button>}
          </div>
        </div>
      )}
    </div>
  )
}
