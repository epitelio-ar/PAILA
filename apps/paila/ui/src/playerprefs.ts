// Lo que el reproductor (Player.tsx) comparte o recuerda: el pedido de reproducir, "seguir con", el volumen y sus atajos.
import { tr } from '@paila/shared/idioma'

/** Un pedido al reproductor: sonar ya (con la lista de la que sigue), o sumar a la cola. */
export interface PlayRequest { kind: 'play' | 'next' | 'end'; id: number; ids?: number[]; /** De dónde sigue: "tu búsqueda", "la playlist X"… */ label?: string; at: number }

export type Follow = 'vista' | 'album' | 'tema'
export const FOLLOW_KEY = 'paila.follow'
export const readFollow = (): Follow => { try { const v = localStorage.getItem(FOLLOW_KEY); return v === 'album' || v === 'tema' ? v : 'vista' } catch { return 'vista' } }
export const readVolume = () => { try { return Number(localStorage.getItem('paila.volume') ?? 0.8) } catch { return 0.8 } }

export const SHORTCUTS = tr({
  es: [
    'Espacio: reproducir o pausa',
    'Ctrl + → / ←: siguiente / anterior',
    'Mayús + → / ←: adelantar o atrasar 10 segundos',
    'Ctrl + ↑ / ↓: volumen',
    'S: aleatorio · R: repetir (todo / uno / nada) · M: silenciar',
    'Q: abrir la cola · E: agregar el tema elegido al final de la cola · Mayús + E: que suene a continuación',
  ],
  en: [
    'Space: play or pause',
    'Ctrl + → / ←: next / previous',
    'Shift + → / ←: skip forward or back 10 seconds',
    'Ctrl + ↑ / ↓: volume',
    'S: shuffle · R: repeat (all / one / off) · M: mute',
    'Q: open the queue · E: add the selected track to the end of the queue · Shift + E: play it next',
  ],
}).join('\n')

