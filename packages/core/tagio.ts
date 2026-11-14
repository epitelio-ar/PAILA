// Leer y escribir tags y tapas en los archivos (node-taglib-sharp), con los arreglos para archivos difíciles y la
// verificación por huella del sonido. Lo usan Cambios pendientes (core/changes.ts) y el reemplazo de temas.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { File, ByteVector, Id3v2FrameIdentifiers as FrameIdentifiers, MpegAudioFileSettings, Picture, TagTypes, type Id3v2Tag } from 'node-taglib-sharp'
import './id3keep' // guardar nunca borra etiquetas que PAILA no tocó (ver ahí)
import { pcmHash } from './audiohash'
import { sniff } from './extensions'
import { writeSeratoTag } from './seratotag'
import { writeDjTag } from './djtag'
import { tr } from '@paila/shared/idioma'
import { T } from './tagio.textos'

export const TAG_FIELDS = ['title', 'artist', 'albumArtist', 'album', 'track', 'year', 'genre'] as const
export type TagField = (typeof TAG_FIELDS)[number]

/** Columna de la tabla `files` de cada campo. */
export const COLUMN: Record<TagField, string> = {
  title: 'title', artist: 'artist', albumArtist: 'album_artist', album: 'album', track: 'track', year: 'year', genre: 'genre',
}

// En los MP3, crear solo el tag moderno (ID3v2, al principio). La librería agregaba también un ID3v1 al final, y en los
// MP3 cuyo último cuadro está cortado ese tag se leía como audio: cambiaban los últimos ~20 ms. Si el archivo ya trae
// un ID3v1, se sigue actualizando.
MpegAudioFileSettings.defaultTagTypes = TagTypes.Id3v2

/** Formatos donde la escritura de tags no es segura (ver tests/tags-formats.test.ts). WebM: la librería no lo escribe (punto 1 real). */
export const NO_WRITE = new Set(['wmv', 'webm'])
/** Los WMA: sus tags (solo los de texto y el volumen parejo) se escriben re-empaquetando con ffmpeg (core/asftags.ts), no con la librería. */
export const ASF = new Set(['wma', 'asf'])

/**
 * Por qué no se le pueden escribir tags a un tema, para decirlo de entrada (null: se puede) y no que falle al aplicar: un WebM, o
 * un "MP3" que por dentro es un WebM sin un ID3 adelante ("Ella Baila Sola", bajado de YouTube con otro nombre: punto 1 real del
 * 24/10), o un WMA con la tapa adentro (core/asftags.ts). Los que traen un ID3 pegado adelante sí se escriben (extensions.ts, sniff):
 * para un Opus o un Vorbis fuera de un .ogg, y para un WMA, se mira el archivo (`file`; sin él, no se sabe y no se frena).
 */
export function cantWrite(f: { ext: string; codec?: string | null }, file: string | null | (() => string | null)): string | null {
  const ext = f.ext.toLowerCase()
  if (NO_WRITE.has(ext)) return T.noSeEscriben(ext)
  const asf = ASF.has(ext)
  if (!asf && (!/^(?:opus|vorbis)$/.test(f.codec ?? '') || ['ogg', 'oga', 'opus'].includes(ext))) return null
  const p = typeof file === 'function' ? file() : file
  if (asf) { try { return p && readCover(p) ? T.wmaConTapa : null } catch { return null } } // un WMA con la tapa adentro no (asftags.ts)
  let real: string | null = null
  try { real = p ? sniff(p) : null } catch { return null }
  return real === 'WEBM' || real === 'MKA' ? T.esWebm(ext) : null
}

export type Tags = Record<TagField, string | null>

/** Saca lo que Windows no permite en un nombre de archivo y los puntos o espacios del final. */
export function safeName(s: string): string {
  return s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s{2,}/g, ' ').replace(/[. ]+$/, '').trim()
}

/** Texto de un tag sin caracteres nulos ni espacios en las puntas; vacío = null. */
export const clean = (v: string | null | undefined) => { const s = (v ?? '').replace(/\u0000/g, '').trim(); return s === '' ? null : s }

/**
 * El texto tal como está escrito (solo sin caracteres nulos), con los espacios de las puntas: es lo que se anota como "antes"
 * y lo que vuelve al deshacer (un título " Grateful VINYL ONLY " volvía recortado: prueba del 22/10/2026).
 */
export const exact = (v: string | null | undefined) => { const s = (v ?? '').replace(/\u0000/g, ''); return s === '' ? null : s }

/**
 * Los campos de varios valores (artistas, géneros) se leen juntos con "; " (`joinedGenres`…): al escribir se separan igual.
 * En un MP3 con ID3v2.3 la librería separa los valores con "/" al leer, así que ahí van unidos con "/" (como los guarda ese
 * formato): antes "Rap; Hip Hop" se guardaba entero, se releía "Rap;  Hip Hop" y deshacer un cambio de género no podía volver
 * (corrida supervisada del motor único, 23/10). En los demás (ID3v2.4, FLAC, M4A), cada valor por separado.
 */
function many(f: File, s: string | null): string[] {
  const parts = s ? s.split('; ').filter((x) => x !== '') : []
  const v2 = (f.tagTypes & TagTypes.Id3v2) !== 0 ? (f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | undefined) : undefined
  return v2?.version === 3 && parts.length > 1 ? [parts.join('/')] : parts
}

/** `exact`: los textos sin recortar (para el diario y deshacer); si no, limpios. */
export function readTags(file: string, opts: { exact?: boolean } = {}): Tags {
  const f = File.createFromPath(file)
  const c = opts.exact ? exact : clean
  try {
    const t = f.tag
    return {
      title: c(t.title), artist: c(t.joinedPerformers), albumArtist: c(t.joinedAlbumArtists), album: c(t.album),
      track: t.track ? String(t.track) : null, year: t.year ? String(t.year) : null, genre: c(t.joinedGenres),
    }
  } finally { f.dispose() }
}

/** La tapa embebida como JSON { mime, data(base64) }, o null si no tiene. Es lo que se guarda en cambios pendientes y en el diario. */
export function readCover(file: string): string | null {
  const f = File.createFromPath(file)
  try {
    const p = f.tag.pictures[0]
    return p ? JSON.stringify({ mime: p.mimeType, data: Buffer.from(p.data.toByteArray()).toString('base64') }) : null
  } finally { f.dispose() }
}

/** Volumen parejo (ReplayGain): ganancia del tema y del disco en dB y picos (1 = el máximo sin recortar). */
export interface ReplayGain { tg: number | null; tp: number | null; ag: number | null; ap: number | null }
const r2 = (v: number | null | undefined, d: number) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d)
/** El valor guardado en Cambios pendientes y en el diario (redondeado igual al leer y al escribir, para poder compararlos). */
export function rgValue(g: ReplayGain): string | null {
  const v = { tg: r2(g.tg, 2), tp: r2(g.tp, 6), ag: r2(g.ag, 2), ap: r2(g.ap, 6) }
  return v.tg == null && v.tp == null && v.ag == null && v.ap == null ? null : JSON.stringify(v)
}
/** El ReplayGain que tiene escrito el archivo (null si no tiene). */
export function readReplayGain(file: string): string | null {
  const f = File.createFromPath(file)
  try { const t = f.tag; return rgValue({ tg: t.replayGainTrackGain, tp: t.replayGainTrackPeak, ag: t.replayGainAlbumGain, ap: t.replayGainAlbumPeak }) } finally { f.dispose() }
}

/**
 * El comentario del tag (COMM en MP3, COMMENT en FLAC, ICMT en WAV…), tal como está escrito. Ahí va, por ejemplo, el
 * tracklist de un set (core/setlists.ts): Rekordbox y los reproductores lo muestran.
 */
export function readComment(file: string): string | null {
  const f = File.createFromPath(file)
  try { return exact(f.tag.comment) } finally { f.dispose() }
}

/** Arma el JSON de tapa desde los bytes de una imagen (jpg o png). */
export function coverFromBytes(bytes: Uint8Array): string {
  const png = bytes[0] === 0x89 && bytes[1] === 0x50
  const jpg = bytes[0] === 0xff && bytes[1] === 0xd8
  if (!png && !jpg) throw new Error(T.imagen)
  return JSON.stringify({ mime: png ? 'image/png' : 'image/jpeg', data: Buffer.from(bytes).toString('base64') })
}

/**
 * Algunos archivos (AIFF de ciertos programas) traen un identificador único (UFID) sin dueño, y la librería de tags no
 * puede volver a escribirlo. Ese dato no sirve para nada: se descarta antes de guardar.
 */
function dropBrokenFrames(f: File) {
  const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null
  if (!id3) return
  for (const fr of [...id3.frames]) {
    if (String(fr.frameId) !== 'UFID') continue
    let owner: string | null | undefined
    try { owner = (fr as unknown as { owner?: string }).owner } catch { owner = null }
    if (!owner) id3.removeFrame(fr)
  }
}

/**
 * El año escrito a la vieja (un cuadro TYER dentro de un ID3v2.4, como venían AIFF de Bandcamp): la librería lo lee pero lo
 * tira al guardar, y el tema se quedaba sin año. Se pasa al cuadro nuevo (TDRC) antes de guardar (prueba en la copia
 * completa de la Música, 20/10/2026: 5 AIFF de Dylan Fogarty perdían el 2022).
 */
function oldYearToNew(f: File) {
  const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null
  if (!id3 || id3.version < 4) return
  const old = id3.getTextAsString(FrameIdentifiers.TYER)
  if (!old) return
  id3.removeFrames(FrameIdentifiers.TYER)
  if (!id3.getTextAsString(FrameIdentifiers.TDRC)) id3.setTextFrame(FrameIdentifiers.TDRC, old)
}

/** Los 128 bytes del tag viejo del final (ID3v1, empieza con "TAG"), o null si el archivo no tiene. */
export function readId3v1(file: string): Buffer | null {
  const fd = fs.openSync(file, 'r')
  try {
    const size = fs.fstatSync(fd).size
    if (size < 128) return null
    const b = Buffer.alloc(128)
    fs.readSync(fd, b, 0, 128, size - 128)
    return b.toString('latin1', 0, 3) === 'TAG' ? b : null
  } finally { fs.closeSync(fd) }
}

/**
 * `keepId3v1`: deja el tag viejo del final (ID3v1) byte por byte como estaba. Hace falta en los MP3 cuyo último cuadro de
 * audio está cortado justo antes de ese tag: el decodificador lee esos 128 bytes como si fueran sonido, y cambiar el tag
 * cambia los últimos milisegundos (3 MP3 del laboratorio, 21/10/2026). Los tags nuevos van igual al ID3v2 del principio,
 * que es el que leen PAILA, Rekordbox y los reproductores.
 */
export function writeTags(file: string, changes: Partial<Record<TagField | 'cover' | 'replaygain' | 'comment' | 'serato' | 'bpm' | 'key', string | null>>, opts: { keepId3v1?: boolean } = {}) {
  const v1 = opts.keepId3v1 ? readId3v1(file) : null
  writeTagsRaw(file, changes)
  if (!v1) return
  const fd = fs.openSync(file, 'r+')
  try {
    const size = fs.fstatSync(fd).size
    const now = Buffer.alloc(3)
    fs.readSync(fd, now, 0, 3, size - 128)
    if (now.toString('latin1') !== 'TAG') throw new Error(T.id3v1)
    fs.writeSync(fd, v1, 0, 128, size - 128)
  } finally { fs.closeSync(fd) }
}

function writeTagsRaw(file: string, changes: Partial<Record<TagField | 'cover' | 'replaygain' | 'comment' | 'serato' | 'bpm' | 'key', string | null>>) {
  const f = File.createFromPath(file)
  try {
    dropBrokenFrames(f)
    const t = f.tag
    for (const [k, v] of Object.entries(changes) as [TagField | 'cover' | 'replaygain' | 'comment' | 'serato' | 'bpm' | 'key', string | null][]) {
      // los textos se escriben tal cual (ya vienen limpios de Cambios pendientes; los de deshacer, como estaban)
      const s = k === 'cover' || k === 'replaygain' || k === 'serato' ? clean(v) : exact(v)
      switch (k) {
        case 'serato': writeSeratoTag(f, s); break
        case 'bpm': case 'key': writeDjTag(f, k, s); break // el BPM y el tono del tag, tal cual (core/djtag.ts)
        case 'replaygain': {
          // NaN = sin valor (la librería saca el dato del tag)
          // solo los que cambian: los demás quedan escritos como estaban (el mismo texto, "0.84814500" y no "0.848145")
          const g = (s ? JSON.parse(s) : {}) as Partial<ReplayGain>
          const set = (now: number, want: number | null | undefined, d: number, put: (v: number) => void) => { if (r2(now, d) !== r2(want, d)) put(want ?? NaN) }
          set(t.replayGainTrackGain, g.tg, 2, (v) => { t.replayGainTrackGain = v }); set(t.replayGainTrackPeak, g.tp, 6, (v) => { t.replayGainTrackPeak = v })
          set(t.replayGainAlbumGain, g.ag, 2, (v) => { t.replayGainAlbumGain = v }); set(t.replayGainAlbumPeak, g.ap, 6, (v) => { t.replayGainAlbumPeak = v })
          break
        }
        case 'cover': {
          if (!s) { t.pictures = []; break }
          const c = JSON.parse(s) as { mime: string; data: string }
          const pic = Picture.fromData(ByteVector.fromByteArray(Buffer.from(c.data, 'base64')))
          pic.mimeType = c.mime
          t.pictures = [pic]
          break
        }
        case 'comment': t.comment = s ?? ''; break
        case 'title': t.title = s ?? ''; break
        case 'artist': t.performers = many(f, s); break
        case 'albumArtist': t.albumArtists = many(f, s); break
        case 'album': t.album = s ?? ''; break
        case 'genre': t.genres = many(f, s); break
        case 'track': t.track = s ? parseInt(s, 10) || 0 : 0; break
        case 'year': t.year = s ? parseInt(s, 10) || 0 : 0; break
      }
    }
    // el año a la vieja (TYER en un ID3v2.4) se pasa al cuadro nuevo solo si PAILA escribe el año: si no, queda como estaba
    if ('year' in changes) oldYearToNew(f)
    f.save()
  } finally { f.dispose() }
}

/**
 * Algunos MP3 traen ceros de relleno entre el tag ID3v2 y el audio, sin que el tag los cuente como suyos. ffmpeg los
 * saltea, pero la librería de tags no encuentra el audio ("MPEG audio header not found"). Arreglo quirúrgico: se cambia
 * el tamaño declarado del tag (4 bytes del encabezado) para que esos ceros pasen a ser relleno del tag, que es lo que son.
 * Otra variante: el MP3 empieza directamente con ceros, sin tag. Ahí se escribe sobre los primeros 10 ceros un
 * encabezado de tag ID3v2.4 vacío cuyo tamaño cubre el resto de los ceros (pasan a ser relleno de un tag vacío).
 * No toca el audio ni ningún otro dato (marcadores de Serato, etc.). Devuelve true si cambió algo.
 */
export function absorbZeroPadding(file: string): boolean {
  const fd = fs.openSync(file, 'r+')
  try {
    const head = Buffer.alloc(10)
    if (fs.readSync(fd, head, 0, 10, 0) < 10) return false
    const tagged = head.toString('latin1', 0, 3) === 'ID3'
    if (tagged && (head[3] < 3 || head[3] > 4 || head[5] & 0x10)) return false // tag de versión rara o con pie de tag
    const ss = (b: Buffer, o: number) => (b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3]
    const end = tagged ? 10 + ss(head, 6) : 0
    const look = Buffer.alloc(64 * 1024)
    const n = fs.readSync(fd, look, 0, look.length, end)
    let zeros = 0
    while (zeros < n && look[zeros] === 0) zeros++
    // Solo si después de los ceros empieza un cuadro de MPEG de verdad.
    if (zeros === 0 || zeros + 4 > n || !isMpegFrameHeader(look, zeros)) return false
    if (!tagged && zeros < 10) return false // no entra el encabezado del tag
    const size = end - 10 + zeros
    if (size >= 1 << 28) return false
    const syncsafe = [(size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f]
    if (tagged) fs.writeSync(fd, Buffer.from(syncsafe), 0, 4, 6)
    else fs.writeSync(fd, Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, ...syncsafe]), 0, 10, 0) // "ID3", v2.4.0, sin flags
    return true
  } finally { fs.closeSync(fd) }
}

/** Encabezado de cuadro MPEG plausible: sincronía, y versión, capa, bitrate y frecuencia que no sean valores prohibidos. */
function isMpegFrameHeader(b: Buffer, o: number): boolean {
  return b[o] === 0xff && (b[o + 1] & 0xe0) === 0xe0 && (b[o + 1] & 0x18) !== 0x08 && (b[o + 1] & 0x06) !== 0
    && (b[o + 2] & 0xf0) !== 0xf0 && (b[o + 2] & 0x0c) !== 0x0c
}

/**
 * Reacomoda un M4A "fragmentado" (DASH, como los baja yt-dlp de YouTube sin --fixup) en un M4A común, sin recodificar:
 * ffmpeg copia el audio tal cual a `tmp` y eso reemplaza el contenido del archivo. La librería de tags no puede guardar en
 * los fragmentados. Quien la llama verifica después que la huella del sonido sea la misma (lo fue en el de Cerrone, 21/10/2026).
 */
export function remuxFragmented(ffmpeg: string, file: string, tmp: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(ffmpeg, ['-v', 'error', '-nostdin', '-y', '-i', file, '-map', '0', '-c', 'copy', '-map_metadata', '0', '-movflags', '+faststart', '-f', 'mp4', tmp], { windowsHide: true }, (err, _out, stderr) => {
      if (err) { fs.rmSync(tmp, { force: true }); reject(new Error(T.reacomodar(String(stderr).trim().split(/\r?\n/).pop() || err.message))); return }
      try { fs.copyFileSync(tmp, file); resolve() } catch (e) { reject(e) } finally { fs.rmSync(tmp, { force: true }) }
    })
  })
}

/** El sonido cambió al guardar (la huella no coincide): se reconoce por el tipo, así sirve en cualquier idioma. */
export class SoundChanged extends Error {}

/**
 * Huella del sonido de un archivo antes de tocarlo. Si ni siquiera se puede decodificar, no se toca: no habría
 * forma de comprobar después que el audio quedó igual.
 */
export async function hashBefore(ffmpeg: string, file: string): Promise<string> {
  try { return await pcmHash(ffmpeg, file) } catch (e) {
    throw new Error(T.noSeLee((e as Error).message))
  }
}

/**
 * Compara la huella del sonido después de guardar con la de antes: tiene que ser idéntica, bit a bit. `recheck` vuelve a
 * sacar la de antes desde la copia de resguardo: se usa cuando la de antes venía guardada del análisis, por si quedó
 * vieja (por ejemplo, otra versión de ffmpeg decodifica un MP3 con alguna diferencia mínima). Devuelve la huella.
 * `what` = lo que se estaba haciendo ("guardar"), o el par en los dos idiomas ({ es: 'guardar', en: 'saving' }).
 * Si el sonido cambió, el error es un `SoundChanged` (quien llama lo reconoce por el tipo, no por el texto).
 */
export async function checkSameAudio(ffmpeg: string, file: string, before: string, what: string | { es: string; en: string }, recheck?: () => Promise<string>) {
  const doing = typeof what === 'string' ? what : tr(what)
  let after: string
  try { after = await pcmHash(ffmpeg, file) } catch { throw new Error(T.noSeLeeDespues(doing)) }
  if (after !== before && !(recheck && after === await recheck())) throw new SoundChanged(T.sonidoCambio(doing))
  return after
}

/** Controles antes de escribir tags (no toca nada). `file` = ruta final (con la extensión nueva); `now` = dónde está hoy. */
export function checkWritable(file: string, now: string) {
  const ext = path.extname(file).slice(1).toLowerCase()
  if (NO_WRITE.has(ext)) throw new Error(T.noSeEscriben(ext))
  if (!fs.existsSync(now)) throw new Error(T.yaNoEsta)
  const real = sniff(now)
  const claimed = { mp3: 'MP3', wav: 'WAV', flac: 'FLAC', ogg: 'OGG', m4a: 'M4A/MP4', aiff: 'AIFF', aif: 'AIFF' }[ext] as string | undefined
  if (real && claimed && real !== claimed) throw new Error(T.porDentro(ext, real))
}

/**
 * Pasa los tags y/o la tapa de un archivo a otro (para el reemplazo de un tema por una versión mejor).
 * Verifica que el sonido del archivo nuevo quede idéntico; si no, avisa y el reemplazo se cancela.
 */
export async function transplantTags(from: string, to: string, ffmpeg: string, opts: { tags: boolean; cover: boolean }, known?: Partial<Tags>) {
  const ext = path.extname(to).slice(1).toLowerCase()
  if (NO_WRITE.has(ext) || ASF.has(ext)) throw new Error(T.noSeCopian(ext))
  const change: Partial<Record<TagField | 'cover', string | null>> = {}
  if (opts.tags) {
    // Los tags que PAILA ya conoce (los que ve el usuario) mandan; lo que falte se completa leyendo el archivo.
    const read = readTags(from)
    for (const k of TAG_FIELDS) change[k] = clean(known?.[k]) ?? read[k]
  }
  if (opts.cover) { const c = readCover(from); if (c) change.cover = c }
  if (!Object.keys(change).length) return
  const before = await hashBefore(ffmpeg, to)
  try { writeTags(to, change) } catch (e) { throw new Error(T.noSeCopiaron((e as Error).message)) }
  await checkSameAudio(ffmpeg, to, before, T.alCopiar)
}
