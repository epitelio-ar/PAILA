// Solo para los tests: arma un export.pdb y archivos ANLZ chiquitos con la estructura de Rekordbox, para probar los lectores
// de core/pdb.ts y core/anlz.ts sin un pendrive de verdad. PAILA no arma pendrives (MASTERPLAN-3, 4: queda afuera).

export interface FxTrack { id: number; title: string; artistId: number; albumId?: number; genreId?: number; keyId?: number; path: string; analyze?: string; size: number; seconds: number; bpm: number; rating?: number; color?: number; isrc?: string }
export interface FxList { id: number; parent: number; name: string; folder?: boolean; sort: number; tracks?: number[] }
export interface FxPdb {
  tracks: FxTrack[]
  artists: { id: number; name: string; far?: boolean }[]
  albums?: { id: number; name: string; far?: boolean }[]
  genres?: { id: number; name: string }[]
  keys?: { id: number; name: string }[]
  lists: FxList[]
  /** Filas borradas (presentes en la página pero con su marca apagada) en la tabla de temas. */
  deletedTrack?: FxTrack
  /** Filas por página de datos (para probar varias páginas encadenadas). */
  perPage?: number
}

const PAGE = 4096

/** Un texto de DeviceSQL: ASCII corto si se puede, si no UTF-16. */
export function dstr(s: string): Uint8Array {
  if (/^[\x20-\x7e]*$/.test(s) && s.length < 126) return Uint8Array.from([((s.length + 1) << 1) | 1, ...[...s].map((c) => c.charCodeAt(0))])
  const body = Buffer.from(s, 'utf16le')
  const out = new Uint8Array(4 + body.length)
  out[0] = 0x90; out[1] = (body.length + 4) & 0xff; out[2] = (body.length + 4) >> 8
  out.set(body, 4)
  return out
}

class Bytes {
  b: number[] = []
  u1(x: number) { this.b.push(x & 0xff); return this }
  u2(x: number) { this.b.push(x & 0xff, (x >> 8) & 0xff); return this }
  u4(x: number) { for (let i = 0; i < 4; i++) this.b.push((x >>> (8 * i)) & 0xff); return this }
  raw(x: Uint8Array) { this.b.push(...x); return this }
  at(o: number, x: number, n: 2 | 4) { for (let i = 0; i < n; i++) this.b[o + i] = (x >>> (8 * i)) & 0xff }
  get length() { return this.b.length }
}

function trackRow(t: FxTrack): Uint8Array {
  const r = new Bytes()
  r.u2(0x24).u2(0).u4(0).u4(44100).u4(0).u4(t.size).u4(0).u2(0).u2(0).u4(0).u4(t.keyId ?? 0).u4(0).u4(0).u4(0).u4(320).u4(1)
    .u4(Math.round(t.bpm * 100)).u4(t.genreId ?? 0).u4(t.albumId ?? 0).u4(t.artistId).u4(t.id).u2(1).u2(3).u2(2020).u2(16).u2(t.seconds).u2(0x29)
    .u1(t.color ?? 0).u1(t.rating ?? 0).u2(1).u2(0)
  const strings: string[] = Array(21).fill('')
  strings[0] = t.isrc ?? ''; strings[14] = t.analyze ?? ''; strings[17] = t.title; strings[19] = t.path.split('/').pop()!; strings[20] = t.path
  const ofs = r.length
  for (let i = 0; i < 21; i++) r.u2(0)
  strings.forEach((s, i) => { r.at(ofs + 2 * i, r.length, 2); r.raw(dstr(s)) })
  return Uint8Array.from(r.b)
}

const artistRow = (a: { id: number; name: string; far?: boolean }) => (a.far
  ? Uint8Array.from(new Bytes().u2(0x64).u2(0).u4(a.id).u1(3).u1(0).u2(12).raw(dstr(a.name)).b)
  : Uint8Array.from(new Bytes().u2(0x60).u2(0).u4(a.id).u1(3).u1(10).raw(dstr(a.name)).b))
const albumRow = (a: { id: number; name: string; far?: boolean }) => (a.far
  ? Uint8Array.from(new Bytes().u2(0x84).u2(0).u4(0).u4(0).u4(a.id).u4(0).u1(3).u1(0).u2(24).raw(dstr(a.name)).b)
  : Uint8Array.from(new Bytes().u2(0x80).u2(0).u4(0).u4(0).u4(a.id).u4(0).u1(3).u1(22).raw(dstr(a.name)).b))
const idName = (id: number, name: string) => Uint8Array.from(new Bytes().u4(id).raw(dstr(name)).b)
const keyRow = (id: number, name: string) => Uint8Array.from(new Bytes().u4(id).u4(id).raw(dstr(name)).b)
const listRow = (l: FxList) => Uint8Array.from(new Bytes().u4(l.parent).u4(0).u4(l.sort).u4(l.id).u4(l.folder ? 1 : 0).raw(dstr(l.name)).b)
const entryRow = (i: number, track: number, list: number) => Uint8Array.from(new Bytes().u4(i).u4(track).u4(list).b)

/** Una página de datos con sus filas (las de `deleted` quedan con la marca apagada). */
function dataPage(index: number, type: number, next: number, rows: Uint8Array[], deleted = new Set<number>()): Uint8Array {
  const p = new Uint8Array(PAGE)
  const v = new DataView(p.buffer)
  v.setUint32(4, index, true); v.setUint32(8, type, true); v.setUint32(12, next, true)
  p[0x18] = rows.length; p[0x1b] = 0x34
  v.setUint16(0x22, rows.length, true)
  let heap = 0
  rows.forEach((row, i) => {
    p.set(row, 0x28 + heap)
    const g = Math.floor(i / 16), base = PAGE - g * 0x24
    v.setUint16(base - 6 - 2 * (i % 16), heap, true)
    if (!deleted.has(i)) v.setUint16(base - 4, v.getUint16(base - 4, true) | (1 << (i % 16)), true)
    heap += row.length + ((4 - (row.length % 4)) % 4)
  })
  if (0x28 + heap > PAGE - Math.ceil(rows.length / 16) * 0x24) throw new Error('fixture: la página no alcanza')
  return p
}
function indexPage(index: number, type: number, next: number): Uint8Array {
  const p = new Uint8Array(PAGE)
  const v = new DataView(p.buffer)
  v.setUint32(4, index, true); v.setUint32(8, type, true); v.setUint32(12, next, true)
  p[0x1b] = 0x64; v.setUint16(0x22, 0x1fff, true)
  return p
}

/** Arma el export.pdb: cada tabla con su página de índice y sus páginas de datos encadenadas. */
export function buildPdb(fx: FxPdb): Uint8Array {
  const per = fx.perPage ?? 20
  const tables: [number, Uint8Array[], Set<number>?][] = []
  const trackRows = fx.tracks.map(trackRow)
  const deleted = new Set<number>()
  if (fx.deletedTrack) { deleted.add(trackRows.length); trackRows.push(trackRow(fx.deletedTrack)) }
  tables.push([0, trackRows, deleted])
  tables.push([1, (fx.genres ?? []).map((g) => idName(g.id, g.name))])
  tables.push([2, fx.artists.map(artistRow)])
  tables.push([3, (fx.albums ?? []).map(albumRow)])
  tables.push([5, (fx.keys ?? []).map((k) => keyRow(k.id, k.name))])
  tables.push([7, fx.lists.map(listRow)])
  // las entradas desordenadas a propósito: el orden lo da el número de entrada
  tables.push([8, fx.lists.flatMap((l) => (l.tracks ?? []).map((t, i) => entryRow(i, t, l.id))).reverse()])
  const pages: Uint8Array[] = [new Uint8Array(PAGE)]
  const where: [number, number, number][] = []
  for (const [type, rows, del] of tables) {
    const first = pages.length
    // de a `per` filas por página, o menos si no entran (los temas con rutas largas ocupan mucho)
    const chunks: Uint8Array[][] = []
    const fits = (c: Uint8Array[]) => 0x28 + c.reduce((a, r) => a + r.length + 3, 0) + Math.ceil(c.length / 16) * 0x24 <= PAGE
    for (const r of rows) {
      const last = chunks[chunks.length - 1]
      if (last && last.length < per && fits([...last, r])) last.push(r); else chunks.push([r])
    }
    pages.push(indexPage(first, type, chunks.length ? first + 1 : first))
    let from = 0
    chunks.forEach((c, i) => {
      const idx = pages.length
      const d = new Set([...(del ?? [])].filter((x) => x >= from && x < from + c.length).map((x) => x - from))
      pages.push(dataPage(idx, type, i === chunks.length - 1 ? 0 : idx + 1, c, d))
      from += c.length
    })
    where.push([type, first, pages.length - 1])
  }
  const h = new DataView(pages[0].buffer)
  h.setUint32(4, PAGE, true); h.setUint32(8, where.length, true); h.setUint32(12, pages.length, true)
  where.forEach(([type, first, last], i) => { const o = 0x1c + i * 16; h.setUint32(o, type, true); h.setUint32(o + 8, first, true); h.setUint32(o + 12, last, true) })
  const out = new Uint8Array(pages.length * PAGE)
  pages.forEach((p, i) => out.set(p, i * PAGE))
  return out
}

// ---------- ANLZ (big endian) ----------

class Be {
  b: number[] = []
  u1(x: number) { this.b.push(x & 0xff); return this }
  u2(x: number) { this.b.push((x >> 8) & 0xff, x & 0xff); return this }
  u4(x: number) { for (let i = 3; i >= 0; i--) this.b.push((x >>> (8 * i)) & 0xff); return this }
  tag(s: string) { for (const c of s) this.b.push(c.charCodeAt(0)); return this }
  raw(x: ArrayLike<number>) { this.b.push(...Array.from(x)); return this }
}

export interface FxCue { hot: number; loop?: boolean; ms: number; loopMs?: number; name?: string; rgb?: [number, number, number] }

/** Un ANLZ0000.DAT (grilla y cues viejos) o .EXT (cues con nombre y color). `beats`: [número de golpe 1–4, BPM, ms]. */
export function buildAnlz(o: { beats?: [number, number, number][]; cues?: FxCue[]; ext?: boolean }): Uint8Array {
  const secs: number[][] = []
  if (o.beats) {
    const s = new Be().tag('PQTZ').u4(24).u4(24 + o.beats.length * 8).u4(0).u4(0x80000).u4(o.beats.length)
    for (const [n, bpm, ms] of o.beats) s.u2(n).u2(Math.round(bpm * 100)).u4(ms)
    secs.push(s.b)
  }
  if (o.cues && !o.ext) {
    const entries = o.cues.map((c) => new Be().tag('PCPT').u4(28).u4(56).u4(c.hot).u4(4).u4(0x10000).u2(0xffff).u2(0xffff).u1(c.loop ? 2 : 1).u1(0).u2(1000).u4(c.ms).u4(c.loopMs ?? 0xffffffff).raw(new Array(16).fill(0)).b)
    const s = new Be().tag('PCOB').u4(24).u4(24 + entries.reduce((a, e) => a + e.length, 0)).u4(1).u2(0).u2(entries.length).u4(0xffffffff)
    for (const e of entries) s.raw(e)
    secs.push(s.b)
  }
  if (o.cues && o.ext) {
    const entries = o.cues.map((c) => {
      const name = c.name ? [...Buffer.from(c.name + '\0', 'utf16le')] : []
      // UTF-16 big endian: dar vuelta cada par
      for (let i = 0; i < name.length; i += 2) [name[i], name[i + 1]] = [name[i + 1], name[i]]
      const body = new Be().u4(c.hot).u1(c.loop ? 2 : 1).u1(0).u1(0).u1(0).u4(c.ms).u4(c.loopMs ?? 0xffffffff).u1(0).raw(new Array(7).fill(0)).u2(0).u2(0)
        .u4(name.length).raw(name).u1(c.rgb ? 1 : 0).u1(c.rgb?.[0] ?? 0).u1(c.rgb?.[1] ?? 0).u1(c.rgb?.[2] ?? 0).raw(new Array(4).fill(0))
      return new Be().tag('PCP2').u4(16).u4(12 + body.b.length).raw(body.b).b
    })
    const s = new Be().tag('PCO2').u4(20).u4(20 + entries.reduce((a, e) => a + e.length, 0)).u4(1).u2(entries.length).u2(0)
    for (const e of entries) s.raw(e)
    secs.push(s.b)
  }
  const len = 28 + secs.reduce((a, s) => a + s.length, 0)
  const f = new Be().tag('PMAI').u4(28).u4(len).raw(new Array(16).fill(0))
  for (const s of secs) f.raw(s)
  return Uint8Array.from(f.b)
}
