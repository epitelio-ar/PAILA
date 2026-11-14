// Los pedidos de la interfaz sobre cómo se ve la ventana: el estilo y el idioma, que NAPIA hereda de PAILA. Aparte de api.ts
// para que no crezca: PailaApi los extiende.
import type { Idioma } from '../idioma'

export interface PantallaApi {
  /** Guarda el estilo de la ventana para que NAPIA lo herede (ver @paila/diseno estilo.ts). */
  setEstilo(estilo: 'actual' | 'historieta'): Promise<void>
  /** Guarda el idioma (también para NAPIA). Para verlo, la ventana se recarga (ver @paila/shared/idioma). */
  setIdioma(idioma: Idioma): Promise<void>
}
