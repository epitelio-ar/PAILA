// El mapa único de atajos de teclado de PAILA: lo que muestra la ayuda (Ctrl+/ o ?). Si se agrega un atajo, se anota acá.
// También el atajo "G + letra" para ir a una pantalla (como en Gmail o GitHub): apagado de fábrica (decisión
// del 22/10), se prende en Configuración → Pantalla y queda guardado en esta PC.
import { tr } from '@paila/shared/idioma'
import { useEffect, useRef, useState } from 'react'
import { teclas } from '@paila/shared/teclas'
import type { PageKey } from './nav'

export interface Atajo { teclas: string; hace: string }

/** G y después la letra: a qué pantalla va. Las letras son las mismas en castellano y en inglés (decisión del autor, 24/10:
 * se aprenden una vez y sirven igual con cualquier idioma); los nombres sí se traducen, y la ayuda de Ctrl+/ los muestra. */
export const IR_A: { tecla: string; page: PageKey; nombre: string }[] = [
  { tecla: 'I', page: 'home', nombre: tr({ es: 'Inicio', en: 'Home' }) },
  { tecla: 'B', page: 'library', nombre: tr({ es: 'Biblioteca', en: 'Library' }) },
  { tecla: 'E', page: 'escuchando', nombre: tr({ es: 'Escuchando', en: 'Now playing' }) },
  { tecla: 'P', page: 'problemas', nombre: tr({ es: 'Centro de problemas', en: 'Problem center' }) },
  { tecla: 'A', page: 'progress', nombre: tr({ es: 'Análisis', en: 'Analysis' }) },
  { tecla: 'C', page: 'stats', nombre: tr({ es: 'Estadísticas', en: 'Stats' }) },
  { tecla: 'N', page: 'tidy', nombre: tr({ es: 'Arreglar nombres y tags', en: 'Fix names and tags' }) },
  { tecla: 'D', page: 'dups', nombre: tr({ es: 'Duplicados', en: 'Duplicates' }) },
  { tecla: 'O', page: 'organize', nombre: tr({ es: 'Organizar carpetas', en: 'Organize folders' }) },
  { tecla: 'L', page: 'wishlist', nombre: tr({ es: 'Faltan o suenan mal', en: 'Missing or low quality' }) },
  { tecla: 'T', page: 'inbox', nombre: tr({ es: 'Bandeja', en: 'Inbox' }) },
  { tecla: 'R', page: 'rekordbox', nombre: tr({ es: 'Programas de DJ', en: 'DJ software' }) },
  { tecla: 'H', page: 'history', nombre: tr({ es: 'Historial', en: 'History' }) },
  { tecla: 'S', page: 'settings', nombre: tr({ es: 'Configuración', en: 'Settings' }) },
]

const KEY = 'paila.atajoG'
const ev = 'paila-atajo-g'
export function leerAtajoG(): boolean { try { return localStorage.getItem(KEY) === '1' } catch { return false } }
export function ponerAtajoG(on: boolean) {
  try { localStorage.setItem(KEY, on ? '1' : '0') } catch { /* sin almacenamiento: vale hasta cerrar */ }
  window.dispatchEvent(new CustomEvent(ev))
}
/** Si el atajo "G + letra" está prendido (se actualiza al cambiarlo). */
export function useAtajoG(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(leerAtajoG)
  useEffect(() => { const f = () => setOn(leerAtajoG()); window.addEventListener(ev, f); return () => window.removeEventListener(ev, f) }, [])
  return [on, ponerAtajoG]
}

/**
 * Escucha "G + letra" en toda la ventana (si está prendido y no se está escribiendo en un campo). La G espera la letra
 * 1,5 segundos. Va en la fase de captura y frena la tecla: así la letra no dispara además otro atajo (la S del aleatorio).
 */
export function useIrA(onGo: (page: PageKey) => void) {
  const go = useRef(onGo)
  go.current = onGo
  useEffect(() => {
    let armado = 0
    const onKey = (e: KeyboardEvent) => {
      if (!leerAtajoG() || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      const k = e.key.toUpperCase()
      if (armado && Date.now() - armado < 1500) {
        armado = 0
        const ir = IR_A.find((x) => x.tecla === k)
        if (ir) { e.preventDefault(); e.stopPropagation(); go.current(ir.page) }
        return
      }
      if (k === 'G' && !e.shiftKey) { armado = Date.now(); e.preventDefault(); e.stopPropagation() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}

/** Los atajos para la ayuda (en Mac, con Cmd: `teclas`). */
export const ATAJOS: { grupo: string; items: Atajo[] }[] = ([
  {
    grupo: tr({ es: 'En toda la app', en: 'Anywhere in the app' }),
    items: [
      { teclas: 'Ctrl+K', hace: tr({ es: 'Ir a cualquier pantalla, playlist o ajuste', en: 'Go to any screen, playlist or setting' }) },
      { teclas: 'Ctrl+/  ·  ?', hace: tr({ es: 'Ver esta ayuda', en: 'Show this help' }) },
      { teclas: tr({ es: 'Ctrl+Mayús+C', en: 'Ctrl+Shift+C' }), hace: tr({ es: 'Modo cabina (letra grande y alto contraste)', en: 'Booth mode (big text and high contrast)' }) },
      { teclas: tr({ es: 'Ctrl+Mayús+N', en: 'Ctrl+Shift+N' }), hace: tr({ es: 'Anotar qué te resultó raro o confuso (con captura)', en: 'Note what felt odd or confusing (with a screenshot)' }) },
      { teclas: 'Esc', hace: tr({ es: 'Cerrar la ventana o la ficha', en: 'Close the window or the track details' }) },
    ],
  },
  {
    grupo: tr({ es: 'En la tabla de temas', en: 'In the track table' }),
    items: [
      { teclas: '↑  ↓', hace: tr({ es: 'Moverse de un tema al otro', en: 'Move from one track to another' }) },
      { teclas: 'Enter', hace: tr({ es: 'Abrir el tema', en: 'Open the track' }) },
      { teclas: 'F2', hace: tr({ es: 'Editar el título del tema elegido', en: 'Edit the title of the selected track' }) },
      { teclas: tr({ es: 'Ctrl+Mayús+D', en: 'Ctrl+Shift+D' }), hace: tr({ es: 'Tabla cómoda o compacta', en: 'Comfortable or compact table' }) },
      { teclas: tr({ es: 'E  ·  Mayús+E', en: 'E  ·  Shift+E' }), hace: tr({ es: 'Sumar a la cola al final o a continuación', en: 'Add to the end of the queue or play next' }) },
    ],
  },
  {
    grupo: tr({ es: 'En el reproductor', en: 'In the player' }),
    items: [
      { teclas: tr({ es: 'Espacio', en: 'Space' }), hace: tr({ es: 'Reproducir o pausar', en: 'Play or pause' }) },
      { teclas: 'Ctrl+←  ·  Ctrl+→', hace: tr({ es: 'Tema anterior o siguiente', en: 'Previous or next track' }) },
      { teclas: tr({ es: 'Mayús+←  ·  Mayús+→', en: 'Shift+←  ·  Shift+→' }), hace: tr({ es: 'Retroceder o adelantar 10 segundos', en: 'Skip back or forward 10 seconds' }) },
      { teclas: 'Ctrl+↑  ·  Ctrl+↓', hace: tr({ es: 'Subir o bajar el volumen', en: 'Volume up or down' }) },
      { teclas: 'S  ·  R  ·  M  ·  Q', hace: tr({ es: 'Aleatorio · repetir · silenciar · abrir la cola', en: 'Shuffle · repeat · mute · open the queue' }) },
    ],
  },
  {
    grupo: tr({ es: 'Ir a una pantalla (G y después la letra; se prende en Configuración → Pantalla)', en: 'Go to a screen (G and then the letter; turn it on in Settings → Display)' }),
    items: IR_A.map((x) => ({ teclas: `G  ${x.tecla}`, hace: x.nombre })),
  },
] as { grupo: string; items: Atajo[] }[]).map((g) => ({ ...g, items: g.items.map((i) => ({ ...i, teclas: teclas(i.teclas) })) }))

/** «Saltar al contenido» (lo primero que toca el Tab, en la barra de arriba): eran 49 Tab desde el Inicio hasta la pantalla. */
export const irAlContenido = () => document.querySelector<HTMLElement>('main.main')?.focus()

/**
 * Al cambiar de pantalla desde la barra lateral o Ctrl+K, el foco pasa a la pantalla nueva: el próximo Tab cae en sus botones
 * y no vuelve a recorrer toda la barra (con teclado hacían falta 25–38 Tab más hasta el botón; prueba de usabilidad, 27/10/2026).
 */
export function useFocoEnPantalla(page: PageKey) {
  useEffect(() => {
    const a = document.activeElement
    if (!a || a === document.body || a.closest('.side, .palette')) document.querySelector<HTMLElement>('main.main')?.focus({ preventScroll: true })
  }, [page])
}
