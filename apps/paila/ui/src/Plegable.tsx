// Una sección que se pliega, con su número, su título y en qué está en un renglón ("faltan 386 búsquedas", "12 para revisar",
// "listo"). Completar desde internet tenía tres recorridos enteros uno abajo del otro y la persona 2 la sintió "INFINITA" (01/11):
// ahora se ve un renglón por sección y está abierta la primera que falta (primeraAbierta). Plegada, sigue montada: su búsqueda
// sigue y su estado se actualiza.
import type { ReactNode } from 'react'
import { Icon } from '@paila/diseno'

export interface EstadoSeccion { listo: boolean; texto: string }

export function Plegable({ n, titulo, estado, abierto, onToggle, children }: { n: number; titulo: string; estado?: EstadoSeccion; abierto: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section className={`plegable${abierto ? ' plegable-abierto' : ''}${estado?.listo ? ' listo' : ''}`}>
      <button type="button" className="plegable-cab" aria-expanded={abierto} onClick={onToggle}>
        <span className="plegable-n num">{estado?.listo ? <Icon name="check" size={13} /> : n}</span>
        <b>{titulo}</b>
        {estado && <span className="plegable-estado small">{estado.texto}</span>}
        <Icon name="chevron" size={14} className="plegable-flecha" />
      </button>
      <div className="plegable-cuerpo" hidden={!abierto}>{children}</div>
    </section>
  )
}

/** Cuál va abierta: la que elegiste, o si no la primera que no está lista (todas listas: ninguna). */
export const primeraAbierta = (elegida: number | null, estados: (EstadoSeccion | undefined)[]) =>
  elegida ?? (estados.findIndex((e) => e && !e.listo) + 1 || null)
