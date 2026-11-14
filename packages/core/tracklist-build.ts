// Armar el tracklist con las ventanas que reconocen temas (core/tracklist.ts): agruparlas en pasadas de cada tema, en qué
// segundo entra cada uno (recorriendo para atrás bloque por bloque), a qué velocidad sonaba, juntar los duplicados de la
// biblioteca y marcar los tramos sin reconocer. Puro.
import { FRAMES_PER_SECOND } from './soundmatch'
import { GAP_S, SAME_PLAY_GAP_S, SAME_START_S, WINDOW, score, type Confidence, type SetHit, type TracklistEntry } from './tracklist'

const anchorOf = (h: SetHit) => h.at - h.pos / h.rate

interface Play { fileId: number; hits: SetHit[] }

/** Las ventanas de un mismo tema que van seguidas (sin un hueco de más de 90 s) son una pasada. */
function plays(hits: SetHit[]): Play[] {
  const by = new Map<number, SetHit[]>()
  for (const h of hits) { const l = by.get(h.fileId); if (l) l.push(h); else by.set(h.fileId, [h]) }
  const out: Play[] = []
  for (const [fileId, hs] of by) {
    hs.sort((a, b) => a.at - b.at)
    let cur: SetHit[] = [hs[0]]
    for (const h of hs.slice(1)) {
      // un hueco largo es otra pasada, salvo que el tema siga en la misma línea de tiempo (un tramo que no se reconoció:
      // un break, un filtro) y no haya pasado más de lo que dura
      const last = cur[cur.length - 1]
      const same = h.at - last.at <= SAME_PLAY_GAP_S || (Math.abs(anchorOf(h) - anchorOf(last)) <= 20 && h.pos > last.pos)
      if (same) cur.push(h); else { out.push({ fileId, hits: cur }); cur = [h] }
    }
    out.push({ fileId, hits: cur })
  }
  return out
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0 }

/**
 * En qué segundo entra el tema: desde la primera ventana que lo reconoce se va para atrás, de a 2 s, mientras el set
 * siga sonando como el tema (alineado como dicen las ventanas). Así sale bien si el DJ lo puso desde el principio (llega
 * a su 0:00) y si salteó la intro (se corta donde antes sonaba otra cosa). `refine` hace ese recorrido (ver
 * `entryPoint`); sin él (o si no puede: la parte que no está en la huella del tema), se usa dónde caería su 0:00 sin
 * pasar de lo que la primera ventana reconoce.
 */
function startOf(p: Play, refine?: Refine): number {
  const fit = speedOf(p)
  const a = fit ? fit.anchor : median(p.hits.slice(0, 3).map(anchorOf))
  const rate = fit ? fit.rate : median(p.hits.slice(0, 3).map((h) => h.rate))
  const first = p.hits[0]
  const heard = first.at + Math.max(0, WINDOW / FRAMES_PER_SECOND - first.matched)
  const r = refine?.(p.fileId, a, rate, first.at, !!first.disc)
  return Math.max(0, r ?? Math.min(a, heard))
}

/**
 * La velocidad a la que sonaba el tema, por cómo avanza dentro del tema de ventana en ventana (con "master tempo" la
 * huella no cambia, pero un tema a +4 % avanza 1,04 s por cada segundo del set). Solo con 3 ventanas o más, en al menos
 * 30 s, que caen en línea (±2 s): un tema muy repetitivo (un loop de techno) se alinea en cualquier parte y no sirve.
 */
function speedOf(p: Play): { rate: number; anchor: number } | null {
  const hs = p.hits.filter((h) => !h.disc)
  if (hs.length < 3 || hs[hs.length - 1].at - hs[0].at < 30) return null
  const n = hs.length, mx = hs.reduce((s, h) => s + h.at, 0) / n, my = hs.reduce((s, h) => s + h.pos, 0) / n
  let sxy = 0, sxx = 0
  for (const h of hs) { sxy += (h.at - mx) * (h.pos - my); sxx += (h.at - mx) ** 2 }
  const rate = sxy / sxx
  if (!(rate >= 0.9 && rate <= 1.1)) return null
  const anchor = mx - my / rate
  if (hs.some((h) => Math.abs(h.pos - (h.at - anchor) * rate) > 2)) return null
  return { rate: Math.round(rate * 1000) / 1000, anchor }
}

/** Recorre para atrás desde `firstAt` (ver `startOf`): devuelve el segundo de entrada, o null si no puede decirlo. */
export type Refine = (fileId: number, anchor: number, rate: number, firstAt: number, disc: boolean) => number | null

/** Cuadros por bloque al buscar la entrada (~2 s). */
const BLOCK = 16

/**
 * El segundo del set en que empieza a sonar el tema: desde el final de la primera ventana que lo reconoce (lo que una
 * ventana reconoce está al final cuando el tema recién entra), para atrás de a bloques de ~2 s, mientras los bits del
 * set y los del tema (en el cuadro que corresponde: `anchor` y `rate`) se parezcan más que "de fondo"; dos bloques
 * seguidos que no, cortan. Si llega al 0:00 del tema, entra ahí. null si la parte a mirar no está en la huella del tema
 * (los primeros 120 s) o no se parece ningún bloque de la ventana.
 */
export function entryPoint(setFp: ArrayLike<number>, trackFp: ArrayLike<number>, anchor: number, rate: number, firstAt: number): number | null {
  const fps = FRAMES_PER_SECOND
  const trackAt = (f: number) => Math.round((f / fps - anchor) * rate * fps) // cuadro del tema que suena en el cuadro f del set
  const simAt = (f: number, shift = 0) => {
    let same = 0, n = 0
    for (let i = 0; i < BLOCK; i++) {
      const t = trackAt(f + i) + shift
      if (t < 0 || t >= trackFp.length || f + i < 0 || f + i >= setFp.length) continue
      same += 32 - popcount((setFp[f + i] ^ trackFp[t]) >>> 0); n++
    }
    return n >= BLOCK / 2 ? same / (32 * n) : NaN
  }
  const from = Math.round(firstAt * fps), end = Math.min(setFp.length, from + WINDOW) - BLOCK
  // el umbral: cuánto se parecen el set y el tema corridos 5–50 s (de fondo), más un margen; el techno se parece "a todo"
  const bg: number[] = []
  for (let d = 40; d <= 400; d += 40) for (const sh of [d, -d]) for (let g = from; g <= end; g += BLOCK * 2) { const v = simAt(g, sh); if (!Number.isNaN(v)) bg.push(v) }
  bg.sort((x, y) => x - y)
  const need = Math.min(0.9, Math.max(0.62, (bg.length ? bg[bg.length >> 1] : 0.55) + 0.1))
  // el último bloque de la ventana que suena como el tema (de ahí para atrás)
  let f = end
  while (f >= from && !(simAt(f) >= need)) f -= BLOCK
  if (f < from) return null
  let start = f, bad = 0
  for (let g = f - BLOCK; g >= 0; g -= BLOCK) {
    if (trackAt(g) < -BLOCK / 2) return Math.max(0, anchor) // llegó al 0:00 del tema: entra ahí
    const v = simAt(g)
    if (Number.isNaN(v)) break
    if (v >= need) { start = g; bad = 0 } else if (++bad >= 2) break
  }
  return start / fps
}

function popcount(x: number): number {
  x -= (x >>> 1) & 0x55555555
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333)
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

/**
 * Seguridad: por cuántas ventanas lo reconocen y cuán claro; un escalón menos si salió de la pasada "como un disco" o si
 * en casi todas sus ventanas suena más claro otro tema.
 */
function confidence(windows: number, contrast: number, disc = false): Confidence {
  const level = windows >= 3 || (windows >= 2 && contrast >= 0.15) ? 2 : windows >= 2 || contrast >= 0.15 ? 1 : 0
  return (['baja', 'media', 'alta'] as const)[Math.max(0, level - (disc ? 1 : 0))]
}

/**
 * Arma el tracklist con las ventanas: una entrada por pasada de cada tema, en orden de entrada; los duplicados de la
 * biblioteca (mismo audio en dos archivos) se juntan en una sola entrada; y los tramos de más de un minuto que no reconoce
 * nada quedan como "sin reconocer". `duration(id)` = cuánto dura cada tema (para saber hasta dónde puede sonar);
 * `setSeconds` = cuánto dura el set.
 */
/**
 * ¿Son el mismo audio dos temas de la biblioteca? `posA` y `posB`: el segundo de cada uno que suena en el mismo momento
 * del set. Sin esto, dos temas que suenan en las mismas ventanas se toman por el mismo (ver `sameWindows`).
 */
export type SameAudio = (a: number, b: number, posA: number, posB: number) => boolean

export function buildTracklist(hits: SetHit[], setSeconds: number, duration: (id: number) => number | null, prefer?: (a: number, b: number) => number, refine?: Refine, sameAudio?: SameAudio): TracklistEntry[] {
  // el que más suena en cada ventana: un tema que casi nunca lo es (otro tema más claro lo tapa en todas sus ventanas, fuera
  // de un cruce) suele ser un parecido de fondo (corrida del 22/10: techno contra techno, a otra velocidad)
  const top = new Map<number, number>()
  for (const h of hits) { const k = Math.round(h.at); top.set(k, Math.max(top.get(k) ?? 0, score(h))) }
  const ps = plays(hits).map((p) => {
    const contrast = Math.max(...p.hits.map((h) => h.contrast))
    const leads = p.hits.filter((h) => score(h) >= 0.9 * top.get(Math.round(h.at))!).length
    return {
      p, disc: p.hits.filter((h) => h.disc).length * 2 > p.hits.length || leads < 0.3 * p.hits.length, start: startOf(p, refine), heardUntil: p.hits[p.hits.length - 1].at + WINDOW / FRAMES_PER_SECOND,
      rate: speedOf(p)?.rate ?? median(p.hits.map((h) => h.rate)), windows: p.hits.length, contrast, weight: p.hits.reduce((s, h) => s + score(h), 0),
    }
  })
  // los más claros primero: los duplicados (mismo momento, otro archivo) se suman al más claro
  ps.sort((a, b) => b.weight - a.weight)
  const entries: TracklistEntry[] = []
  const windowsOf = new Map<TracklistEntry, Map<number, SetHit>>()
  // Dos archivos que suenan en casi las mismas ventanas son el mismo tema (otra edición, el mismo audio con otra intro). En
  // un enganche los dos temas comparten solo las 1–3 ventanas del cruce. Si se puede, se confirma comparando las huellas
  // de los dos temas (corrida del 22/10: un tema de techno y uno de Babasónicos sonaban en las mismas ventanas, flojo).
  const sameWindows = (e: TracklistEntry, p: Play) => {
    const ws = windowsOf.get(e)!, shared = p.hits.filter((h) => ws.has(Math.round(h.at)))
    return shared.length >= 2 && shared.length >= 0.6 * Math.min(ws.size, p.hits.length)
  }
  // las huellas de los dos temas, alineadas como sonaron: el segundo de cada uno en el momento de la ventana más clara de x
  const confirmed = (e: TracklistEntry, p: Play) => {
    if (!sameAudio) return true
    const h = p.hits.reduce((m, y) => (score(y) > score(m) ? y : m))
    const ws = [...windowsOf.get(e)!.values()], o = ws.reduce((m, y) => (Math.abs(y.at - h.at) < Math.abs(m.at - h.at) ? y : m))
    return sameAudio(e.fileId!, p.fileId, o.pos + (h.at - o.at) * o.rate, h.pos)
  }
  for (const x of ps) {
    const twin = entries.find((e) => e.fileId != null && (Math.abs(e.start - x.start) <= SAME_START_S || sameWindows(e, x.p)) && x.p.hits[0].at < e.heardUntil && e.start < x.heardUntil && confirmed(e, x.p))
    if (twin) {
      // el mismo audio en otro archivo: ¿cuál se muestra? el que prefiere quien llama (mejor calidad, la colección Música)
      if (prefer && prefer(x.p.fileId, twin.fileId!) < 0) { twin.alsoIds.push(twin.fileId!); twin.fileId = x.p.fileId } else twin.alsoIds.push(x.p.fileId)
      twin.windows = Math.max(twin.windows, x.windows); twin.heardUntil = Math.max(twin.heardUntil, x.heardUntil)
      twin.confidence = confidence(twin.windows, twin.contrast, x.disc)
      continue
    }
    const e: TracklistEntry = { start: x.start, heardUntil: x.heardUntil, fileId: x.p.fileId, alsoIds: [], rate: x.rate, windows: x.windows, contrast: x.contrast, confidence: confidence(x.windows, x.contrast, x.disc) }
    entries.push(e)
    windowsOf.set(e, new Map(x.p.hits.map((h) => [Math.round(h.at), h])))
  }
  entries.sort((a, b) => a.start - b.start)
  // dos entradas seguidas del mismo tema (el mismo archivo u otro con el mismo audio), a menos de 90 s: una sola pasada
  // (corrida del 22/10: un loop de "85H" salía partido entre el WAV y el MP3)
  for (let i = entries.length - 1; i > 0; i--) {
    const a = entries[i - 1], b = entries[i]
    if (b.start - a.heardUntil > SAME_PLAY_GAP_S || b.start < a.start) continue
    const la = [...windowsOf.get(a)!.values()].at(-1)!, fb = [...windowsOf.get(b)!.values()][0]
    const same = a.fileId === b.fileId || a.alsoIds.includes(b.fileId!) || (sameAudio?.(a.fileId!, b.fileId!, la.pos + (fb.at - la.at) * la.rate, fb.pos) ?? false)
    if (!same) continue
    if (b.fileId !== a.fileId && !a.alsoIds.includes(b.fileId!)) a.alsoIds.push(b.fileId!)
    a.heardUntil = Math.max(a.heardUntil, b.heardUntil); a.windows += b.windows; a.contrast = Math.max(a.contrast, b.contrast)
    a.confidence = confidence(a.windows, a.contrast)
    entries.splice(i, 1)
  }
  // lo que ningún tema cubre: hasta dónde puede sonar cada uno (su duración a la velocidad del set) o hasta que entra otro
  const out: TracklistEntry[] = []
  let covered = 0
  const gap = (from: number, to: number) => {
    if (to - from >= GAP_S) out.push({ start: from, heardUntil: to, fileId: null, alsoIds: [], rate: 1, windows: 0, contrast: 0, confidence: 'baja' })
  }
  for (const e of entries) {
    gap(covered, e.start)
    out.push(e)
    // un dudoso no tapa lo que no se reconoce: cuenta solo hasta donde se lo escuchó
    const len = e.confidence === 'baja' ? null : duration(e.fileId!)
    covered = Math.max(covered, e.heardUntil, len ? e.start + len / e.rate : e.heardUntil)
  }
  gap(covered, setSeconds)
  return out
}
