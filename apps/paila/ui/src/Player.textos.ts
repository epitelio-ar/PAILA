// Los textos del reproductor de abajo, en castellano y en inglés (ver @paila/shared/idioma).
import { textos } from '@paila/shared/idioma'

export const T = textos({
  desde: { es: (l: string) => ` · desde ${l}`, en: (l: string) => ` · from ${l}` },
  avance: { es: 'Avance del tema', en: 'Track progress' },
  suenaComo: { es: (k: number) => `suena como ~${k} kbps`, en: (k: number) => `sounds like ~${k} kbps` },
  pulso: { es: 'Pulso (BPM) y tono en notación Camelot', en: 'Pulse (BPM) and key in Camelot notation' },
  aleatorio: { es: (on: boolean) => `Aleatorio ${on ? 'prendido' : 'apagado'} (S)`, en: (on: boolean) => `Shuffle ${on ? 'on' : 'off'} (S)` },
  anterior: { es: 'Anterior (Ctrl + ←)', en: 'Previous (Ctrl + ←)' },
  playPausa: { es: 'Reproducir / pausa (barra espaciadora)', en: 'Play / pause (Space)' },
  siguiente: { es: 'Siguiente (Ctrl + →)', en: 'Next (Ctrl + →)' },
  repetir: {
    es: (m: 'off' | 'all' | 'one') => `Repetir: ${m === 'off' ? 'apagado' : m === 'all' ? 'toda la lista' : 'este tema'} (R)`,
    en: (m: 'off' | 'all' | 'one') => `Repeat: ${m === 'off' ? 'off' : m === 'all' ? 'whole list' : 'this track'} (R)`,
  },
  bpPrendida: { es: 'Salida "bit perfect" prendida', en: '"Bit perfect" output on' },
  bpVolumen: { es: 'Bit perfect · volumen en tu equipo', en: 'Bit perfect · volume on your device' },
  quitarSilencio: { es: 'Quitar el silencio (M)', en: 'Unmute (M)' },
  silenciar: { es: 'Silenciar (M)', en: 'Mute (M)' },
  volumen: { es: 'Volumen', en: 'Volume' },
  elegi: { es: 'Elegí un tema y dale play (doble clic o barra espaciadora).', en: 'Pick a track and hit play (double-click or Space).' },
  cargando: { es: 'Cargando…', en: 'Loading…' },
  noSePudo: { es: 'No se pudo reproducir este archivo: sigo con el que viene.', en: "Couldn't play this file: moving on to the next one." },
  salida: { es: 'Salida de audio', en: 'Audio output' },
  cola: { es: 'La cola (Q)', en: 'The queue (Q)' },
  colaAria: { es: 'La cola', en: 'The queue' },
  volver: { es: 'Volver (Esc)', en: 'Back (Esc)' },
  grande: { es: 'Escuchando: el reproductor en grande', en: 'Now playing: the player, full screen' },
  escucharElegido: { es: 'Escuchar el tema elegido', en: 'Play the selected track' },
  escuchando: { es: 'Escuchando', en: 'Now playing' },
  atajos: { es: 'Atajos del reproductor', en: 'Player shortcuts' },
  cerrar: { es: 'Cerrar', en: 'Close' },
})
