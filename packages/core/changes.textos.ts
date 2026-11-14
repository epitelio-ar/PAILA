// Los textos de Cambios pendientes (core/changes.ts y core/changes-write.ts), en castellano y en inglés (ver
// @paila/shared/idioma): cómo se describen las tapas y los comentarios en la lista, y por qué no se pudo aplicar un cambio.
// Nada de esto se escribe en los archivos.
import { textos } from '@paila/shared/idioma'

export const T = textos({
  enUso: { es: 'Está abierto en otro programa (un reproductor, un editor): cerralo y probá de nuevo', en: 'It is open in another program (a player, an editor): close it and try again' },
  sinPermiso: { es: 'No se deja escribir: puede estar abierto en otro programa o ser de solo lectura', en: 'It cannot be written: it may be open in another program or read-only' },
  sinLugar: { es: 'No hay lugar en el disco', en: 'The disk is full' },
  noEsta: { es: 'El archivo ya no está ahí (¿se movió, o el disco se desconectó?)', en: 'The file is no longer there (was it moved, or the disk disconnected?)' },
  conTapa: { es: 'con tapa', en: 'with cover' },
  sinTapa: { es: 'sin tapa', en: 'no cover' },
  tapaNueva: { es: 'tapa nueva', en: 'new cover' },
  renglones: { es: (first: string, n: number) => `${first} (${n} renglones)`, en: (first: string, n: number) => `${first} (${n} lines)` },
  extensionInvalida: { es: (v: string) => `Extensión inválida: ${v}`, en: (v: string) => `Invalid extension: ${v}` },
  samplePacks: { es: 'Los sample packs no se renombran', en: 'Sample packs are never renamed' },
  samplePacksRecorte: { es: 'Los sample packs no se recortan', en: 'Sample packs are never trimmed' },
  sinRecortar: { es: 'Recortar silencios no está disponible', en: 'Trimming silences is not available' },
  samplePacksTapas: { es: 'En las carpetas de sample packs no se ponen tapas', en: 'Covers are not added in sample pack folders' },
  sinDisco: { es: 'El disco no está conectado', en: "The drive isn't connected" },
  yaNoEsta: { es: 'El archivo ya no está', en: 'The file is no longer there' },
  yaExiste: { es: (name: string) => `Ya existe un archivo llamado ${name}`, en: (name: string) => `There is already a file called ${name}` },
  // al guardar (changes-write.ts)
  libreria: { es: (det: string) => `La librería de tags no pudo escribir este archivo (${det}). No se tocó.`, en: (det: string) => `The tag library couldn't write this file (${det}). It was not touched.` },
  serato: { es: 'La grilla y los cues de Serato no quedaron guardados', en: 'The Serato grid and cues were not saved' },
  tapa: { es: 'La tapa no quedó guardada', en: 'The cover was not saved' },
  volumen: { es: 'El volumen parejo (ReplayGain) no quedó guardado', en: 'The even volume (ReplayGain) was not saved' },
  comentario: { es: 'El comentario no quedó guardado', en: 'The comment was not saved' },
  campo: { es: (k: string) => `El campo ${k} no quedó guardado`, en: (k: string) => `The ${k} field was not saved` },
  sePerdia: {
    es: (k: string) => `Al guardar se perdía ${k === 'year' ? 'el año' : `el campo ${k}`}: no se tocó el archivo`,
    en: (k: string) => `Saving would lose ${k === 'year' ? 'the year' : `the ${k} field`}: the file was not touched`,
  },
  /** Lo que se estaba haciendo, para "El sonido cambió al …". */
  guardar: { es: 'guardar', en: 'saving' },
  id3v1: {
    es: (det: string) => `${det}. Este MP3 tiene el final del audio pegado a un tag viejo (ID3v1) que no se puede cambiar sin tocar el sonido: los datos nuevos se guardan, pero un campo que solo está en ese tag viejo no se puede vaciar. No se tocó.`,
    en: (det: string) => `${det}. This MP3 has the end of its audio stuck to an old tag (ID3v1) that cannot be changed without touching the sound: the new info is saved, but a field that only lives in that old tag cannot be emptied. It was not touched.`,
  },
})

/**
 * Por qué falló un archivo, en palabras: los errores del sistema ("EBUSY: resource busy or locked, open …") se veían tal cual en
 * "no se pudieron hacer" (prueba de usabilidad del 27/10/2026: un archivo abierto en otro programa). Los demás, como vienen.
 */
export function motivo(e: unknown): string {
  const code = (e as NodeJS.ErrnoException)?.code ?? String((e as Error)?.message ?? '').match(/^(EBUSY|EPERM|EACCES|ENOSPC|ENOENT)\b/)?.[1]
  if (code === 'EBUSY') return T.enUso
  if (code === 'EPERM' || code === 'EACCES') return T.sinPermiso
  if (code === 'ENOSPC') return T.sinLugar
  if (code === 'ENOENT') return T.noEsta
  return (e as Error)?.message ?? String(e)
}
