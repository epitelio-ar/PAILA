// Deshacer encadenado en el Historial (MASTERPLAN-5, 3.4): qué dice el botón y la pregunta cuando después vino algo que toca la
// tanda ("Después, se cambió la tapa de 17 temas. ¿Deshago las dos?"), y el resultado. Lo usan History.tsx y HistoryVolver.tsx.
import type { HistoryEntry, HistoryUndoResult } from '@paila/shared/types'
import { cant, fechaHora, lista, num, textos } from '@paila/shared/idioma'

export const X = textos({
  aplicar: { es: 'Aplicar', en: 'Apply' },
  aplicarAyuda: {
    es: 'Todo lo que aplicaste junto con el botón Aplicar: lo que fue a la papelera, los nombres y tags, lo movido y las tapas. Se deshace todo junto, al revés de como se aplicó',
    en: 'Everything you applied together with the Apply button: what went to the trash, names and tags, what was moved and the covers. It is undone all together, in reverse order',
  },
  cAplicar: {
    es: 'Se deshace todo junto, al revés de como se aplicó: las tapas, lo movido, los nombres y tags y lo que fue a la papelera. Las carpetas que creó PAILA y quedan vacías se sacan, y la tapa que puso va a la papelera.',
    en: 'It is all undone together, in reverse order: the covers, what was moved, names and tags and what went to the trash. The folders PAILA created that end up empty are removed, and the cover it added goes to the trash.',
  },
  deshacerCon: { es: (k: number) => `Deshacer esta y ${k === 1 ? 'la que vino después' : `las ${num(k)} que vinieron después`}`, en: (k: number) => `Undo this one and ${k === 1 ? 'the one after it' : `the ${num(k)} after it`}` },
  pregunta: {
    es: (despues: string, total: number) => `Después, ${despues}. ¿Deshago ${total === 2 ? 'las dos' : `las ${num(total)}`}, de la más nueva a la más vieja?`,
    en: (despues: string, total: number) => `Afterwards: ${despues}. Undo ${total === 2 ? 'both' : `all ${num(total)}`}, newest first?`,
  },
  porque: { es: 'Tocan lo mismo: si se deshace solo esta, quedaría a medias.', en: "They touch the same things: undoing only this one would leave it half-done." },
  tambien: { es: (k: number) => (k === 1 ? 'También se deshace 1 tanda que vino después y las toca.' : `También se deshacen ${num(k)} tandas que vinieron después y las tocan.`), en: (k: number) => `${k === 1 ? '1 batch' : `${num(k)} batches`} that came after and touch them ${k === 1 ? 'is' : 'are'} undone too.` },
  tandas: { es: (k: number) => ` (${cant(k, 'tanda', 'tandas')})`, en: (k: number) => ` (${cant(k, 'batch', 'batches')})` },
  carpetas: { es: (k: number) => ` Se ${k === 1 ? 'sacó 1 carpeta vacía' : `sacaron ${num(k)} carpetas vacías`} que había creado PAILA.`, en: (k: number) => ` Removed ${cant(k, 'empty folder', 'empty folders')} PAILA had created.` },
})

const minus = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

/** El botón de deshacer de una tanda con cadena dice cuántas más deshace. */
export const botonCadena = (e: HistoryEntry) => X.deshacerCon(e.cadena!.length)
/** La pregunta: qué vino después (de la más vieja a la más nueva, como pasó) y cuántas se deshacen. */
export const preguntaCadena = (e: HistoryEntry) => X.pregunta(lista([...e.cadena!].reverse().map((c) => minus(c.summary))), e.cadena!.length + 1)

/** Lo que se deshace antes, con su hora, para leer antes de decir que sí. */
export function AvisoCadena({ e, queHace }: { e: HistoryEntry; queHace: string }) {
  return (
    <span className="small">
      {X.porque}
      <ul className="hist-cadena">{e.cadena!.map((c) => <li key={`${c.kind}:${c.id}`}>{c.summary} <span className="muted">· {fechaHora(c.at, { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></li>)}</ul>
      {queHace}
    </span>
  )
}

/** Lo que se agrega al resultado: cuántas tandas y las carpetas vacías que se sacaron. */
export const extraResultado = (r: HistoryUndoResult) => `${r.tandas && r.tandas > 1 ? X.tandas(r.tandas) : ''}${r.carpetas ? X.carpetas(r.carpetas) : ''}`
