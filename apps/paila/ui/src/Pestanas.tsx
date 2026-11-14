// La barra de pestañas (secciones.ts): Inicio y Tu música fijas, Ordenar · Sonido · Llevar numeradas y DJ (solo con las herramientas), cada
// una con su estado real (core/estado.ts): ✓ cuando todas sus partes están en 0, el número si falta algo, y en la ayuda cuánto
// falta. Tocar una pestaña vuelve a la última parte que abriste.
import type { LibraryStats } from '@paila/shared/tableview'
import type { ScanStatus } from '@paila/shared/types'
import type { PageKey } from './nav'
import { pestanasVisibles, hecha, seccionDe, ultimaParte } from './secciones'
import { hechos, renglones } from './Estado.lista'
import { useEstado } from './hooks/useEstado'
import { useProfile } from './profile'
import { Icon } from './icons'

export default function Pestanas({ page, onPage, stats }: { page: PageKey; onPage: (p: PageKey) => void; stats: LibraryStats; scan: ScanStatus }) {
  const { djTools } = useProfile()
  const estado = useEstado(stats)
  const lista = estado ? renglones(estado) : []
  const listos = hechos(lista)
  const actual = seccionDe(page)?.id
  const numero = Object.fromEntries(pestanasVisibles(djTools).filter((s) => !s.icono).map((s, i) => [s.id, i + 1]))
  return (
    <nav className="pestanas" aria-label="PAILA">
      {pestanasVisibles(djTools).map((s) => {
        const ok = !!estado && hecha(s, listos)
        // cuánto falta en esta pestaña, en la ayuda (los números de verdad, no "para repasar")
        const falta = lista.filter((r) => s.pasos.includes(r.clave) && r.como === 'falta').map((r) => `${r.titulo}: ${r.texto}`)
        return (
          <span key={s.id} className="pestana-cont">
            {s.id === 'ordenar' && <span className="pestana-sep" aria-hidden />}
            <button data-seccion={s.id} className={`pestana ${actual === s.id ? 'on' : ''} ${ok ? 'ok' : ''}`} title={[s.help, ...falta].join('\n')}
              aria-current={actual === s.id ? 'page' : undefined} onClick={() => onPage(ultimaParte(s, djTools))}>
              {s.icono ? <Icon name={s.icono} size={14} /> : <span className="pestana-n">{ok ? <Icon name="check" size={12} /> : numero[s.id]}</span>}
              {s.label}
            </button>
          </span>
        )
      })}
    </nav>
  )
}
