// El pie de la barra lateral: Historial, Papelera y Configuración con su nombre, y tus discos en renglones ("el autor SSD · F:",
// conectado o no). Tocar un disco abre un menú que dice cuál es y qué se puede hacer: ajustar qué hay en esa carpeta, abrirla en
// el Explorador y, si es externo, expulsarlo sin riesgo (ipc/discos.ts). Antes eran íconos sueltos: el de Configuración parecía
// el brillo y los discos no decían cuál era cuál ni dejaban desconectarlos (el autor, 01/11).
import { useEffect, useRef, useState } from 'react'
import type { RootInfo } from '@paila/shared/types'
import type { DiscoRaiz } from '@paila/shared/types/api-discos'
import { Boton } from '@paila/diseno'
import { textos } from '@paila/shared/idioma'
import { Icon } from './icons'
import { bytes } from './format'
import { toast } from './toast'

const T = textos({
  discos: { es: 'Tus discos', en: 'Your disks' },
  conectado: { es: 'conectado', en: 'connected' },
  noConectado: { es: 'no conectado', en: 'not connected' },
  libre: { es: (l: string, t: string) => `${l} libres de ${t}`, en: (l: string, t: string) => `${l} free of ${t}` },
  sinConectar: { es: 'No está conectado: tus datos (análisis, playlists, cambios) quedan guardados y vuelven cuando lo conectes.', en: "It isn't connected: your data (analysis, playlists, changes) stays saved and comes back when you plug it in." },
  ajustar: { es: 'Ajustar qué hay en esta carpeta', en: 'Adjust what is in this folder' },
  ajustarTip: { es: 'Qué subcarpetas son Música, Producción, Sets o se dejan afuera', en: 'Which subfolders are Music, Production, Sets or left out' },
  abrir: { es: 'Abrir en el Explorador', en: 'Open in File Explorer' },
  expulsar: { es: 'Expulsar el disco', en: 'Eject the disk' },
  expulsarTip: { es: 'Pausa el análisis, espera que nada lo esté usando y lo expulsa: después lo podés desconectar sin riesgo', en: 'Pauses the analysis, waits until nothing is using it and ejects it: then you can unplug it safely' },
  expulsando: { es: 'Expulsando…', en: 'Ejecting…' },
  externo: { es: 'externo', en: 'external' },
  agregar: { es: 'Agregar otra carpeta', en: 'Add another folder' },
  cerrar: { es: 'Cerrar', en: 'Close' },
})

export function DiscosPie({ roots, onAdjust, onAddFolder }: { roots: RootInfo[]; onAdjust: (r: RootInfo) => void; onAddFolder: () => void }) {
  const [discos, setDiscos] = useState<DiscoRaiz[]>([])
  const [abierto, setAbierto] = useState<number | null>(null)
  const [expulsando, setExpulsando] = useState(false)
  const caja = useRef<HTMLDivElement>(null)
  // cuando un disco se conecta o se desconecta (roots cambia), se vuelve a preguntar cómo está cada uno
  const clave = roots.map((r) => `${r.id}:${r.available}`).join()
  useEffect(() => { void window.paila.discos().then(setDiscos).catch(() => {}) }, [clave])
  // el menú se cierra al tocar afuera
  useEffect(() => {
    if (abierto == null) return
    const f = (e: MouseEvent) => { if (!caja.current?.contains(e.target as Node)) setAbierto(null) }
    window.addEventListener('mousedown', f)
    return () => window.removeEventListener('mousedown', f)
  }, [abierto])

  const expulsar = async (d: DiscoRaiz) => {
    setExpulsando(true)
    try { const r = await window.paila.expulsarDisco(d.rootId); toast(r.mensaje, r.ok ? 'ok' : 'error'); if (r.ok) setAbierto(null) } finally { setExpulsando(false) }
  }
  const sel = discos.find((d) => d.rootId === abierto)
  const root = roots.find((r) => r.id === abierto)

  return (
    <div className="pie-discos" ref={caja}>
      <div className="pie-rotulo">{T.discos}</div>
      {roots.map((r) => {
        const d = discos.find((x) => x.rootId === r.id)
        return (
          <button key={r.id} type="button" className={`pie-disco${abierto === r.id ? ' on' : ''}${r.available ? '' : ' off'}`} aria-expanded={abierto === r.id} onClick={() => setAbierto(abierto === r.id ? null : r.id)} title={r.path}>
            <Icon name={d?.externo ? 'usb' : 'hdd'} size={15} />
            <span className="pie-disco-nombre ellipsis">{d?.nombre ?? r.volumeLabel ?? r.path}</span>
            {d?.letra && <span className="pie-disco-letra num">{d.letra}</span>}
            <i className={`status ${r.available ? 'ok' : 'off'}`} title={r.available ? T.conectado : T.noConectado} />
          </button>
        )
      })}
      <button type="button" className="pie-disco pie-agregar" onClick={onAddFolder}><Icon name="plus" size={15} /><span>{T.agregar}</span></button>

      {sel && root && (
        <div className="pie-menu" role="dialog" aria-label={sel.nombre}>
          <button type="button" className="close" onClick={() => setAbierto(null)} title={T.cerrar}><Icon name="close" size={13} /></button>
          <b>{sel.nombre}{sel.letra ? ` (${sel.letra})` : ''}</b>
          <div className="pie-menu-ruta num small">{sel.carpeta}</div>
          <div className="small muted">
            {sel.conectado ? <>{T.conectado}{sel.externo ? ` · ${T.externo}` : ''}{sel.libre != null && sel.total != null ? ` · ${T.libre(bytes(sel.libre), bytes(sel.total))}` : ''}</> : T.sinConectar}
          </div>
          <div className="pie-menu-acciones">
            <Boton size="sm" variant="ghost" title={T.ajustarTip} disabled={!sel.conectado} onClick={() => { setAbierto(null); onAdjust(root) }}>{T.ajustar}</Boton>
            {sel.conectado && <Boton size="sm" variant="ghost" onClick={() => void window.paila.openFolder(sel.carpeta)}>{T.abrir}</Boton>}
            {sel.conectado && sel.externo && <Boton size="sm" variant="ghost" title={T.expulsarTip} disabled={expulsando} onClick={() => void expulsar(sel)}><Icon name="eject" size={13} /> {expulsando ? T.expulsando : T.expulsar}</Boton>}
          </div>
        </div>
      )}
    </div>
  )
}
