// Configuración → Rango de BPM por género: ver y cambiar en qué rango queda el BPM de cada estilo (core/analysis/bpmrange.ts).
import { useEffect, useState } from 'react'
import type { BpmStyle } from '@paila/shared/types'
import { textos, num as n } from '@paila/shared/idioma'
import { toast } from './toast'
import { Boton, Rico } from '@paila/diseno'

const T = textos({
  intro: {
    es: 'El BPM que calcula PAILA a veces sale al doble o a la mitad (una cumbia a 170 en vez de 85, un drum & bass a 87 en vez de 174). Para elegir bien, cada estilo tiene un rango: va desde el BPM mínimo hasta el doble. El estilo sale del **género** del tema o, si no tiene, de las **carpetas** donde está. Los temas sin estilo usan el rango general (70 a 180).',
    en: 'The BPM that PAILA calculates sometimes comes out double or half (a cumbia at 170 instead of 85, a drum & bass at 87 instead of 174). To pick the right one, each style has a range: it goes from the minimum BPM up to double. The style comes from the track\'s **genre** or, if it has none, from the **folders** it is in. Tracks without a style use the general range (70 to 180).',
  },
  cambiaron: {
    es: (k: number) => `Listo: ${n(k)} temas cambiaron de BPM (al doble o a la mitad)`,
    en: (k: number) => `Done: ${n(k)} ${k === 1 ? 'track' : 'tracks'} changed BPM (doubled or halved)`,
  },
  ninguno: { es: 'Listo: ningún tema cambió de BPM', en: 'Done: no track changed BPM' },
  nombre: { es: 'Nombre del estilo', en: 'Style name' },
  palabras: { es: 'Palabras del género o de la carpeta que lo reconocen, separadas por comas', en: 'Genre or folder words that identify it, separated by commas' },
  minimo: { es: 'BPM mínimo', en: 'Minimum BPM' },
  sacarEste: { es: 'Sacar este estilo', en: 'Remove this style' },
  sacar: { es: 'Sacar', en: 'Remove' },
  agregar: { es: 'Agregar estilo', en: 'Add style' },
  nuevo: { es: 'Nuevo estilo', en: 'New style' },
  deshacer: { es: 'Deshacer', en: 'Undo' },
  deshacerTitle: { es: 'Vuelve atrás el último cambio que todavía no guardaste', en: 'Reverts the last change you haven\'t saved yet' },
  descartar: { es: 'Descartar cambios', en: 'Discard changes' },
  descartarTitle: { es: 'Deja todo como estaba la última vez que guardaste', en: 'Puts everything back as it was the last time you saved' },
  fabrica: { es: 'Volver a los de fábrica', en: 'Back to the defaults' },
  fabricaTitle: { es: 'Vuelve a los rangos que trae PAILA', en: 'Goes back to the ranges PAILA comes with' },
  guardar: { es: 'Guardar y aplicar', en: 'Save and apply' },
})

const clean = (e: unknown) => String((e as Error).message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export default function BpmRanges() {
  const [styles, setStyles] = useState<BpmStyle[] | null>(null)
  const [custom, setCustom] = useState(false)
  const [dirty, setDirty] = useState(false)
  // lo de antes de cada cambio sin guardar, para Deshacer (Sacar un estilo por error, por ejemplo)
  const [before, setBefore] = useState<BpmStyle[][]>([])
  const load = () => window.paila.bpmStyles().then((r) => { setStyles(r.styles); setCustom(r.custom); setDirty(false); setBefore([]) })
  useEffect(() => { void load() }, [])
  if (!styles) return null
  const put = (next: BpmStyle[]) => { setBefore([...before, styles]); setStyles(next); setDirty(true) }
  const undo = () => { const last = before[before.length - 1]; if (!last) return; setStyles(last); setBefore(before.slice(0, -1)); setDirty(before.length > 1) }
  const change = (i: number, s: Partial<BpmStyle>) => put(styles.map((x, j) => (j === i ? { ...x, ...s } : x)))
  const save = async (list: BpmStyle[] | null) => {
    try {
      const changed = await window.paila.setBpmStyles(list)
      toast(changed ? T.cambiaron(changed) : T.ninguno)
      await load()
    } catch (e) { toast(clean(e), 'error') }
  }
  return (<>
    <p className="muted small"><Rico texto={T.intro} /></p>
    <div className="listbox">
      {styles.map((s, i) => (
        <div key={i} className="listbox-row bpm-style-row">
          <input value={s.name} onChange={(e) => change(i, { name: e.target.value })} title={T.nombre} />
          <input value={s.words.join(', ')} onChange={(e) => change(i, { words: e.target.value.split(',').map((w) => w.trim()).filter(Boolean) })}
            title={T.palabras} />
          <input type="number" min={40} max={200} value={s.min} onChange={(e) => change(i, { min: Number(e.target.value) })} title={T.minimo} />
          <span className="muted small">{s.min}–{s.min * 2} BPM</span>
          <Boton variant="ghost" size="sm" onClick={() => put(styles.filter((_, j) => j !== i))} title={T.sacarEste}>{T.sacar}</Boton>
        </div>
      ))}
    </div>
    <div className="row">
      <Boton variant="ghost" size="sm" onClick={() => put([...styles, { name: T.nuevo, words: [], min: 80 }])}>{T.agregar}</Boton>
      {before.length > 0 && <Boton variant="ghost" size="sm" onClick={undo} title={T.deshacerTitle}>{T.deshacer}</Boton>}
      {dirty && <Boton variant="ghost" size="sm" onClick={() => void load()} title={T.descartarTitle}>{T.descartar}</Boton>}
      <span className="push-right" />
      {custom && <Boton variant="ghost" size="sm" onClick={() => save(null)} title={T.fabricaTitle}>{T.fabrica}</Boton>}
      <Boton size="sm" disabled={!dirty} onClick={() => save(styles)}>{T.guardar}</Boton>
    </div>
  </>)
}
