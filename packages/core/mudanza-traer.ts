// "Pasar a otra compu", la vuelta: abre el archivo de "Exportar todo" en esta compu, busca cada tema en su carpeta nueva
// (otra ruta, otro disco u otro sistema: separadores, mayúsculas y acentos escritos distinto) y arma la base. No toca
// ningún archivo de música: solo lee las carpetas y escribe la base de PAILA. La ida está en core/mudanza.ts.
import fs from 'node:fs'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { MudanzaEmparejado } from '@paila/shared/types/mudanza'
import { openDb, transaction } from './db'
import { walkAudio } from './files'
import { kindFor, type Rule } from './collections'
import { labelOf, mountOf, serialOf } from './volumes'
import { AJUSTES_CON_RUTA, abrirMudanza, contar } from './mudanza'

export interface EnDisco { rel: string; size: number; mtime: number }
export interface Exportado extends EnDisco { id: number; /** Ya estaba desaparecido en la otra compu. */ falta?: boolean }
export type Como = 'ruta' | 'mayusculas' | 'nombre' | 'fecha'
export interface Enlace extends EnDisco { id: number; como: Como; antes: EnDisco }
export interface Plan { resumen: MudanzaEmparejado; enlaces: Enlace[] }

/** La misma ruta escrita en Windows o en Mac: el Mac guarda los acentos descompuestos (NFD) y no distingue mayúsculas. */
const clave = (rel: string) => rel.normalize('NFC').toLowerCase()
const nombre = (rel: string) => clave(rel.slice(rel.lastIndexOf('/') + 1))
/** Copiar de un disco a otro puede redondear la fecha (FAT, exFAT: 2 segundos). */
const MISMA_FECHA_MS = 2000

/**
 * Empareja los temas de una carpeta exportada con los archivos de su carpeta nueva, de lo más seguro a lo menos: la misma
 * ruta; la misma ruta con otras mayúsculas o acentos; el mismo tamaño y nombre en otra subcarpeta; el mismo tamaño y fecha
 * con otro nombre. Lo dudoso (dos candidatos iguales) no se engancha: queda "desaparecido" y el primer escaneo lo busca
 * por la huella del sonido (core/scan.ts). Puro.
 */
export function emparejar(rootId: number, carpeta: string, exportados: Exportado[], enDisco: EnDisco[]): Plan {
  const enlaces: Enlace[] = []
  const tomado = new Set<EnDisco>()
  let quedan = exportados
  const unir = (e: Exportado, d: EnDisco, como: Como) => { tomado.add(d); enlaces.push({ id: e.id, rel: d.rel, size: d.size, mtime: d.mtime, como, antes: { rel: e.rel, size: e.size, mtime: e.mtime } }) }
  /** Un paso: une cada exportado con el único archivo libre que le corresponde, si ningún otro exportado lo quiere. */
  const paso = (como: Como, deE: (e: Exportado) => string | null, deD: (d: EnDisco) => string | null, igual: (e: Exportado, d: EnDisco) => boolean = () => true) => {
    const libres = new Map<string, EnDisco[]>()
    for (const d of enDisco) { if (tomado.has(d)) continue; const k = deD(d); if (k != null) libres.set(k, [...(libres.get(k) ?? []), d]) }
    const pedidos = new Map<EnDisco, number>()
    const elegido = new Map<Exportado, EnDisco>()
    for (const e of quedan) {
      const k = deE(e)
      const c = k == null ? [] : (libres.get(k) ?? []).filter((d) => igual(e, d))
      if (c.length !== 1) continue
      elegido.set(e, c[0]); pedidos.set(c[0], (pedidos.get(c[0]) ?? 0) + 1)
    }
    for (const [e, d] of elegido) if (pedidos.get(d) === 1) unir(e, d, como)
    quedan = quedan.filter((e) => !(elegido.has(e) && pedidos.get(elegido.get(e)!) === 1))
  }
  paso('ruta', (e) => e.rel, (d) => d.rel)
  paso('mayusculas', (e) => clave(e.rel), (d) => clave(d.rel))
  paso('nombre', (e) => `${e.size}|${nombre(e.rel)}`, (d) => `${d.size}|${nombre(d.rel)}`)
  paso('fecha', (e) => String(e.size), (d) => String(d.size), (e, d) => Math.abs(e.mtime - d.mtime) <= MISMA_FECHA_MS)
  const cuantos = (c: Como) => enlaces.filter((x) => x.como === c).length
  return {
    enlaces,
    resumen: {
      rootId, carpeta,
      porRuta: cuantos('ruta'), porMayusculas: cuantos('mayusculas'), porNombre: cuantos('nombre'), porFecha: cuantos('fecha'),
      faltan: quedan.length,
      yaFaltaban: quedan.filter((e) => e.falta).length,
      ejemplosFaltan: quedan.slice(0, 20).map((e) => e.rel),
      nuevos: enDisco.length - tomado.size,
      cambiados: enlaces.filter((x) => x.size !== x.antes.size).length,
    },
  }
}

/** Busca en `carpeta` los temas de esa carpeta del archivo exportado (solo lee la carpeta). */
export async function emparejarCarpeta(file: string, rootId: number, carpeta: string, onDir?: (rel: string) => void): Promise<Plan> {
  if (!fs.existsSync(carpeta)) throw new Error(`No se encontró la carpeta ${carpeta}.`)
  const db = abrirMudanza(file)
  let exportados: Exportado[]
  let rules: Rule[]
  try {
    exportados = (db.prepare('SELECT id, rel_path AS rel, size, mtime, missing_at IS NOT NULL AS falta FROM files WHERE root_id = ? AND trashed_at IS NULL AND excluded_at IS NULL').all(rootId) as unknown as Exportado[])
      .map((r) => ({ id: Number(r.id), rel: r.rel, size: Number(r.size), mtime: Number(r.mtime), falta: !!Number(r.falta) }))
    rules = db.prepare('SELECT rel_prefix AS rel, kind FROM rules WHERE root_id = ? ORDER BY rel_prefix').all(rootId) as unknown as Rule[]
  } finally { db.close() }
  const enDisco: EnDisco[] = []
  for await (const f of walkAudio(carpeta, (rel) => kindFor(rel, rules) === 'excluir', () => { /* lo que no se pudo leer queda como "falta" */ }, onDir)) {
    enDisco.push({ rel: f.rel, size: f.size, mtime: f.mtime })
  }
  return emparejar(rootId, carpeta, exportados, enDisco)
}

export interface Traida {
  /** Lo que recordaba la ventana de la otra compu (se pone al abrir). */
  ventana: Record<string, string>
  estilo: string | null
  tapas: number
  /** Ajustes con una ruta que en esta compu no existe (se sacan). */
  rutasQuitadas: string[]
}

/** Las tablas que guardan la fecha del archivo con la que se calcularon: si el archivo es el mismo, se corren con él. */
const CON_FECHA = [
  'UPDATE analysis SET src_mtime = ?1 WHERE file_id = ?3 AND src_mtime = ?2 AND src_size = ?4',
  'UPDATE analysis SET audio_mtime = ?1 WHERE file_id = ?3 AND ABS(audio_mtime - ?2) < 1 AND audio_size = ?4',
  'UPDATE file_isrc SET mtime = ?1 WHERE file_id = ?3 AND mtime = ?2 AND size = ?4',
  'UPDATE file_djtag SET mtime = ?1 WHERE file_id = ?3 AND mtime = ?2 AND size = ?4',
  'UPDATE set_prints SET src_mtime = ?1 WHERE file_id = ?3 AND src_mtime = ?2 AND src_size = ?4',
  'UPDATE long_prints SET src_mtime = ?1 WHERE file_id = ?3 AND src_mtime = ?2 AND src_size = ?4',
]

/**
 * Arma en `out` la base de esta compu a partir del archivo exportado y de lo encontrado en cada carpeta (`planes`). Las
 * carpetas sin plan quedan como un disco desconectado, con todo lo suyo. `conservar`: ajustes de esta PAILA que se quedan
 * (sus claves, que sí sirven en esta compu). `tapas`: la carpeta de tapas de esta PAILA (no pisa las que ya están).
 */
export async function armarTraida(file: string, out: string, planes: Plan[], opts: { conservar?: { key: string; value: string }[]; tapas?: string; existe?: (p: string) => boolean } = {}): Promise<Traida> {
  const existe = opts.existe ?? fs.existsSync
  const carpetas = planes.map((p) => path.resolve(p.resumen.carpeta))
  const norm = (s: string) => clave(s.split(/[\\/]+/).filter(Boolean).join('/'))
  carpetas.forEach((a, i) => carpetas.forEach((b, j) => {
    if (i !== j && (norm(a) === norm(b) || norm(a).startsWith(norm(b) + '/'))) throw new Error(`Dos carpetas de la otra compu apuntan al mismo lugar (${a}). Elegí una distinta para cada una, o dejá una sin traer.`)
  }))
  const discos = await Promise.all(carpetas.map(async (c) => ({ mount: mountOf(c), serial: serialOf(c), label: await labelOf(c) })))
  fs.rmSync(out, { force: true })
  fs.copyFileSync(file, out)
  const db = openDb(out) // si el archivo es de una PAILA más vieja, acá se pone al día
  try {
    const meta = new Map((db.prepare('SELECT key, value FROM mudanza').all() as { key: string; value: string }[]).map((r) => [r.key, r.value]))
    const r: Traida = { ventana: {}, estilo: meta.get('estilo') ?? null, tapas: 0, rutasQuitadas: [] }
    try { r.ventana = JSON.parse(meta.get('ventana') ?? '{}') as Record<string, string> } catch { /* sin datos de la ventana */ }
    const now = new Date().toISOString()
    transaction(db, () => {
      planes.forEach((p, i) => {
        const d = discos[i]
        db.prepare('INSERT INTO volumes (serial, label, last_mount) VALUES (?, ?, ?) ON CONFLICT(serial) DO UPDATE SET label = excluded.label, last_mount = excluded.last_mount').run(d.serial, d.label, d.mount)
        const vol = (db.prepare('SELECT id FROM volumes WHERE serial = ?').get(d.serial) as { id: number }).id
        db.prepare('UPDATE roots SET volume_id = ?, rel_path = ? WHERE id = ?').run(vol, `\u0000${p.resumen.rootId}`, p.resumen.rootId)
      })
      planes.forEach((p, i) => db.prepare('UPDATE roots SET rel_path = ? WHERE id = ?').run(path.relative(discos[i].mount, carpetas[i]), p.resumen.rootId))
      db.exec('DELETE FROM volumes WHERE id NOT IN (SELECT volume_id FROM roots)')
      const enlaces = planes.flatMap((p) => p.enlaces)
      // dos pasos, así un tema que toma la ruta que tenía otro no choca con él (UNIQUE root_id, rel_path)
      const aparte = db.prepare("UPDATE files SET rel_path = char(0) || id WHERE id = ?")
      for (const e of enlaces) if (e.rel !== e.antes.rel) aparte.run(e.id)
      const poner = db.prepare('UPDATE files SET rel_path = ?, missing_at = NULL WHERE id = ?')
      for (const e of enlaces) poner.run(e.rel, e.id)
      // mismo tamaño y otra fecha (lo copiaron sin conservarla): el mismo archivo, sin volver a analizarlo
      const corridos = CON_FECHA.map((sql) => db.prepare(sql))
      const fecha = db.prepare('UPDATE files SET mtime = ? WHERE id = ?')
      for (const e of enlaces) {
        if (e.size !== e.antes.size || e.mtime === e.antes.mtime) continue
        fecha.run(e.mtime, e.id)
        for (const st of corridos) st.run(e.mtime, e.antes.mtime, e.id, e.size)
      }
      const vistos = new Set(enlaces.map((e) => e.id))
      const falta = db.prepare('UPDATE files SET missing_at = ? WHERE id = ? AND missing_at IS NULL')
      for (const p of planes) {
        for (const f of db.prepare('SELECT id FROM files WHERE root_id = ? AND trashed_at IS NULL AND excluded_at IS NULL').all(p.resumen.rootId) as { id: number }[]) {
          if (!vistos.has(Number(f.id))) falta.run(now, f.id)
        }
      }
      for (const k of AJUSTES_CON_RUTA) {
        const v = (db.prepare('SELECT value FROM settings WHERE key = ?').get(k) as { value: string } | undefined)?.value
        if (v != null && !existe(v)) { db.prepare('DELETE FROM settings WHERE key = ?').run(k); r.rutasQuitadas.push(k) }
      }
      const ins = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
      for (const s of opts.conservar ?? []) ins.run(s.key, s.value)
    })
    if (opts.tapas) {
      for (const t of db.prepare('SELECT rel, data FROM mudanza_tapas').all() as { rel: string; data: Uint8Array }[]) {
        const dest = path.join(opts.tapas, ...t.rel.split('/').filter((s) => s && s !== '..'))
        if (fs.existsSync(dest)) continue
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.writeFileSync(dest, t.data)
        r.tapas++
      }
    }
    db.exec('DROP TABLE mudanza; DROP TABLE mudanza_tapas;')
    return r
  } finally { db.close() }
}

/** Lo que tiene ahora una PAILA (para no pisarlo sin preguntar). */
export function destinoDe(db: DatabaseSync) {
  const c = contar(db)
  return { temas: c.temas, playlists: c.playlists, historial: c.historial }
}

export const TRAIDA = 'traida.db'
export const TRAIDA_VENTANA = 'traida-ventana.json'

/**
 * Al abrir PAILA, antes de abrir la base: si quedó una base traída de otra compu, la pone en su lugar. La de antes no se
 * borra: va a `respaldos/` con su diario (-wal, -shm), aparte del respaldo que se hizo antes de traer. Devuelve si cambió.
 */
export function ponerTraida(userData: string): boolean {
  const nueva = path.join(userData, TRAIDA)
  if (!fs.existsSync(nueva)) return false
  const base = path.join(userData, 'paila.db')
  const dir = path.join(userData, 'respaldos')
  fs.mkdirSync(dir, { recursive: true })
  const sello = new Date().toISOString().replace(/[:.]/g, '-')
  const movidos: [string, string][] = []
  try {
    for (const suf of ['', '-wal', '-shm']) {
      const aparte = path.join(dir, `paila_${sello}_reemplazada-al-traer.db${suf}`)
      if (fs.existsSync(base + suf)) { fs.renameSync(base + suf, aparte); movidos.push([base + suf, aparte]) }
    }
    fs.renameSync(nueva, base)
  } catch (e) {
    for (const [de, a] of movidos) try { fs.renameSync(a, de) } catch { /* queda en respaldos */ } // vuelve la de antes, entera
    throw e
  }
  return true
}
