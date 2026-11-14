// Eventos de toda la ventana: arrastrar archivos a la Bandeja, Ctrl+K (buscador de todo), Ctrl+Mayús+C (modo cabina), F2 (editar el título) y el
// aviso al abrir si la vez anterior PAILA se cortó a mitad de algo.
import { useEffect, useState } from 'react'
import { leerCabina, ponerCabina } from '@paila/diseno'
import type { InboxItem } from '@paila/shared/types'
import { toast } from '../toast'
import { tr } from '@paila/shared/idioma'

/** `onDropFiles`: se llama al soltar archivos (para ir a la Bandeja). `onDropList`: soltaron una lista (CSV, .m3u, .txt: va a "Traer una lista"; un rekordbox.xml: a Rekordbox). */
export function useWindowEvents(onDropFiles: () => void, onDropList: (path: string) => void = () => {}, onMuestrario: () => void = () => {}) {
  const [dropped, setDropped] = useState<InboxItem[]>([])
  const [dragging, setDragging] = useState(false)
  const [palette, setPalette] = useState(false)

  // Si la vez anterior PAILA se cortó a mitad de algo, al abrir lo revisó: el detalle está en Inicio.
  useEffect(() => {
    window.paila.recovery().then((r) => {
      if (r.items.length) toast(tr({ es: 'La última vez PAILA se cerró de golpe. Revisó lo que quedó a medias: mirá el aviso en Inicio.', en: 'PAILA closed suddenly last time. It checked what was left half done: see the notice on Home.' }), r.items.some((i) => i.result === 'revisar') ? 'error' : 'info')
    }).catch(() => {})
  }, [])
  // Volvió un disco que tenía algo a medias: PAILA lo resolvió sin cerrarse
  useEffect(() => window.paila.onRecovery((r, n) => {
    toast(tr({ es: `Volvió un disco que tenía algo a medias: PAILA revisó ${n === 1 ? 'una cosa' : `${n} cosas`}. Mirá el aviso en Inicio.`, en: `A disk that had something half done is back: PAILA checked ${n === 1 ? 'one thing' : `${n} things`}. See the notice on Home.` }), r.items.some((i) => i.result === 'revisar') ? 'error' : 'info')
  }), [])

  // Arrastrar archivos, carpetas o ZIP a la ventana: van a la Bandeja para emparejarlos con la biblioteca (una lista, a "Traer una lista").
  useEffect(() => {
    // Lo que se arrastra desde adentro de PAILA (la oreja, una tapa, un tema hacia una playlist) no es para la Bandeja:
    // Chromium marca las imágenes arrastradas como "Files", así que se recuerda que el arrastre empezó en la ventana.
    let interno = false
    const start = () => { interno = true }
    const end = () => { interno = false; setDragging(false) }
    const has = (e: DragEvent) => !interno && !!e.dataTransfer && [...e.dataTransfer.types].includes('Files')
    const over = (e: DragEvent) => { if (has(e)) { e.preventDefault(); setDragging(true) } }
    const leave = (e: DragEvent) => { if (e.relatedTarget === null) setDragging(false) }
    const drop = async (e: DragEvent) => {
      if (!has(e)) return
      e.preventDefault(); setDragging(false)
      const paths = [...e.dataTransfer!.files].map((f) => window.paila.pathForFile(f)).filter(Boolean)
      if (!paths.length) return
      // una lista de temas (el CSV que bajaste de Chosic o Exportify) no es música para la Bandeja
      if (paths.length === 1 && /.(csv|tsv|m3u8?|txt|xml)$/i.test(paths[0])) { onDropList(paths[0]); return }
      onDropFiles()
      try { const items = await window.paila.inboxInspect(paths); setDropped((d) => [...items, ...d.filter((x) => !items.some((i) => i.path === x.path))]) } catch { /* se ve vacío */ }
    }
    window.addEventListener('dragstart', start); window.addEventListener('dragend', end)
    window.addEventListener('dragover', over); window.addEventListener('dragleave', leave); window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragstart', start); window.removeEventListener('dragend', end)
      window.removeEventListener('dragover', over); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop)
    }
  }, []) // onDropFiles solo cambia de página: alcanza con el de la primera vez

  // Ctrl+K: buscador de todo. Ctrl+Mayús+M: el muestrario de diseño (pantalla oculta de desarrollo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'm') { e.preventDefault(); onMuestrario(); return } if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'c') { e.preventDefault(); ponerCabina(!leerCabina()); return } if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, []) // onMuestrario solo cambia de página

  // F2 (como en Mp3tag): editar el título del tema seleccionado.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'F2') { const el = document.getElementById('tag-title') as HTMLInputElement | null; if (el) { e.preventDefault(); el.focus(); el.select() } } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return { dropped, setDropped, dragging, palette, setPalette }
}
