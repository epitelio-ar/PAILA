// Nombres de lo que hay adentro de un ZIP o un RAR: pasarlos a texto (los viejos vienen en la codificación de MS-DOS,
// los nuevos en UTF-8) y armar con ellos rutas seguras para sacarlos (sin "..", sin letras de unidad, sin caracteres que
// Windows no acepta).
import { AUDIO_EXT, extOf } from '../files'

/** La página de códigos 850 de MS-DOS (Europa occidental), del 0x80 al 0xFF: la de los zip armados en Windows en castellano. */
const CP850 =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ '

/** ¿Son bytes UTF-8 válidos con al menos un carácter de más de un byte? (Los zip de Mac y Linux no avisan que lo son.) */
function looksUtf8(b: Uint8Array): boolean {
  let multi = false
  for (let i = 0; i < b.length; i++) {
    const c = b[i]
    if (c < 0x80) continue
    const n = c >= 0xc2 && c <= 0xdf ? 1 : c >= 0xe0 && c <= 0xef ? 2 : c >= 0xf0 && c <= 0xf4 ? 3 : -1
    if (n < 0 || i + n >= b.length) return false
    for (let k = 1; k <= n; k++) if ((b[i + k] & 0xc0) !== 0x80) return false
    i += n; multi = true
  }
  return multi
}

/**
 * Texto de un nombre guardado en bytes. `utf8`: el archivo avisa que es UTF-8. Si no avisa: UTF-8 si lo parece (Mac,
 * Linux, 7-Zip), y si no, la página 850 de MS-DOS (el "Enviar a carpeta comprimida" de Windows).
 */
export function decodeName(b: Uint8Array, utf8 = false): string {
  if (utf8 || looksUtf8(b)) return Buffer.from(b).toString('utf8')
  let s = ''
  for (const c of b) s += c < 0x80 ? String.fromCharCode(c) : CP850[c - 0x80]
  return s
}

/** ¿Es música (por la extensión)? */
export const isAudioName = (name: string) => AUDIO_EXT.has(extOf(name)) && !name.split('/').pop()!.startsWith('._')

/** Lo que vale la pena sacar junto con la música: tapas, la hoja .cue, el registro del ripeo, listas y textos del disco. */
const COMPANION = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'cue', 'log', 'm3u', 'm3u8', 'txt', 'nfo', 'pdf', 'sfv', 'md5', 'accurip'])
export const isCompanion = (name: string) => COMPANION.has(extOf(name))

/** Basura de otros sistemas que viaja adentro de los zip (carpetas __MACOSX, Thumbs.db, desktop.ini). */
export const isJunk = (name: string) => /(^|\/)__MACOSX\//i.test(name) || /(^|\/)(thumbs\.db|desktop\.ini|\.ds_store)$/i.test(name) || /(^|\/)\._/.test(name)

const BAD = /[<>:"|?*\u0000-\u001f]/g
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i

/**
 * Ruta relativa segura para sacar algo del comprimido: partes con "/" sin "..", sin la letra de unidad ni barras al
 * principio, sin caracteres que Windows no acepta (van como "_") ni puntos o espacios al final. null si no queda nada.
 */
export function safeRel(name: string): string | null {
  const parts = name.replace(/\\/g, '/').split('/').filter((p, i) => !(i === 0 && /^[a-z]:$/i.test(p)))
    .map((p) => p.replace(BAD, '_').replace(/[. ]+$/, '').trim()).filter((p) => p && p !== '.' && p !== '..')
    .map((p) => (RESERVED.test(p) ? `_${p}` : p))
  return parts.length ? parts.join('/') : null
}
