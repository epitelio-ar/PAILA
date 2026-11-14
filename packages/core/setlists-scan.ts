// Escuchar un set (core/setlists.ts): buscar en la biblioteca y en los temas de su carpeta (core/tracklist.ts), la segunda
// pasada a otras velocidades donde no reconoce nada, el segundo de entrada de cada tema y lo que no está en la biblioteca
// por internet (AcoustID con la huella del tramo; el reconocedor opcional con un fragmento). No toca la base.
import { spawn } from 'node:child_process'
import { encodeFingerprint } from './analysis/chromaprint'
import type { LibraryPrints } from './soundindex'
import { FRAMES_PER_SECOND, MIN_CONTRAST, bestAlignment } from './soundmatch'
import { titleCore } from './dupnames'
import { chunkedPrints, clock, findHits, score, silentSpans, type SetHit } from './tracklist'
import { entryPoint, type Refine, type SameAudio } from './tracklist-build'
import type { AcoustId } from './online/sources'
import { KeyError } from './online/http'
import type { AudD } from './online/audd'
import type { SetTracklist, TrackInSet } from '@paila/shared/types'
import { textos } from '@paila/shared/idioma'

const T = textos({
  buscando: { es: 'Buscando los temas en tu biblioteca', en: 'Looking for the tracks in your library' },
  velocidades: { es: (de: string, a: string) => `Probando otras velocidades (${de} a ${a})`, en: (de: string, a: string) => `Trying other speeds (${de} to ${a})` },
  faltaClave: { es: 'Para buscar por internet lo que no está en tu biblioteca hace falta la clave de AcoustID (Configuración → Internet).', en: "To look up on the internet what isn't in your library, you need an AcoustID key (Settings → Internet)." },
  reconocedor: { es: 'Reconocedor', en: 'Recognizer' },
  porInternet: { es: (t: string) => `Buscando por internet el tramo de ${t}`, en: (t: string) => `Looking up the part at ${t} on the internet` },
})

/** Velocidades de la segunda pasada (como un disco: cambia el tiempo y la nota), de a 2 %: hasta ±8 %. */
const DISC_SPEEDS = [0.92, 0.94, 0.96, 0.98, 1.02, 1.04, 1.06, 1.08]
/** Cada cuánto se pregunta por internet dentro de un tramo sin reconocer; el reconocedor (AudD) cobra: como mucho 12 por set. */
const PROBE_EVERY_S = 150
const AUDD_MAX = 12
/** Lo que AcoustID tiene que decir para creerle (0 a 1). */
const ACOUSTID_MIN = 0.6

export interface Recognizers { acoustid: AcoustId | null; audd: AudD | null }
export interface Progress { onProgress?: (p: { done: number; total: number; current: string }) => void; isCancelled?: () => boolean }

/**
 * Todas las ventanas del set que reconocen un tema: primero la huella del set tal cual (alcanza para los temas
 * acelerados o frenados hasta ±5 % con "master tempo", que no cambia la nota; estirar la huella a cada velocidad no
 * encontró más en los sets de prueba y sumó errores), y si se pide (`speeds`), donde no reconoce nada, el set vuelto a
 * leer a otras velocidades como un disco (`read`: la huella de un tramo a otra velocidad). Lo usan la app y la corrida
 * supervisada (scripts/tracklist.ts).
 */
export async function scanSet(lib: LibraryPrints, fp: Uint32Array, seconds: number, read: (from: number, seconds: number, speed: number) => Promise<Uint32Array>,
  opts: { exclude?: (id: number) => boolean; speeds?: boolean; rates?: number[]; long?: { fileId: number; fp: Uint32Array; duration: number | null }[]; onStep?: (current: string, done: number) => void; isCancelled?: () => boolean } = {}): Promise<SetHit[]> {
  const step = opts.onStep ?? (() => {})
  // la biblioteca (los primeros 120 s de cada tema) y, si hay, los temas de la carpeta del set escuchados enteros
  const long = opts.long?.length ? chunkedPrints(opts.long) : null
  const search = async (print: Uint32Array, o: { offset?: number; speed?: number; onProgress?: (x: number) => void }) => {
    const got = await findHits(lib, print, { exclude: opts.exclude, rates: opts.rates ?? [], isCancelled: opts.isCancelled, ...o })
    if (long) got.push(...(await findHits(long.lib, print, { isCancelled: opts.isCancelled, ...o, onProgress: undefined })).map(long.toTrack))
    return got
  }
  const hits = await search(fp, { onProgress: (x) => step(T.buscando, Math.round(x * (opts.speeds ? 50 : 100))) })
  if (!opts.speeds) return bestPerWindow(hits)
  // segunda pasada: donde no reconoce nada, el set leído a otras velocidades (un tema acelerado como un disco cambia de nota)
  const spans = silentSpans(hits, seconds)
  let i = 0
  for (const sp of spans) {
    for (const speed of DISC_SPEEDS) {
      if (opts.isCancelled?.()) return hits
      step(T.velocidades(clock(sp.from), clock(sp.to)), 50 + Math.round((50 * i++) / (spans.length * DISC_SPEEDS.length)))
      const part = await read(sp.from, sp.to - sp.from + 15, speed)
      hits.push(...await search(part, { offset: sp.from, speed }))
    }
  }
  return bestPerWindow(hits)
}

/** Una ventana por tema y momento (la biblioteca y la huella entera del mismo tema pueden encontrar la misma). */
function bestPerWindow(hits: SetHit[]): SetHit[] {
  const best = new Map<string, SetHit>()
  for (const h of hits) {
    const k = `${h.fileId}|${Math.round(h.at)}`, o = best.get(k)
    if (!o || score(h) > score(o)) best.set(k, h)
  }
  return [...best.values()].sort((a, b) => a.at - b.at)
}

/**
 * Para buscar el segundo exacto de entrada de cada tema (ver `entryPoint`), con la huella entera si está (`long`); lo de
 * la pasada "como un disco" no se afina.
 */
export function refiner(lib: LibraryPrints, fp: Uint32Array, long?: { fileId: number; fp: Uint32Array }[]): Refine {
  const whole = new Map((long ?? []).map((l) => [l.fileId, l.fp]))
  return (id, anchor, rate, firstAt, disc) => { const t = disc ? null : whole.get(id) ?? lib.fingerprint(id); return t ? entryPoint(fp, t, anchor, rate, firstAt) : null }
}

/**
 * Si dos temas son el mismo: el mismo título (`titleOf`, sin lo que dice la versión), o sus huellas alineadas como sonaron
 * en el set (con la entera si está). Corrida del 22/10: "85h_(Original Mix).wav" y "Trickfinger - 85H [2015].mp3" en un
 * tramo con un loop salían como dos temas.
 */
export function twins(lib: LibraryPrints, long?: { fileId: number; fp: Uint32Array }[], titleOf?: (id: number) => string | null): SameAudio {
  const whole = new Map((long ?? []).map((l) => [l.fileId, l.fp]))
  return (a, b, posA, posB) => {
    const ta = titleOf?.(a), tb = titleOf?.(b)
    if (ta && tb && titleCore(ta) && titleCore(ta) === titleCore(tb)) return true
    const x = whole.get(a) ?? lib.fingerprint(a), y = whole.get(b) ?? lib.fingerprint(b)
    if (!x || !y) return false
    const al = bestAlignment(x, y, Math.round((posB - posA) * FRAMES_PER_SECOND))
    return al.contrast >= MIN_CONTRAST && al.matched >= 10 * FRAMES_PER_SECOND
  }
}

/**
 * Los tramos sin reconocer, por internet. Un tramo largo puede tener varios temas: se pregunta cada 2 minutos y medio
 * (AcoustID con la huella de los 2 minutos que siguen; si no contesta, el reconocedor con 15 s de audio, como mucho 12
 * por set porque cobra por pedido). Lo mismo dos veces seguidas es el mismo tema. Una clave que no anda corta ese servicio.
 */
export async function recognizeGaps(entries: TrackInSet[], fp: Uint32Array, path: string, ffmpeg: string, rec: Recognizers, prog: Progress): Promise<{ entries: TrackInSet[]; info: NonNullable<SetTracklist['internet']> }> {
  if (!entries.some((e) => e.source == null)) return { entries, info: { asked: 0, found: 0, note: null } }
  if (!rec.acoustid && !rec.audd) return { entries, info: { asked: 0, found: 0, note: T.faltaClave } }
  let acoustid = rec.acoustid, audd = rec.audd
  let asked = 0, found = 0, auddLeft = AUDD_MAX, note: string | null = null
  const fail = (who: 'AcoustID' | 'Reconocedor', err: unknown) => {
    note = `${who === 'Reconocedor' ? T.reconocedor : who}: ${(err as Error).message}`
    if (err instanceof KeyError) { if (who === 'AcoustID') acoustid = null; else audd = null }
  }
  /** Qué tema suena en el segundo `t` del set (o null). */
  const probe = async (t: number, until: number): Promise<{ artist: string; title: string; source: 'acoustid' | 'audd'; confidence: TrackInSet['confidence'] } | null> => {
    if (acoustid) {
      const a = Math.round(t * FRAMES_PER_SECOND), b = Math.min(fp.length, a + Math.round(Math.min(120, until - t) * FRAMES_PER_SECOND))
      if (b - a >= 20 * FRAMES_PER_SECOND) {
        try {
          asked++
          const res = await acoustid.lookup(encodeFingerprint(fp.subarray(a, b)), (b - a) / FRAMES_PER_SECOND)
          const best = res.filter((r) => r.score >= ACOUSTID_MIN && r.recordings.length).sort((x, y) => y.score - x.score)[0]
          const r = best?.recordings[0]
          if (r) return { artist: r.credit.map((c) => c.name + c.join).join('').trim(), title: r.title, source: 'acoustid', confidence: best.score >= 0.85 ? 'alta' : 'media' }
        } catch (err) { fail('AcoustID', err) }
      }
    }
    if (audd && auddLeft > 0) {
      auddLeft--; asked++
      try {
        const clip = await clipAt(ffmpeg, path, Math.min(t + 30, until - 15))
        const r = clip ? await audd.recognize(clip) : null
        if (r) return { artist: r.artist, title: r.title, source: 'audd', confidence: 'media' }
      } catch (err) { fail('Reconocedor', err) }
    }
    return null
  }
  const out: TrackInSet[] = []
  for (const e of entries) {
    if (e.source != null || prog.isCancelled?.() || (!acoustid && !audd)) { out.push(e); continue }
    prog.onProgress?.({ done: 0, total: 0, current: T.porInternet(clock(e.start)) })
    const named: TrackInSet[] = []
    let rest: TrackInSet | null = { ...e } // lo que queda sin reconocer al final del tramo
    for (let t = e.start; t < e.until - 20; t += PROBE_EVERY_S) {
      const got = await probe(t, e.until)
      const last = named[named.length - 1]
      if (got && last && last.artist === got.artist && last.title === got.title) { last.until = Math.min(e.until, t + PROBE_EVERY_S); continue }
      if (!got) { if (last && last.until >= t) last.until = t; continue }
      found++
      if (last) last.until = Math.min(last.until, t)
      named.push({ ...e, start: t, until: Math.min(e.until, t + PROBE_EVERY_S), source: got.source, fileId: null, artist: got.artist, title: got.title, confidence: got.confidence, windows: 0 })
    }
    if (named.length) {
      // lo que no se reconoció entre medio (más de un minuto) sigue como tramo sin reconocer
      const filled: TrackInSet[] = []
      let at = e.start
      for (const n of named) { if (n.start - at >= 60) filled.push({ ...e, start: at, until: n.start }); filled.push(n); at = n.until }
      rest = e.until - at >= 60 ? { ...e, start: at } : null
      out.push(...filled)
      if (rest) out.push(rest)
    } else out.push(e)
  }
  return { entries: out, info: { asked, found, note } }
}

/** 15 s del set desde el segundo `start`, en MP3 mono chico (para el reconocedor). */
export function clipAt(ffmpeg: string, file: string, start: number): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const p = spawn(ffmpeg, ['-v', 'error', '-nostdin', '-ss', String(Math.max(0, Math.floor(start))), '-t', '15', '-i', file, '-vn', '-ac', '1', '-ar', '22050', '-b:a', '64k', '-f', 'mp3', 'pipe:1'], { windowsHide: true })
    const chunks: Buffer[] = []
    p.stdout.on('data', (c: Buffer) => chunks.push(c))
    p.on('error', () => resolve(null))
    p.on('close', (code) => { const b = Buffer.concat(chunks); resolve(code === 0 && b.length > 1000 ? new Uint8Array(b) : null) })
  })
}
