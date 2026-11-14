// Índice de huellas acústicas: encuentra los temas que suenan igual (o comparten un pedazo) sin comparar todos contra
// todos. Sirve para Duplicados (toda la biblioteca), la Bandeja (un archivo nuevo contra la biblioteca) y reconectar.
//
// Cómo funciona: de cada huella se guardan algunos valores ("claves": sus bits más estables) con su posición. Dos temas
// que suenan igual comparten muchas claves *a la misma distancia* (el corrimiento entre uno y otro); dos temas distintos
// casi nunca. Se eligen las claves por su valor (no por su posición), así el mismo pedazo de audio deja las mismas claves
// aunque un archivo empiece unos segundos antes. Las claves que aparecen en muchísimos temas (silencio, un acorde suelto)
// no sirven para distinguir y se ignoran. Recién los pares con suficientes votos se comparan bit a bit (soundmatch.ts).
import { decodeFingerprint } from './analysis/chromaprint'
import { visible, type Db } from './db'

/**
 * Los 32 bits de cada valor, del más estable al menos estable entre copias del mismo audio en distinta calidad (medido
 * con 45 pares reales de FLAC/MP3: los primeros coinciden el 97 % de las veces, los últimos el 76 %). La clave usa solo
 * los más estables: así dos copias comparten muchas más claves que con el valor entero (en el par más difícil, 7–18 % de
 * los cuadros en vez de 1,7 %).
 */
const STABLE_BITS = [3, 19, 27, 29, 31, 26, 28, 30, 2, 21, 18, 1, 15, 7, 20, 9, 25, 11, 14, 23, 0, 6, 8, 24, 5, 10, 17, 22, 13, 4, 16, 12]
const maskOf = (bits: number) => STABLE_BITS.slice(0, bits).reduce((m, b) => (m | (1 << b)) >>> 0, 0)

/** Una clave que está en más temas que esto no distingue nada (silencio, un tono suelto) y no vota. */
const MAX_SHARED = 24
/** Votos mínimos (claves compartidas al mismo corrimiento, ±1 cuadro) para comparar un par bit a bit. */
export const MIN_VOTES = 4
/** Con menos claves que esto, el tema guarda todas (ver `keysOf`). */
const MIN_KEYS = 40

/**
 * Cuántos bits por clave y qué parte de las claves se guarda, según el tamaño de la biblioteca: con pocos temas conviene
 * una clave corta (más tolerante); con muchos, una más larga (si no, cada clave estaría en cientos de temas y no
 * distinguiría nada) y guardar menos claves por tema (para que el índice entre en memoria).
 */
export function indexParams(tracks: number): { bits: number; sampleBits: number } {
  return { bits: Math.max(18, Math.min(24, Math.round(Math.log2(Math.max(1, tracks) * 200)))), sampleBits: tracks > 30_000 ? 3 : 2 }
}

/** Mezcla los bits de un valor (para elegir claves por contenido y repartirlas en baldes parejos). */
function mix(v: number): number {
  v = Math.imul(v ^ (v >>> 16), 0x45d9f3b)
  v = Math.imul(v ^ (v >>> 16), 0x45d9f3b)
  return (v ^ (v >>> 16)) >>> 0
}

/**
 * Claves de una huella: el valor recortado a los bits estables, elegido por su contenido (1 de cada 2^sampleBits), con
 * su primera posición. Elegir por contenido (y no "uno cada tantos cuadros") hace que el mismo pedazo de audio deje las
 * mismas claves aunque un archivo empiece unos segundos antes.
 *
 * Un tema muy repetitivo (techno minimalista: un loop casi sin armonía) tiene pocos valores distintos y casi no le
 * quedarían claves: se guardan todas, cada una con hasta 4 posiciones (otra copia puede tener la primera vez de un valor
 * uno o dos compases después, y así igual vota al corrimiento bueno).
 */
/** Lugar de trabajo de `keysOf` (uno solo: pedir 8 KB nuevos por tema era un cuarto de lo que tardaba). */
const PACKED = new Float64Array(1024)
export function keysOf(fp: ArrayLike<number>, mask: number, sampleBits: number, perKey = 1): { keys: Uint32Array; pos: Uint16Array } {
  const sample = (1 << sampleBits) - 1
  const n = Math.min(fp.length, 1024)
  const packed = PACKED // clave * 1024 + posición: ordenar deja juntas las repetidas, primero la primera
  let m = 0
  for (let i = 0; i < n; i++) {
    const v = (fp[i] & mask) >>> 0
    if ((mix(v) & sample) === 0) packed[m++] = v * 1024 + i
  }
  const sorted = packed.subarray(0, m).sort()
  const keys = new Uint32Array(m), pos = new Uint16Array(m)
  let k = 0, distinct = 0, same = 0
  for (let i = 0; i < m; i++) {
    const v = Math.floor(sorted[i] / 1024), p = sorted[i] - v * 1024
    if (k && keys[k - 1] === v) {
      // otra posición del mismo valor: solo si se pidieron varias y no es el mismo sonido sostenido (cuadros seguidos)
      if (same >= perKey || p - pos[k - 1] < 8) continue
      same++
    } else { same = 1; distinct++ }
    keys[k] = v; pos[k] = p; k++
  }
  if (distinct < MIN_KEYS && (sampleBits > 0 || perKey === 1)) return keysOf(fp, mask, 0, 4)
  return { keys: keys.subarray(0, k), pos: pos.subarray(0, k) }
}

/** Un par de temas que comparten claves: `offset` = cuántos cuadros más adelante está el audio en B que en A. */
export interface SoundPair { a: number; b: number; offset: number; votes: number }

/**
 * Índice de toda la biblioteca, en arreglos planos: las claves de cada tema en orden de tema (para recorrerlos) y las
 * mismas ordenadas por clave (para buscar). Con 100.000 temas son ~100 MB mientras se busca, y se suelta al terminar.
 */
export class SoundIndex {
  /** id de tema de cada posición interna. */
  readonly ids: Int32Array
  readonly mask: number
  readonly sampleBits: number
  /** Claves de cada tema, en orden de tema: las del tema t van de `from[t]` a `from[t + 1]`. */
  private tKeys: Uint32Array
  private tPos: Uint16Array
  private from: Uint32Array
  /** Las mismas claves ordenadas y, alineado, (tema << 10 | posición). */
  private keys: Uint32Array
  private refs: Uint32Array
  /** Inicio de cada balde (por los bits altos de la mezcla de la clave: `>>> shift`) en `keys`. */
  private starts: Uint32Array
  private shift: number

  private constructor(p: { ids: Int32Array; mask: number; sampleBits: number; tKeys: Uint32Array; tPos: Uint16Array; from: Uint32Array; keys: Uint32Array; refs: Uint32Array; starts: Uint32Array; shift: number }) {
    this.ids = p.ids; this.mask = p.mask; this.sampleBits = p.sampleBits
    this.tKeys = p.tKeys; this.tPos = p.tPos; this.from = p.from; this.keys = p.keys; this.refs = p.refs; this.starts = p.starts; this.shift = p.shift
  }

  get size() { return this.ids.length }
  get postings() { return this.keys.length }

  /** Arma el índice con las huellas comprimidas (texto de AcoustID). Las que no se pueden leer se saltean. */
  static build(entries: Iterable<{ id: number; chromaprint: string }>, params?: { bits: number; sampleBits: number }): SoundIndex {
    const b = SoundIndex.builder(params ?? indexParams(Array.isArray(entries) ? entries.length : 0))
    for (const e of entries) b.add(e)
    return b.finish()
  }

  /** Para armarlo de a poco (por tandas, devolviendo el control entre una y otra): `add` cada huella y al final `finish`. */
  static builder(params: { bits: number; sampleBits: number }) {
    const mask = maskOf(params.bits)
    const ids: number[] = []
    let tKeys = new Uint32Array(1 << 16), tPos = new Uint16Array(1 << 16), n = 0
    const from: number[] = [0]
    const add = (e: { id: number; chromaprint: string }) => {
      let fp: Uint32Array
      try { fp = decodeFingerprint(e.chromaprint) } catch { return }
      if (ids.length >= 1 << 22) return // 4 millones de temas: más de lo que entra en una referencia
      const k = keysOf(fp, mask, params.sampleBits)
      if (n + k.keys.length > tKeys.length) {
        const size = Math.max(tKeys.length * 2, n + k.keys.length)
        const nk = new Uint32Array(size); nk.set(tKeys.subarray(0, n)); tKeys = nk
        const np = new Uint16Array(size); np.set(tPos.subarray(0, n)); tPos = np
      }
      tKeys.set(k.keys, n); tPos.set(k.pos, n); n += k.keys.length
      ids.push(e.id); from.push(n)
    }
    return { add, finish: () => SoundIndex.sorted(params, mask, ids, tKeys.slice(0, n), tPos.slice(0, n), from) }
  }

  private static sorted(params: { sampleBits: number }, mask: number, ids: number[], tKeys: Uint32Array, tPos: Uint16Array, from: number[]): SoundIndex {
    const n = tKeys.length
    // Orden por balde (conteo) y, dentro de cada balde, por clave: deja juntas las claves iguales sin un sort enorme.
    // ~8 claves por balde (entre 256 y 4 millones de baldes, según el tamaño)
    const shift = 32 - Math.max(8, Math.min(22, Math.ceil(Math.log2(Math.max(1, n) / 8))))
    const BUCKETS = 2 ** (32 - shift)
    const starts = new Uint32Array(BUCKETS + 1)
    for (let i = 0; i < n; i++) starts[(mix(tKeys[i]) >>> shift) + 1]++
    for (let b = 0; b < BUCKETS; b++) starts[b + 1] += starts[b]
    const fill = starts.slice(0, BUCKETS)
    const keys = new Uint32Array(n), refs = new Uint32Array(n)
    for (let t = 0; t < ids.length; t++) {
      for (let i = from[t]; i < from[t + 1]; i++) { const at = fill[mix(tKeys[i]) >>> shift]++; keys[at] = tKeys[i]; refs[at] = (t << 10) | tPos[i] }
    }
    for (let b = 0; b < BUCKETS; b++) {
      const s = starts[b], e = starts[b + 1]
      // inserción: los baldes son chicos
      for (let i = s + 1; i < e; i++) {
        const k = keys[i], r = refs[i]
        let j = i - 1
        while (j >= s && keys[j] > k) { keys[j + 1] = keys[j]; refs[j + 1] = refs[j]; j-- }
        keys[j + 1] = k; refs[j + 1] = r
      }
    }
    return new SoundIndex({ ids: Int32Array.from(ids), mask, sampleBits: params.sampleBits, tKeys, tPos, from: Uint32Array.from(from), keys, refs, starts, shift })
  }

  /** Dónde está una clave en el arreglo ordenado: [inicio, fin). */
  private find(key: number): [number, number] {
    const b = mix(key) >>> this.shift
    let lo = this.starts[b], hi = this.starts[b + 1]
    const end = hi
    while (lo < hi) { const m = (lo + hi) >>> 1; if (this.keys[m] < key) lo = m + 1; else hi = m }
    let e = lo
    while (e < end && this.keys[e] === key) e++
    return [lo, e]
  }

  /**
   * Votos de unas claves contra todo el índice: para cada tema que comparte claves, el corrimiento con más votos.
   * `onlyAfter`: solo temas con posición interna mayor (para no contar cada par dos veces).
   */
  private vote(keys: Uint32Array, pos: Uint16Array, minVotes: number, onlyAfter = -1): { t: number; offset: number; votes: number }[] {
    let votes = this.buf, m = 0
    for (let q = 0; q < keys.length; q++) {
      const [lo, hi] = this.find(keys[q])
      if (hi - lo > MAX_SHARED) continue
      for (let x = lo; x < hi; x++) {
        const t = this.refs[x] >>> 10
        if (t <= onlyAfter) continue
        if (m >= votes.length) { const v = new Float64Array(votes.length * 2); v.set(votes); votes = this.buf = v }
        // tema * 4096 + corrimiento (+2048 para que sea positivo): ordenar deja juntos los votos de cada tema
        votes[m++] = t * 4096 + ((this.refs[x] & 1023) - pos[q] + 2048)
      }
    }
    const out: { t: number; offset: number; votes: number }[] = []
    if (m < minVotes) return out
    // Casi todos los temas que aparecen tienen uno o dos votos (claves que coinciden de casualidad) y nunca llegan a
    // `minVotes`: se cuentan los votos de cada tema y se ordenan solo los de los que llegan (ordenar era lo más lento).
    const count = this.counts.length === this.ids.length ? this.counts : (this.counts = new Uint16Array(this.ids.length))
    for (let i = 0; i < m; i++) { const t = Math.floor(votes[i] / 4096); if (count[t] < 65535) count[t]++ }
    const kept = this.kept.length >= m ? this.kept : (this.kept = new Float64Array(votes.length))
    let k = 0
    for (let i = 0; i < m; i++) { const v = votes[i]; if (count[Math.floor(v / 4096)] >= minVotes) kept[k++] = v }
    for (let i = 0; i < m; i++) count[Math.floor(votes[i] / 4096)] = 0
    m = k
    if (m < minVotes) return out
    const s = kept.subarray(0, m).sort()
    let i = 0
    while (i < m) {
      const t = Math.floor(s[i] / 4096), base = t * 4096
      let j = i
      while (j < m && s[j] < base + 4096) j++
      if (j - i >= minVotes) {
        // el corrimiento con más votos contando ±1 cuadro (el redondeo de cada archivo puede caer al lado)
        // (si empatan, el que tiene más votos justo en ese corrimiento)
        let best = 0, bestExact = 0, bestOff = 0, lo = i, hi = i
        for (let x = i; x < j; x++) {
          if (x > i && s[x] === s[x - 1]) continue
          const o = s[x] - base
          while (s[lo] - base < o - 1) lo++
          if (hi < x) hi = x
          while (hi + 1 < j && s[hi + 1] - base <= o + 1) hi++
          let exact = 1
          while (x + exact < j && s[x + exact] === s[x]) exact++
          const c = hi - lo + 1
          if (c > best || (c === best && exact > bestExact)) { best = c; bestExact = exact; bestOff = o - 2048 }
        }
        if (best >= minVotes) out.push({ t, offset: bestOff, votes: best })
      }
      i = j
    }
    return out
  }
  private buf = new Float64Array(4096)
  /** Votos por tema (se vuelve a dejar en cero después de cada consulta) y los votos que quedan para ordenar. */
  private counts = new Uint16Array(0)
  private kept = new Float64Array(0)

  /**
   * Todos los pares de temas que comparten al menos `minVotes` claves al mismo corrimiento (±1 cuadro). Cada par sale una
   * vez, con `a` < `b` en el orden interno. Se recorre tema por tema (no hace falta guardar los votos de todos los pares).
   * No compara bits: eso lo hace quien llama, solo con estos pares.
   */
  pairs(minVotes = MIN_VOTES): SoundPair[] {
    const out: SoundPair[] = []
    for (let t = 0; t < this.ids.length; t++) this.pairsOf(t, minVotes, out)
    return out
  }

  /** Lo mismo, devolviendo el control cada 2.000 temas (para no trabar la app con bibliotecas enormes). */
  async pairsAsync(minVotes = MIN_VOTES, onProgress?: (done: number, total: number) => void, isCancelled?: () => boolean): Promise<SoundPair[]> {
    const out: SoundPair[] = []
    for (let t = 0; t < this.ids.length; t++) {
      if (t % 2000 === 0) { if (isCancelled?.()) return out; onProgress?.(t, this.ids.length); await new Promise((r) => setImmediate(r)) }
      this.pairsOf(t, minVotes, out)
    }
    return out
  }

  /** Los pares del tema t con los que vienen después. */
  private pairsOf(t: number, minVotes: number, out: SoundPair[]) {
    const keys = this.tKeys.subarray(this.from[t], this.from[t + 1]), pos = this.tPos.subarray(this.from[t], this.from[t + 1])
    for (const v of this.vote(keys, pos, minVotes, t)) out.push({ a: t, b: v.t, offset: v.offset, votes: v.votes })
  }

  /** Los temas que comparten claves con una huella de afuera (la Bandeja): índice interno, corrimiento y votos. */
  query(fp: ArrayLike<number>, minVotes = MIN_VOTES): SoundPair[] {
    const k = keysOf(fp, this.mask, this.sampleBits)
    return this.vote(k.keys, k.pos, minVotes).map((v) => ({ a: -1, b: v.t, offset: v.offset, votes: v.votes })).sort((x, y) => y.votes - x.votes)
  }
}

/**
 * Condición SQL de "tema con huella acústica que vale" (alias f = files, a = analysis): Música o Para revisar, visible, y
 * con el análisis hecho sobre el archivo como está hoy. Los sample packs nunca entran.
 */
export const PRINTED = `${visible('f')} AND f.error IS NULL AND f.kind IN ('musica', 'revisar') AND a.chromaprint IS NOT NULL AND a.src_size = f.size AND a.src_mtime = f.mtime`

/**
 * Arma el índice leyendo las huellas de la base de a tandas de 2.000: no hace falta tener el texto de todas en memoria
 * (con 100.000 temas serían ~340 MB) y entre tanda y tanda la app sigue respondiendo.
 */
export async function buildFromDb(db: Db, onProgress?: (done: number, total: number) => void): Promise<SoundIndex> {
  const n = (db.prepare(`SELECT COUNT(*) AS n FROM files f JOIN analysis a ON a.file_id = f.id WHERE ${PRINTED}`).get() as { n: number }).n
  const page = db.prepare(`SELECT f.id, a.chromaprint FROM files f JOIN analysis a ON a.file_id = f.id WHERE ${PRINTED} AND f.id > ? ORDER BY f.id LIMIT 2000`)
  const b = SoundIndex.builder(indexParams(n))
  let last = 0, done = 0
  for (;;) {
    const rows = page.all(last) as { id: number; chromaprint: string }[]
    if (!rows.length) break
    for (const r of rows) b.add(r)
    done += rows.length; last = rows[rows.length - 1].id
    onProgress?.(done, n)
    await new Promise((r) => setImmediate(r)) // una tanda por vuelta: la app sigue respondiendo
  }
  return b.finish()
}

/** La huella entera de un tema, leída de la base (o null si no tiene). */
export function fingerprintOf(db: Db, id: number): Uint32Array | null {
  const r = db.prepare('SELECT chromaprint FROM analysis WHERE file_id = ?').get(id) as { chromaprint: string | null } | undefined
  try { return r?.chromaprint ? decodeFingerprint(r.chromaprint) : null } catch { return null }
}

/** Huellas de la biblioteca para buscar desde afuera (la Bandeja): el índice, y la huella y duración de cada tema. */
export interface LibraryPrints { index: SoundIndex; fingerprint(id: number): Uint32Array | null; duration(id: number): number | null }

let cached: { sig: string; prints: LibraryPrints; checkedAt: number; db: Db } | null = null
/** Mirar si la biblioteca cambió cuesta ~0,7 s con 100.000 temas: se mira como mucho una vez por minuto. */
const RECHECK_MS = 60_000

/**
 * El índice de los temas de la biblioteca que tienen huella. Se guarda mientras la biblioteca no cambie (mismos temas y
 * mismas huellas), así abrir la Bandeja varias veces no lo rearma.
 */
export async function libraryPrints(db: Db): Promise<LibraryPrints> {
  if (cached?.db === db && Date.now() - cached.checkedAt < RECHECK_MS) return cached.prints
  const s = db.prepare(`SELECT COUNT(*) AS n, MAX(a.prints_at) AS p, SUM(f.id) AS ids FROM files f JOIN analysis a ON a.file_id = f.id WHERE ${PRINTED}`).get() as { n: number; p: string | null; ids: number | null }
  const sig = `${db.location() ?? ''}|${s.n}|${s.p}|${s.ids}`
  if (cached?.sig === sig) { cached.checkedAt = Date.now(); return cached.prints }
  const index = await buildFromDb(db)
  const prints: LibraryPrints = {
    index,
    fingerprint: (id) => fingerprintOf(db, id),
    duration: (id) => (db.prepare('SELECT duration FROM files WHERE id = ?').get(id) as { duration: number | null } | undefined)?.duration ?? null,
  }
  cached = { sig, prints, checkedAt: Date.now(), db }
  return prints
}
