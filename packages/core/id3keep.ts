// Guardar tags nunca borra ni cambia lo que PAILA no tocó en un ID3v2: se carga una vez, desde core/tagio.ts, y ajusta cómo
// node-taglib-sharp lee y vuelve a escribir cada cuadro.
import { ByteVector, Id3v2Frame, Id3v2FrameFactory, Id3v2FrameHeader, Id3v2TextInformationFrame, Id3v2UnknownFrame, StringType } from 'node-taglib-sharp'

/*
 * Guardar nunca borra ni cambia etiquetas de un ID3v2 que PAILA no tocó (MP3, y el ID3 de AIFF y WAV). La librería reescribía
 * el tag entero a su manera: tiraba los cuadros que no sabe leer (el volumen viejo de iTunes RVAD, los links WOAR/WOAF/WOAS/
 * WCOM, el identificador del CD MCDI), los que no existen en la versión del tag (en un ID3v2.3 hecho por Picard: TSOP, TSOA,
 * TSOT, TDRC, TDRL; TDOR pasaba a TORY) y volvía a armar comentarios, letras, UFID y los GEOB donde Serato guarda sus marcas.
 * Deshacer no lo devolvía. Relevamiento en la Música, 22/10/2026: 87 de 3.104 MP3 cambiaban algo con solo guardar
 * (docs/archivo/pruebas/2026-10-22-calidad-con-criterio.md). Ahora:
 *  - cada cuadro que se lee guarda sus bytes tal cual; uno que la librería no sabe leer queda como "desconocido", con sus bytes;
 *  - al guardar, un cuadro que PAILA no cambió sale con sus bytes originales; uno que cambió (o uno nuevo) se arma como siempre,
 *    con el mismo nombre con el que se leyó (así lo hacen Picard, foobar2000 y Mp3tag).
 * Con todo el tag "desincronizado" (unsync de ID3v2.3, muy raro) se deja todo como antes.
 */
type Kept = { _pailaRaw?: ByteVector; _pailaV?: number; _pailaBase?: ByteVector | null; renderFields: (v: number) => ByteVector }
type FileLike = { seek: (n: number) => void; readBlock: (n: number) => ByteVector }
type Read = { frame: (Id3v2Frame & Kept) | undefined; offset: number } | undefined
const factory = Id3v2FrameFactory as unknown as { createFrame: (data: ByteVector | undefined, file: FileLike | undefined, offset: number, version: number, unsynced: boolean) => Read }
const createFrame = factory.createFrame
factory.createFrame = function (data, file, offset, version, unsynced) {
  const r = createFrame.call(this, data, file, offset, version, unsynced)
  if (!r || unsynced || version < 3) return r
  let raw: ByteVector
  try {
    if (data) raw = data.subarray(offset, r.offset - offset)
    else { file!.seek(offset); raw = file!.readBlock(r.offset - offset) }
    if (raw.length !== r.offset - offset || raw.length < 10) return r
    // un cuadro que la librería no sabe leer: se conserva tal cual, como desconocido
    if (!r.frame) r.frame = Id3v2UnknownFrame.fromOffsetRawData(raw, 0, Id3v2FrameHeader.fromData(raw, version), version) as unknown as Id3v2Frame & Kept
    r.frame._pailaRaw = raw
    r.frame._pailaV = version
    // los cuadros de texto se leen recién cuando alguien los pide (al buscar el del volumen parejo se leen todos) y desde ahí
    // se arman "limpios": la foto de cómo estaba se saca ya leída, para comparar lo mismo con lo mismo (Kesha, 22/10/2026)
    ;(r.frame as unknown as { parseRawData?: () => void }).parseRawData?.()
    r.frame._pailaBase = r.frame.renderFields(version)
  } catch { if (r.frame) r.frame._pailaRaw = undefined }
  return r
}
const frameProto = Id3v2Frame.prototype as unknown as { render: (this: Id3v2Frame & Kept, v: number) => ByteVector }
const renderAny = frameProto.render
frameProto.render = function (version) {
  if (this._pailaRaw && this._pailaBase && version === this._pailaV) {
    let now: ByteVector | null = null
    try { now = this.renderFields(version) } catch { now = null }
    if (now && ByteVector.equals(now, this._pailaBase)) return this._pailaRaw
  }
  return renderAny.call(this, version)
}
// el nombre con el que se leyó cada cuadro (ID3v2.3 y v2.4), para los que se vuelven a armar
type RawHeader = { _pailaId?: string; _frameId: { render: (v: number) => ByteVector } }
const H = Id3v2FrameHeader as unknown as { fromData: (data: ByteVector, version: number) => RawHeader; prototype: { render: (this: RawHeader, v: number) => ByteVector } }
const headerFromData = H.fromData
H.fromData = function (data: ByteVector, version: number) {
  const h = headerFromData.call(this, data, version)
  if (version >= 3 && data.length >= 4) h._pailaId = data.subarray(0, 4).toString(StringType.Latin1)
  return h
}
const renderHeader = H.prototype.render
H.prototype.render = function (this: RawHeader, version: number) {
  if (!this._pailaId || version < 3) return renderHeader.call(this, version)
  const id = this._frameId
  const raw = ByteVector.fromString(this._pailaId, StringType.Latin1)
  try { this._frameId = { render: () => raw }; return renderHeader.call(this, version) } finally { this._frameId = id }
}
// un TDRC con fecha completa en un ID3v2.3 la librería lo parte en TYER y TDAT: si vino así del archivo, queda como estaba
const textProto = Id3v2TextInformationFrame.prototype as unknown as { render: (this: { _header?: RawHeader }, v: number) => ByteVector }
const renderText = textProto.render
textProto.render = function (version) {
  return version === 3 && this._header?._pailaId === 'TDRC' ? frameProto.render.call(this as unknown as Id3v2Frame & Kept, version) : renderText.call(this, version)
}
