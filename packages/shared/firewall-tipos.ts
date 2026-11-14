// Los tipos del firewall de Windows y sockseek (el Chequeo de NAPIA, core/sockseek/firewall.ts): el tipo de red, qué pasa con el
// permiso y cómo se arregla. Aparte de napia.ts para que no pase de 350 líneas; napia.ts los vuelve a exportar.

/** Cómo trata Windows una red: Privada (tu casa), Pública (un bar, un aeropuerto) o de Dominio (la de una empresa). */
export type PerfilRed = 'dominio' | 'privada' | 'publica'

/**
 * Qué pasa con el firewall de Windows y sockseek en la red de ahora (core/sockseek/firewall.ts):
 * bien · apagado (el firewall de Windows no frena nada en esta red) · sinRegla (nunca se contestó el cartel de Windows) ·
 * bloqueado (se le dijo que no: la regla que bloquea gana) · otroPerfil (tiene permiso solo en el otro tipo de red) ·
 * todoBloqueado (Windows está frenando todas las conexiones que entran, hasta las de los programas con permiso).
 */
export type CasoFirewall = 'bien' | 'apagado' | 'sinRegla' | 'bloqueado' | 'otroPerfil' | 'todoBloqueado'

export interface FirewallDiag {
  caso: CasoFirewall
  /** El tipo de la red que se usa ahora (la que tiene internet). Vacío: no se pudo saber. */
  activos: PerfilRed[]
  /** El nombre de esa red (el del wifi), si se sabe. */
  red: string | null
  /** Dónde tiene permiso sockseek (sin una regla que lo bloquee ahí). */
  permitidos: PerfilRed[]
  /** Dónde lo frena una regla que bloquea. */
  bloqueados: PerfilRed[]
  /**
   * Lo que hace "Arreglarlo" (con el permiso de Windows, una vez): sacar las reglas que lo bloquean en esos tipos de red y
   * darle permiso donde le falta. null: no se arregla con una regla (todo bien, o lo decide la persona en Windows).
   */
  arreglo: null | { perfiles: PerfilRed[]; sacarBloqueos: boolean; permitir: PerfilRed[] }
  /** Lo mismo para hacerlo a mano (Terminal como administrador), si el botón no pudo. */
  aMano: string | null
}

/** Cómo salió "Arreglarlo": listo, se dijo que no al permiso de Windows, falló, o no había nada que arreglar. */
export type ResultadoArreglo = 'listo' | 'cancelado' | 'error' | 'nada'

/** Lo del firewall en el puente de NAPIA (window.napia): NapiaApi lo extiende. */
export interface FirewallApi {
  /** El firewall de Windows para sockseek en la red de ahora (no hace falta la cuenta: solo sockseek). */
  firewall: () => Promise<FirewallDiag | null>
  /** "Arreglarlo": cambia el firewall con el permiso de Windows (una vez) y lo vuelve a mirar. */
  arreglarFirewall: () => Promise<{ resultado: ResultadoArreglo; firewall: FirewallDiag | null }>
  /** Abre la pantalla de Windows para elegir el tipo de red, o la del firewall (las decide la persona). */
  abrirWindows: (que: 'red' | 'firewall') => Promise<void>
}
