// Las marcas de Serato dentro del archivo, para Cambios pendientes (campo 'serato'): leerlas y escribirlas tal cual con la
// librería de tags. En MP3, AIFF y WAV son cuadros GEOB del ID3 ("Serato Markers2", "Serato BeatGrid" y el viejo "Serato
// Markers_"); en FLAC, comentarios en base64. Más el tono (TKEY) y el BPM (TBPM), que Serato muestra en su lista desde el
// tag. El valor es un JSON con lo que hay (`m2`, `bg`, `m1` en base64, `key` y `bpm`): lo que no está, no está en el archivo. Así "antes" vuelve idéntico al deshacer.
import { ByteVector, File, Id3v2AttachmentFrame, Id3v2FrameClassType, Id3v2FrameIdentifiers, Picture, PictureType, StringType, TagTypes, XiphComment, type Id3v2Tag } from 'node-taglib-sharp'
import { flacValue } from './seratofmt'
import { parseBeatGrid, parseMarkers2 } from './serato'
import { cant, lista, num, textos } from '@paila/shared/idioma'

// Lo que se ve en Cambios pendientes y el Historial (lo que va adentro del archivo no se traduce)
const T = textos({
  nada: { es: 'sin marcas de Serato', en: 'no Serato markers' },
  grilla: { es: (bpm: string) => `grilla a ${bpm} BPM`, en: (bpm: string) => `grid at ${bpm} BPM` },
  viejas: { es: 'marcas viejas de Serato', en: 'old Serato markers' },
  tono: { es: (k: string) => `tono ${k}`, en: (k: string) => `key ${k}` },
})

export interface SeratoTag { m2?: string; bg?: string; m1?: string; key?: string; bpm?: string }
const PARTS = [['m2', 'Serato Markers2', 'SERATO_MARKERS_V2'], ['bg', 'Serato BeatGrid', 'SERATO_BEATGRID'], ['m1', 'Serato Markers_', 'SERATO_MARKERS']] as const

/** Siempre en el mismo orden, para comparar lo escrito con lo pedido. */
export function seratoJson(t: SeratoTag | null): string | null {
  if (!t) return null
  const o: SeratoTag = {}
  for (const [k] of PARTS) if (t[k]) o[k] = t[k]
  if (t.key) o.key = t.key
  if (t.bpm) o.bpm = t.bpm
  return Object.keys(o).length ? JSON.stringify(o) : null
}

const isFlac = (f: File) => /\.flac$/i.test(f.name)
const geobs = (id3: Id3v2Tag) => id3.getFramesByClassType<Id3v2AttachmentFrame>(Id3v2FrameClassType.AttachmentFrame).filter((x) => x.frameId === Id3v2FrameIdentifiers.GEOB)

/** Lo que el archivo tiene hoy, como JSON (null = nada de Serato ni tono). */
export function readSeratoTagOf(f: File): string | null {
  const t: SeratoTag = {}
  if (isFlac(f)) {
    const x = f.getTag(TagTypes.Xiph, false) as XiphComment | undefined
    for (const [k, , name] of PARTS) {
      const v = x?.getFieldFirstValue(name)
      if (!v) continue
      // "application/octet-stream\0\0<descripción>\0" + el contenido
      const b = Buffer.from(v.replace(/\s/g, ''), 'base64')
      const a = b.indexOf(0), c = a >= 0 ? b.indexOf(0, a + 1) : -1, d = c >= 0 ? b.indexOf(0, c + 1) : -1
      if (d >= 0) t[k] = b.subarray(d + 1).toString('base64')
    }
  } else {
    const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | undefined
    if (id3) for (const fr of geobs(id3)) { const p = PARTS.find((x) => x[1] === fr.description); if (p) t[p[0]] = Buffer.from(fr.data.toByteArray()).toString('base64') }
  }
  const key = f.tag.initialKey?.trim()
  if (key) t.key = key
  const bpm = readBpm(f)
  if (bpm) t.bpm = bpm
  return seratoJson(t)
}

export function readSeratoTag(file: string): string | null {
  const f = File.createFromPath(file)
  try { return readSeratoTagOf(f) } finally { f.dispose() }
}

/** Deja el archivo con exactamente esto (lo de Serato que no viene se saca). Lo guarda quien llama (`f.save()`). */
export function writeSeratoTag(f: File, json: string | null) {
  const t: SeratoTag = json ? JSON.parse(json) : {}
  if (isFlac(f)) {
    const x = f.getTag(TagTypes.Xiph, true) as XiphComment
    for (const [k, desc, name] of PARTS) {
      if (t[k]) x.setFieldAsStrings(name, flacValue(desc, Buffer.from(t[k]!, 'base64')))
      else x.removeField(name)
    }
  } else {
    const id3 = f.getTag(TagTypes.Id3v2, true) as Id3v2Tag
    for (const fr of geobs(id3)) if (PARTS.some((p) => p[1] === fr.description)) id3.removeFrame(fr)
    for (const [k, desc] of PARTS) {
      if (!t[k]) continue
      const pic = Picture.fromFullData(ByteVector.fromByteArray(Buffer.from(t[k]!, 'base64')), PictureType.NotAPicture, 'application/octet-stream', desc)
      pic.filename = ''
      const fr = Id3v2AttachmentFrame.fromPicture(pic)
      fr.textEncoding = StringType.Latin1
      id3.addFrame(fr)
    }
  }
  if ((f.tag.initialKey?.trim() || undefined) !== t.key) f.tag.initialKey = t.key ?? ''
  if (readBpm(f) !== t.bpm) {
    if (isFlac(f)) { const x = f.getTag(TagTypes.Xiph, true) as XiphComment; if (t.bpm) x.setFieldAsStrings('BPM', t.bpm); else x.removeField('BPM') }
    else { const id3 = f.getTag(TagTypes.Id3v2, true) as Id3v2Tag; if (t.bpm) id3.setTextFrame(Id3v2FrameIdentifiers.TBPM, t.bpm); else id3.removeFrames(Id3v2FrameIdentifiers.TBPM) }
  }
}

/** El BPM escrito en el tag, como texto (con decimales si los tiene), o undefined. */
function readBpm(f: File): string | undefined {
  const v = isFlac(f) ? (f.getTag(TagTypes.Xiph, false) as XiphComment | undefined)?.getFieldFirstValue('BPM') : (f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | undefined)?.getTextAsString(Id3v2FrameIdentifiers.TBPM)
  return v?.trim() || undefined
}


/** El valor en palabras, para Cambios pendientes y el Historial: "grilla a 124 BPM, 3 cues y tono Am". */
export function seratoText(json: string | null): string {
  if (!json) return T.nada
  const t = JSON.parse(json) as SeratoTag
  const parts: string[] = []
  const grid = t.bg ? parseBeatGrid(Buffer.from(t.bg, 'base64')) : null
  if (grid) parts.push(T.grilla(num(grid.bpm, { maximumFractionDigits: 2 })))
  const cues = t.m2 ? parseMarkers2(Buffer.from(t.m2, 'base64')).cues.length : 0
  if (cues) parts.push(cant(cues, 'cue', 'cues'))
  if (t.m1 && !t.m2) parts.push(T.viejas)
  if (t.key) parts.push(T.tono(t.key))
  if (t.bpm && !grid) parts.push(`${t.bpm} BPM`)
  return parts.length ? lista(parts) : T.nada
}
