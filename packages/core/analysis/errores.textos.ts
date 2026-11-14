// Los errores de leer el audio que se ven (y se guardan con el tema, en el idioma de ese momento), en castellano y en
// inglés (ver @paila/shared/idioma). Los usan analyze.ts, gridscan.ts, silence.ts y setprint.ts; nadie compara el texto.
import { textos } from '@paila/shared/idioma'

export const T = textos({
  ffmpegCodigo: { es: (code: number | null) => `ffmpeg terminó con código ${code}`, en: (code: number | null) => `ffmpeg ended with code ${code}` },
  noSeLeyo: { es: 'No se pudo leer el audio', en: "Couldn't read the audio" },
})
