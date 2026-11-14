// Pestaña "Tapas": busca una tapa en buena resolución para cada disco y muestra la de hoy al lado de la nueva para elegir.
// Lo tildado va a Cambios pendientes (la tapa dentro de cada tema y el cover.jpg de la carpeta); de ahí se aplica y se deshace.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CoverProposal } from '@paila/shared/types'
import { JobPanel, useJob } from './jobs'
import { bytes, n } from './format'
import { toast } from './toast'
import { Boton, Info, Rico } from '@paila/diseno'
import { textos } from '@paila/shared/idioma'

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
const T = textos({
  res: { es: 'La resolución es el tamaño de la imagen en puntos (píxeles). Una tapa de 1000×1000 o más se ve nítida en una pantalla grande o en un equipo con pantalla; una de 300×300 se ve borrosa. PAILA nunca cambia una tapa por otra más chica.', en: 'Resolution is the size of the image in dots (pixels). A cover of 1000×1000 or more looks sharp on a big screen or on gear with a display; a 300×300 one looks blurry. PAILA never swaps a cover for a smaller one.' },
  win: { es: 'El Reproductor de Windows Media dejaba en cada carpeta un Folder.jpg oculto con la tapa en 200×200. El Explorador de Windows y algunos reproductores lo usan primero: se cambia por la tapa buena (el de antes queda guardado y se puede deshacer).', en: 'Windows Media Player used to leave a hidden Folder.jpg in every folder with the cover at 200×200. Windows Explorer and some players use it first: it gets replaced with the good cover (the old one is kept and you can undo).' },
  folder: { es: 'Muchos reproductores, televisores y servidores caseros (Plex, Jellyfin, Navidrome, foobar2000, Kodi) buscan la tapa en un archivo cover.jpg dentro de la carpeta del disco.', en: "Many players, TVs and home servers (Plex, Jellyfin, Navidrome, foobar2000, Kodi) look for the cover in a cover.jpg file inside the album's folder." },
  intro: {
    es: 'Una tapa en buena resolución para cada disco {res}: de **Cover Art Archive** (la de la edición exacta, si se encontró en Discos completos), **Deezer** o **iTunes**. Va dentro de cada tema y también como **cover.jpg** en la carpeta del disco {carpeta}. Solo se envía el artista y el nombre del disco. Nada se escribe hasta que apretás Aplicar, arriba. Lo encontrado queda guardado: salís y volvés, y sigue acá.',
    en: 'A good-resolution cover for each album {res}: from **Cover Art Archive** (the exact edition\'s cover, if it was found in Complete albums), **Deezer** or **iTunes**. It goes inside each track and also as **cover.jpg** in the album\'s folder {carpeta}. Only the artist and the album name are sent. Nothing is written until you press Apply, at the top. What it finds is kept: you leave and come back, and it is still here.',
  },
  cancelar: { es: 'Cancelar', en: 'Cancel' },
  unidad: { es: 'discos', en: 'albums' },
  buscando: { es: 'Buscando…', en: 'Searching…' },
  buscarDeNuevo: { es: 'Buscar de nuevo', en: 'Search again' },
  buscar: { es: 'Buscar tapas', en: 'Look for covers' },
  proponer: { es: (c: string) => `Sumar las ${c} tildadas a lo que vas a aplicar`, en: (c: string) => `Add the ${c} checked to what you are going to apply` },
  puesta: { es: 'Ya se puso', en: 'Already put in' },
  dejar: { es: 'Dejar como está', en: 'Leave as is' },
  dejarTip: { es: 'Este disco se queda con la tapa que tiene: no vuelve a aparecer ni a contar.', en: "This album keeps the cover it has: it won't show up or count again." },
  mostrarTodos: { es: (c: string) => ` Mostrar también los discos que no cambian (${c})`, en: (c: string) => ` Also show the albums that don't change (${c})` },
  ninguno: { es: (hay: boolean): string => (hay ? 'Encontró tapas, pero ninguna mejora la que ya tienen: no hay nada para aplicar.' : 'Ningún disco necesita una tapa nueva.'), en: (hay: boolean): string => (hay ? 'It found covers, but none beats the one they already have: nothing to apply.' : 'No album needs a new cover.') },
  quedaron: { es: (t: string, f: string) => `Quedaron para aplicar: la tapa de ${t} temas y ${f} cover.jpg. Se ponen cuando apretás Aplicar, arriba (después de mover, si hay algo para mover); se puede deshacer desde el Historial.`, en: (t: string, f: string) => `Ready to apply: the cover of ${t} tracks and ${f} cover.jpg files. They go in when you press Apply, at the top (after moving, if anything moves); you can undo from History.` },
  tapaNueva: { es: 'Tapa nueva', en: 'New cover' },
  tapaHoy: { es: 'Tapa de hoy', en: "Today's cover" },
  enTemas: { es: (e: number, t: number) => `En ${e} de ${t} tema${t > 1 ? 's' : ''}`, en: (e: number, t: number) => `In ${e} of ${t} track${t > 1 ? 's' : ''}` },
  yWindows: { es: ' (y el Folder.jpg de Windows) ⓘ', en: ' (and the Windows Folder.jpg) ⓘ' },
  sinTapaN: { es: (c: number) => `${c} sin tapa`, en: (c: number) => `${c} without a cover` },
  sinTapa: { es: 'Sin tapa', en: 'No cover' },
  hoy: { es: 'hoy', en: 'today' },
  yaPropuesta: { es: 'Ya está para aplicar', en: 'Already waiting to be applied' },
  yaTodas: { es: (c: string) => `Las tapas de ${c} discos ya están para aplicar: se ponen cuando apretás Aplicar, arriba. Buscar de nuevo vuelve a mirar todo.`, en: (c: string) => `The covers of ${c} albums are already waiting to be applied: they go in when you press Apply, at the top. Search again looks at everything again.` },
  hoySin: { es: (c: number) => `hoy (${c} sin tapa)`, en: (c: number) => `today (${c} without a cover)` },
})

export default function AlbumsCovers({ onStaged }: { onStaged: () => void }) {
  const job = useJob('covers')
  const [props, setProps] = useState<CoverProposal[] | null>(null)
  const [skip, setSkip] = useState<Set<string>>(new Set())
  const [showAll, setShowAll] = useState(false)
  useEffect(() => { window.paila.coversLast().then(setProps).catch(() => {}) }, [])
  const was = useRef(false)
  useEffect(() => { if (was.current && !job?.running) window.paila.coversLast().then(setProps); was.current = !!job?.running }, [job?.running])

  const withNew = useMemo(() => (props ?? []).filter((p) => p.proposed && !p.staged && !p.puesta), [props])
  const staged = (props ?? []).filter((p) => p.staged).length
  const chosen = withNew.filter((p) => !skip.has(p.key))
  const shown = showAll ? props ?? [] : withNew
  const scan = () => window.paila.coversScan().catch((e) => toast(clean(e), 'error'))
  // "Dejar como está": el disco se queda con su tapa, no vuelve a aparecer ni a contar (core/estado-dejar.ts)
  const dejar = async (ids: number[]) => { await window.paila.dejarComoEsta('tapas', ids); setProps(await window.paila.coversLast()) }
  const stage = async () => {
    try {
      const r = await window.paila.coversStage(chosen.map((p) => p.key))
      onStaged()
      toast(T.quedaron(n(r.tracks), n(r.folders)))
      setProps(await window.paila.coversLast()) // lo propuesto ya no se ofrece de nuevo
    } catch (e) { toast(clean(e), 'error') }
  }

  return (<>
    <p className="muted small">
      <Rico texto={T.intro} partes={{ res: <Info tip={T.res} />, carpeta: <Info tip={T.folder} /> }} />
    </p>
    {job && <JobPanel job={job} unit={T.unidad} onDismiss={() => window.paila.dismissJob('covers')}>{job.running && <Boton variant="ghost" size="sm" disabled={job.cancelling} onClick={() => window.paila.cancelJob('covers')}>{T.cancelar}</Boton>}</JobPanel>}
    <div className="row">
      <Boton disabled={!!job?.running} onClick={scan}>{job?.running ? T.buscando : props ? T.buscarDeNuevo : T.buscar}</Boton>
      {chosen.length > 0 && <Boton onClick={stage}>{T.proponer(n(chosen.length))}</Boton>}
      {props && <label className="small"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />{T.mostrarTodos(n(props.length - withNew.length))}</label>}
    </div>
    {props && !withNew.length && <p className="muted">{staged ? T.yaTodas(n(staged)) : T.ninguno(props.length > 0)}</p>}
    <div className="cover-grid">
      {shown.map((p) => (
        <label key={`${p.key}|${p.dir}`} className={`cover-card ${p.proposed && !p.staged && !skip.has(p.key) ? 'on' : ''}`} title={p.dir}>
          <div className="cover-pair">
            <Current p={p} />
            {p.proposed && <><span className="cover-arrow">→</span><figure><img src={`paila://tapa/${p.proposed.sha}`} alt={T.tapaNueva} /><figcaption>{p.proposed.width}×{p.proposed.height} · {bytes(p.proposed.bytes)}<br />{p.proposed.source}</figcaption></figure></>}
          </div>
          <div className="small"><b>{p.artist}</b> — {p.album}</div>
          {p.proposed && !p.staged
            ? <div className="small muted">
                <input type="checkbox" checked={!skip.has(p.key)} onChange={(e) => { const s = new Set(skip); if (e.target.checked) s.delete(p.key); else s.add(p.key); setSkip(s) }} />{' '}
                {T.enTemas(p.embed, p.tracks)}{p.folderFile ? ' + cover.jpg' : ''}{p.windowsFolder ? <span title={T.win}>{T.yWindows}</span> : null}
              </div>
            : <div className="small muted">{p.staged ? T.yaPropuesta : p.puesta ? T.puesta : p.why}</div>}
          {p.proposed && !p.staged && !p.puesta && !!p.ids?.length && <button className="link small" title={T.dejarTip} onClick={(e) => { e.preventDefault(); void dejar(p.ids!) }}>{T.dejar}</button>}
        </label>
      ))}
    </div>
  </>)
}

/** La tapa de hoy (la del tema con la tapa más chica) o lo que falta. */
function Current({ p }: { p: CoverProposal }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => { if (p.current) window.paila.getCover(p.current.trackId).then(setSrc).catch(() => {}) }, [p.current])
  if (!p.current) return <figure><div className="cover-none">{p.without ? T.sinTapaN(p.without) : T.sinTapa}</div><figcaption>{p.folder ? `${p.folder.name}: ${p.folder.width}×${p.folder.height}` : T.hoy}</figcaption></figure>
  return <figure>{src ? <img src={src} alt={T.tapaHoy} /> : <div className="cover-none" />}<figcaption>{p.current.width}×{p.current.height}<br />{p.without ? T.hoySin(p.without) : T.hoy}</figcaption></figure>
}
