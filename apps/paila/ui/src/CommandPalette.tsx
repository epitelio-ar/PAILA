// Buscador de comandos (atajo de teclado): saltar a una pantalla o playlist, o iniciar un escaneo sin usar el mouse.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PlaylistNode } from '@paila/shared/types'
import { Icon, type IconName } from './icons'
import { ponerCabina, leerCabina, leerEstilo, ponerEstilo } from '@paila/diseno'
import { compartirEstilo } from './EstiloChooser'
import { verRecorrido } from './Recorrido'
import { useProfile } from './profile'
import { DJ_TOOLS_HELP } from '@paila/shared/profile'
import { CONFIG_SECCIONES, irASeccion, NAV_AVANZADO, NAV_GROUPS, NAV_HISTORY, NAV_PLAYLISTS, NAV_SETTINGS, NAV_TOP, NAV_TRASH, type PageKey } from './nav'
import { leerAvanzado, ponerAvanzado } from './avanzado'
import { textos, cant } from '@paila/shared/idioma'
import { buscarComandos } from './palette-buscar'

const T = textos({
  playlistN: { es: (n: number) => `Playlist · ${cant(n, 'tema', 'temas')}`, en: (n: number) => `Playlist · ${cant(n, 'track', 'tracks')}` },
  escanear: { es: 'Escanear cambios', en: 'Scan for changes' },
  escanearHint: { es: 'Busca archivos nuevos, modificados o borrados', en: 'Looks for new, changed or deleted files' },
  cabinaOff: { es: 'Apagar el modo cabina', en: 'Turn off Booth mode' },
  cabinaOn: { es: 'Prender el modo cabina', en: 'Turn on Booth mode' },
  cabinaHint: { es: 'Alto contraste y letra más grande, para leer de lejos o con poca luz (Ctrl+Mayús+C)', en: 'High contrast and bigger letters, to read from far away or in low light (Ctrl+Shift+C)' },
  haciaSobrio: { es: 'Pasar al estilo sobrio', en: 'Switch to the Studio style' },
  haciaHistorieta: { es: 'Pasar al estilo historieta', en: 'Switch to the Comic style' },
  estiloHint: { es: 'Cómo se ve PAILA (y NAPIA): sobrio o historieta. Los dos son oscuros', en: 'How PAILA (and NAPIA) look: studio or comic. Both are dark' },
  djOff: { es: 'Apagar las herramientas para DJ y producción', en: 'Turn off the DJ and production tools' },
  djOn: { es: 'Prender las herramientas para DJ y producción', en: 'Turn on the DJ and production tools' },
  avOff: { es: 'Apagar el modo avanzado', en: 'Turn off Advanced mode' },
  avOn: { es: 'Prender el modo avanzado', en: 'Turn on Advanced mode' },
  avHint: { es: 'Muestra el inspector de un tema, la cola del análisis, el registro de operaciones y el muestrario de diseño. No cambia cómo trabaja PAILA', en: "Shows the track inspector, the analysis queue, the operations log and the design gallery. It doesn't change how PAILA works" },
  modoAv: { es: (h: string) => `Modo avanzado · ${h}`, en: (h: string) => `Advanced mode · ${h}` },
  reanalizar: { es: 'Reanalizar el tema elegido', en: 'Re-analyze the selected track' },
  reanalizarHint: { es: 'Modo avanzado · vuelve a analizar el tema que tenés elegido (calidad, BPM, tono y huellas); no toca el archivo', en: "Advanced mode · analyzes the track you've selected again (quality, BPM, key and fingerprints); the file isn't touched" },
  recorrido: { es: 'Ver el recorrido', en: 'Take the tour' },
  recorridoHint: { es: 'La oreja te muestra, paso a paso, lo que podés hacer con tu música', en: 'PAILA shows you, step by step, what you can do with your music' },
  placeholder: { es: 'Ir a… (pantallas, playlists, ajustes, acciones)', en: 'Go to… (screens, playlists, settings, actions)' },
  enConfig: { es: (h: string) => `Configuración · ${h}`, en: (h: string) => `Settings · ${h}` },
  nada: { es: 'No encontré nada con eso.', en: "I couldn't find anything for that." },
})

interface Cmd { id: string; label: string; hint: string; icon: IconName; run: () => void }

/** Buscador de todo (Ctrl+K): saltar a una pantalla, a una playlist o hacer una acción escribiendo. */
export default function CommandPalette({ playlists, scanning, onPage, onPlaylist, onScan, onClose, onReanalyze }: {
  playlists: PlaylistNode[]; scanning: boolean
  /** Reanalizar el tema que está elegido en la biblioteca (modo avanzado); sin tema elegido no se ofrece. */
  onReanalyze?: () => void
  onPage: (p: PageKey) => void; onPlaylist: (id: number) => void; onScan: () => void; onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const { djTools, setDjTools } = useProfile()

  const all = useMemo<Cmd[]>(() => {
    const pages = [...NAV_TOP, ...NAV_GROUPS.flatMap((g) => g.items), NAV_PLAYLISTS, NAV_HISTORY, NAV_TRASH, NAV_SETTINGS].map((it): Cmd => ({ id: it.page, label: it.label, hint: it.help, icon: it.icon, run: () => onPage(it.page) }))
    const lists = playlists.filter((p) => p.kind !== 'folder').map((p): Cmd => ({ id: `pl${p.id}`, label: p.name, hint: T.playlistN(p.count), icon: 'list', run: () => onPlaylist(p.id) }))
    const acts: Cmd[] = scanning ? [] : [{ id: 'scan', label: T.escanear, hint: T.escanearHint, icon: 'search', run: onScan }]
    const on = leerCabina()
    acts.push({ id: 'cabina', label: on ? T.cabinaOff : T.cabinaOn, hint: T.cabinaHint, icon: 'headphones', run: () => ponerCabina(!on) })
    const hist = leerEstilo() === 'historieta'
    acts.push({ id: 'estilo', label: hist ? T.haciaSobrio : T.haciaHistorieta, hint: T.estiloHint, icon: 'sparkle', run: () => ponerEstilo(hist ? 'actual' : 'historieta', compartirEstilo) })
    acts.push({ id: 'djtools', label: djTools ? T.djOff : T.djOn, hint: DJ_TOOLS_HELP, icon: 'headphones', run: () => { void setDjTools(!djTools) } })
    const adv = leerAvanzado()
    acts.push({ id: 'avanzado', label: adv ? T.avOff : T.avOn, hint: T.avHint, icon: 'gear', run: () => ponerAvanzado(!adv) })
    if (adv) {
      acts.push(...NAV_AVANZADO.map((it): Cmd => ({ id: it.page, label: it.label, hint: T.modoAv(it.help), icon: it.icon, run: () => onPage(it.page) })))
      if (onReanalyze) acts.push({ id: 'reanalizar', label: T.reanalizar, hint: T.reanalizarHint, icon: 'activity', run: onReanalyze })
    }
    acts.push({ id: 'recorrido', label: T.recorrido, hint: T.recorridoHint, icon: 'sparkle', run: verRecorrido })
    // cada sección de Configuración, para llegar escribiendo "idioma", "respaldos" o "otra compu"
    const config = CONFIG_SECCIONES.filter((x) => !x.soloDj || djTools).map((x): Cmd => ({ id: x.id, label: x.label, hint: T.enConfig(x.help), icon: 'gear', run: () => irASeccion(x.id, () => onPage('settings')) }))
    return [...acts, ...pages, ...config, ...lists]
  }, [playlists, scanning, onPage, onPlaylist, onScan, onReanalyze, djTools, setDjTools])

  const shown = useMemo(() => buscarComandos(all, q), [all, q])

  useEffect(() => setSel(0), [q])
  useEffect(() => { list.current?.querySelector('.cmd.on')?.scrollIntoView({ block: 'nearest' }) }, [sel])
  const go = (c?: Cmd) => { if (c) { onClose(); c.run() } }

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <Icon name="search" size={16} />
          <input autoFocus placeholder={T.placeholder} value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
              else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(shown.length - 1, s + 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)) }
              else if (e.key === 'Enter') go(shown[sel])
            }} />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-list" ref={list}>
          {shown.map((c, i) => (
            <button key={c.id} className={`cmd ${i === sel ? 'on' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => go(c)}>
              <Icon name={c.icon} size={16} /><span className="cmd-label">{c.label}</span><span className="muted small cmd-hint">{c.hint}</span>
            </button>
          ))}
          {!shown.length && <div className="muted" style={{ padding: 16 }}>{T.nada}</div>}
        </div>
      </div>
    </div>
  )
}
