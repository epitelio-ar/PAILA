// Las tandas del Historial (core/history.ts) de lo que PAILA copió o escribió afuera de tu Música (core/ops/copy.ts): el
// pendrive, el celular, los archivos de Traktor, Serato, VirtualDJ y Rekordbox, y las listas .m3u8. Son copias: tu Música no
// se tocó, así que no hay nada que deshacer en ella. Se muestran para saber qué se copió, adónde y dónde quedó lo de antes.
import type { Db } from './db'
import type { CopyKind } from './ops/copy'
import type { HistoryDetailRow, HistoryEntry } from '@paila/shared/types'
import { archivos, temas } from './history-text'
import { num, textos } from '@paila/shared/idioma'

type S = (n: string) => string

const C = textos({
  pendrive: { es: (n: string, dest: string, gb: string) => `Se copiaron ${n} a ${dest} (${gb})`, en: (n: string, dest: string, gb: string) => `Copied ${n} to ${dest} (${gb})` },
  celular: { es: (n: string, dest: string, gb: string) => `Se llevaron ${n} a ${dest} (${gb})`, en: (n: string, dest: string, gb: string) => `Took ${n} to ${dest} (${gb})` },
  programa: { es: (app: string, n: string) => `Se exportó a ${app} (${n})`, en: (app: string, n: string) => `Exported to ${app} (${n})` },
  listas: { es: (n: string, dest: string) => `Se guardaron ${n} en ${dest}`, en: (n: string, dest: string) => `Saved ${n} in ${dest}` },
  lista: { es: 'lista .m3u8', en: '.m3u8 playlist' }, listasN: { es: 'listas .m3u8', en: '.m3u8 playlists' },
  sinDeshacer: {
    es: 'Son copias: tu Música no se tocó. Si no las querés, borrá esa carpeta desde el Explorador',
    en: "They're copies: your Music wasn't touched. If you don't want them, delete that folder in File Explorer",
  },
  sinDeshacerPrograma: {
    es: ((bak) => `Tu Música no se tocó. Lo que ese programa tenía antes quedó guardado en ${bak}`) as S,
    en: ((bak) => `Your Music wasn't touched. What that app had before was saved in ${bak}`) as S,
  },
  sinDeshacerNuevo: {
    es: 'Tu Música no se tocó: solo se escribieron los archivos de ese programa',
    en: "Your Music wasn't touched: only that app's files were written",
  },
  copiado: { es: 'Copiado', en: 'Copied' },
  reemplazado: { es: ((bak) => `Escrito (lo de antes, en ${bak})`) as S, en: ((bak) => `Written (what was there before, in ${bak})`) as S },
  escrito: { es: 'Escrito', en: 'Written' },
})

const APP: Record<string, string> = { traktor: 'Traktor', serato: 'Serato', virtualdj: 'VirtualDJ', engine: 'Engine DJ', rekordbox: 'Rekordbox' }
const fileOf = (p: string) => p.split(/[\\/]/).pop() ?? p
const dirOfAbs = (p: string) => p.slice(0, Math.max(0, p.length - fileOf(p).length - 1))
const gb = (b: number) => b >= 1e9 ? `${num(b / 1e9, { maximumFractionDigits: 1 })} GB` : `${num(Math.max(1, Math.round(b / 1e6)))} MB`

export function copyEntries(db: Db): HistoryEntry[] {
  const rows = db.prepare(
    `SELECT batch, kind, dest, COUNT(*) AS n, SUM(file_id IS NOT NULL) AS tracks, SUM(size) AS bytes, MAX(at) AS at, MIN(backup) AS backup
     FROM copies_log GROUP BY batch ORDER BY batch`,
  ).all() as { batch: number; kind: CopyKind; dest: string; n: number; tracks: number; bytes: number; at: string; backup: string | null }[]
  return rows.map((r) => {
    const app = APP[r.kind]
    const summary = r.kind === 'pendrive' || r.kind === 'celular' ? C[r.kind](temas(r.tracks || r.n), r.dest, gb(r.bytes))
      : r.kind === 'listas' ? C.listas(r.n === 1 ? `1 ${C.lista}` : `${num(r.n)} ${C.listasN}`, r.dest)
        : C.programa(app ?? r.kind, archivos(r.n))
    const whyNot = app ? (r.backup ? C.sinDeshacerPrograma(dirOfAbs(r.backup)) : C.sinDeshacerNuevo) : C.sinDeshacer
    return { kind: 'copia' as const, id: r.batch, at: r.at, files: r.n, summary, undone: false, canUndo: false, whyNot, note: null }
  })
}

export function copyDetail(db: Db, batch: number): HistoryDetailRow[] {
  const rows = db.prepare('SELECT src, dst, backup FROM copies_log WHERE batch = ? ORDER BY id').all(batch) as { src: string | null; dst: string; backup: string | null }[]
  return rows.map((r) => ({
    name: fileOf(r.dst), folder: dirOfAbs(r.dst),
    what: r.src ? C.copiado : r.backup ? C.reemplazado(r.backup) : C.escrito,
    before: r.src ? fileOf(r.src) : null, after: null, undone: false,
  }))
}
