// Escribir tags en un archivo, de forma segura (rediseño del 24/10): el original no se toca hasta el final. Se copia a un
// temporal en el mismo disco (_PAILA/escribiendo, que el escaneo no mira) → se escribe ahí (con los arreglos de archivos
// difíciles) → se releen los tags → la huella del sonido tiene que ser la misma de antes → se guarda lo que cambia (respaldo
// liviano, ops/delta.ts) → recién ahí el temporal reemplaza al original, de una vez (un solo renombre, que no queda a medias).
// Si algo falla antes, el original quedó como estaba y el temporal se saca. Lo usa Cambios pendientes (core/changes.ts).
import fs from 'node:fs'
import path from 'node:path'
import type { Db } from './db'
import { isFragmentedMp4 } from './extensions'
import type { OpJournal } from './journal'
import { writeAsfTags } from './asftags'
import { absorbJunkBeforeAudio } from './mp3fix'
import { ASF, SoundChanged, TAG_FIELDS, absorbZeroPadding, checkSameAudio, clean, exact, hashBefore, readCover, readId3v1, readComment, readReplayGain, readTags, remuxFragmented, writeTags, type TagField } from './tagio'
import { T } from './changes.textos'
import type { CoverStore } from './coverstore'
import { readSeratoTag } from './seratotag'
import { readDjTag } from './djtag'
import { fileSha1, rebuild, readDelta, saveDelta } from './ops/delta'
import { savedOf, type SavedFile } from './ops/backup'
import { reemplazar as replace } from './reemplazar'

export type FileField = TagField | 'cover' | 'replaygain' | 'comment' | 'serato' | 'bpm' | 'key'
/** Lo que necesita la escritura de Cambios pendientes. */
export interface WriteCtx { db: Db; ffmpeg: string; journal: OpJournal; covers: CoverStore }

/**
 * Dónde trabaja una escritura (lo decide quien la llama y queda en el diario antes de empezar): `tmp` = el temporal, en el
 * mismo disco; `delta` = el cambios.paila de la tanda, donde se agrega lo de antes; `restore` = para deshacer byte a byte (core/changes-undo.ts): llena el
 * temporal con el archivo de antes exacto y devuelve true, o false si no se puede (y se vuelven a escribir los tags de antes).
 */
export interface WritePlan { tmp: string; delta: string; rel: string; restore?: (tmp: string, file: string) => Promise<boolean> }

/**
 * La huella del sonido que sacó el análisis, si sigue valiendo: el archivo tiene el mismo tamaño y la misma fecha que
 * cuando se calculó (cualquier cambio en el archivo cambia la fecha).
 */
/**
 * Un artista con "/" en un MP3 (ID3v2.3: «Big One, FMK / Ke Personajes», «AC/DC»): en el archivo queda tal cual (otros programas y el
 * escaneo lo leen igual), pero la librería de tags lo relee partido en varios artistas. Quedó bien si son los mismos nombres en el
 * mismo orden (uso real del 24/10: «El campo artist no quedó guardado»).
 */
export function sameArtists(k: string, want: string | null, got: string | null): boolean {
  if (k !== 'artist' && k !== 'albumArtist') return false
  const parts = (s: string | null) => (s ?? '').split(/\s*(?:;|\/)\s*/).map((x) => x.trim()).filter(Boolean).join('|')
  return !!want && parts(want) === parts(got)
}

function storedHash(db: Db, fileId: number, file: string): string | null {
  const a = db.prepare('SELECT audio_md5 AS md5, audio_size AS size, audio_mtime AS mtime FROM analysis WHERE file_id = ?').get(fileId) as
    { md5: string | null; size: number | null; mtime: number | null } | undefined
  if (!a?.md5) return null
  const st = fs.statSync(file)
  return st.size === a.size && st.mtimeMs === a.mtime ? a.md5 : null
}

/** Que el temporal quede escrito en el disco antes de reemplazar al original (si no, un corte de luz podría dejarlo vacío). */
function sync(file: string) {
  const fd = fs.openSync(file, 'r+')
  try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
}

/**
 * Temporal → escribir → verificar (releer tags + huella del sonido igual a la de antes) → guardar lo que cambia → reemplazar.
 * La huella "antes" es la que guardó el análisis si el archivo no cambió desde entonces (así se decodifica una sola vez,
 * después de escribir); si no la hay, se saca del original mientras se escribe el temporal. Se guarda en el diario. Solo toca
 * archivos: la base la actualiza `changeFile`. Devuelve cómo quedó el archivo, su huella del sonido (la misma de antes; null
 * si se rearmó byte a byte y no se sabía) y lo que guardó el respaldo.
 */
export async function writeSafe(c: WriteCtx, jid: number, fileId: number, file: string, stagedChange: Partial<Record<FileField, string | null>>, w: WritePlan): Promise<{ st: fs.Stats; md5: string | null; saved: SavedFile; exact: boolean }> {
  const ext = path.extname(file).slice(1).toLowerCase()
  // las tapas guardadas como referencia (core/coverstore.ts) se escriben con la imagen entera
  const change = 'cover' in stagedChange ? { ...stagedChange, cover: c.covers.expand(clean(stagedChange.cover)) } : stagedChange
  const stored = storedHash(c.db, fileId, file)
  fs.mkdirSync(path.dirname(w.tmp), { recursive: true })
  let fromOrig: Promise<string> | null = null
  const hashOrig = () => (fromOrig ??= hashBefore(c.ffmpeg, file))
  let replaced = false
  try {
    let md5: string | null = null
    const exactly = w.restore ? await w.restore(w.tmp, file) : false
    if (exactly) md5 = stored
    else {
      fs.copyFileSync(file, w.tmp)
      const before = stored ? Promise.resolve(stored) : hashOrig()
      before.then((h) => c.journal.hash(jid, h), () => {}) // el error se informa abajo, al esperarla
      const pre = (() => { try { return readTags(file, { exact: true }) } catch { return null } })() // ¿se pierde algo que no se tocaba? (el año de unos AIFF)
      const attempt = async (keepId3v1: boolean) => {
        const tmp = w.tmp
        // M4A de YouTube "fragmentado" (DASH): la librería de tags no guarda bien en esos. Se reacomoda antes, sin recodificar
        // (como yt-dlp --fixup); la huella del sonido de abajo comprueba que el audio quedó idéntico.
        if (['m4a', 'mp4'].includes(ext) && isFragmentedMp4(tmp)) await remuxFragmented(c.ffmpeg, tmp, `${tmp}.reacomodado.m4a`)
        // un WMA se re-empaqueta con ffmpeg, sin recodificar (core/asftags.ts); la huella de abajo comprueba que el audio quedó igual
        if (ASF.has(ext)) await writeAsfTags(c.ffmpeg, tmp, change)
        else try { writeTags(tmp, change, { keepId3v1 }) } catch (e) {
          // MP3 con ceros sueltos antes del audio, o con el tag mal cerrado o restos de un cuadro roto (core/mp3fix.ts): se arregla el
          // encabezado del tag y se reintenta (la huella lo verifica)
          let retried = false
          // (la librería avisa "MPEG audio header not found" o, con el tag mal cerrado, "Argument out of range")
          if (absorbZeroPadding(tmp) || absorbJunkBeforeAudio(tmp)) {
            try { writeTags(tmp, change, { keepId3v1 }); retried = true } catch { /* se informa el error original */ }
          }
          if (!retried) throw new Error(T.libreria((e as Error).message))
        }
        const back = readTags(tmp, { exact: true })
        for (const [k, v] of Object.entries(change) as [FileField, string | null][]) {
          const want = k === 'cover' || k === 'replaygain' || k === 'serato' ? clean(v) : exact(v)
          if (k === 'serato') { if (readSeratoTag(tmp) !== want) throw new Error(T.serato); continue }
          if (k === 'bpm' || k === 'key') { if (readDjTag(tmp)[k] !== want) throw new Error(T.campo(k)); continue }
          if (k === 'cover') { if ((readCover(tmp) ?? null) !== want) throw new Error(T.tapa); continue }
          if (k === 'replaygain') { if (readReplayGain(tmp) !== want) throw new Error(T.volumen); continue }
          if (k === 'comment') { if (readComment(tmp) !== want) throw new Error(T.comentario); continue }
          const got = back[k]
          const same = k === 'track' || k === 'year' ? (want ? parseInt(want, 10) : 0) === (got ? parseInt(got, 10) : 0) : want === got || sameArtists(k, want, got)
          if (!same) throw new Error(T.campo(k))
        }
        const lost = pre && TAG_FIELDS.find((k) => !(k in change) && pre[k] !== back[k]); if (lost) throw new Error(T.sePerdia(lost))
        return checkSameAudio(c.ffmpeg, tmp, await before, T.guardar, stored ? hashOrig : undefined)
      }
      try { md5 = await attempt(false) } catch (e) {
        // MP3 con el último cuadro cortado justo antes del tag viejo del final (ID3v1): el decodificador lo lee como sonido.
        // Se empieza de nuevo desde el original y se guarda dejando ese tag como estaba (la huella lo verifica de nuevo).
        if (ext !== 'mp3' || !(e instanceof SoundChanged) || !readId3v1(file)) throw e
        fs.copyFileSync(file, w.tmp)
        try { md5 = await attempt(true) } catch (e2) {
          throw new Error(T.id3v1((e2 as Error).message))
        }
      }
    }
    // lo que cambia, guardado y verificado (se rearma el original desde ahí) antes de reemplazar
    fs.mkdirSync(path.dirname(w.delta), { recursive: true })
    const r = await saveDelta(file, w.tmp, w.delta, { fileId, rel: w.rel })
    c.journal.phase(jid, 'respaldo', { pos: r.pos })
    sync(w.tmp)
    replace(w.tmp, file) // nunca queda un archivo a medias
    replaced = true
    return { st: fs.statSync(file), md5, saved: savedOf(w.delta, r.pos, r.bytes, r.header), exact: exactly }
  } catch (e) {
    // el temporal es de PAILA; lo que se haya llegado a guardar en cambios.paila queda ahí sin usar (no se anota)
    if (!replaced) fs.rmSync(w.tmp, { force: true })
    throw e
  } finally {
    await (fromOrig as Promise<string> | null)?.catch(() => {}) // que ffmpeg suelte el original
  }
}

/**
 * Vuelve un archivo a como estaba antes de una escritura, desde lo que guardó el respaldo liviano: se rearma en `tmp` (al
 * lado, en el mismo disco), se compara la huella con la del original y recién ahí reemplaza al archivo. Si el archivo ya no es
 * el que dejó esa escritura, no toca nada y devuelve false.
 */
export async function restoreFrom(delta: string, pos: number, file: string, tmp: string): Promise<boolean> {
  const { header } = readDelta(delta, pos)
  if (fs.statSync(file).size !== header.new.size && !header.entero) return false
  fs.mkdirSync(path.dirname(tmp), { recursive: true })
  try {
    if (await rebuild(delta, file, tmp, pos) !== header.old.sha1) { fs.rmSync(tmp, { force: true }); return false }
    replace(tmp, file)
    return true
  } catch (e) { fs.rmSync(tmp, { force: true }); throw e }
}

/** ¿Es este archivo, byte a byte, el que quedó después de esa escritura (o el de antes)? Para la recuperación al abrir. */
export async function whichVersion(delta: string, pos: number, file: string): Promise<'antes' | 'despues' | null> {
  const { header } = readDelta(delta, pos)
  const n = fs.statSync(file).size
  if (n !== header.old.size && n !== header.new.size) return null
  const h = await fileSha1(file)
  return h === header.new.sha1 ? 'despues' : h === header.old.sha1 ? 'antes' : null
}
