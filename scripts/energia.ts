// Banco de la energía del 1 al 10 (MASTERPLAN-3, punto 3): compara la energía de hoy (core/analysis/dj.ts) con fórmulas
// nuevas contra una referencia (temas marcados: `[{ id, ref }]`), con lo que ya guarda la base y, si está, lo que dijo
// Discogs-EffNet (scripts/estilo-sonido.ts). Validación dejando uno afuera. Solo lee una copia de la base.
// Uso: node scripts/run-ts.mjs scripts/energia.ts --base copia.db --ref ref.json [--estilo estilo.json]
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { energyFeatures, fitEnergy, energyFrom, type EnergyRow } from '@paila/core/energia'

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }
const db = new DatabaseSync(arg('base')!, { readOnly: true })
const ref: { id: number; ref: number; name: string }[] = JSON.parse(fs.readFileSync(arg('ref')!, 'utf8'))
const estilo = arg('estilo') ? new Map((JSON.parse(fs.readFileSync(arg('estilo')!, 'utf8')) as { id: number; moods: Record<string, number> }[]).map((r) => [r.id, r.moods])) : new Map()
const rowOf = (id: number) => db.prepare('SELECT a.lufs, a.lra, a.danceability, a.bpm, a.spectrum, a.energy FROM analysis a WHERE a.file_id = ?').get(id) as (EnergyRow & { energy: number | null }) | undefined

const rank = (xs: number[]) => { const o = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]); const r = new Array(xs.length); o.forEach(([, i], k) => (r[i] = k)); return r }
const pearson = (a: number[], b: number[]) => { const ma = a.reduce((s, x) => s + x, 0) / a.length, mb = b.reduce((s, x) => s + x, 0) / b.length; let n = 0, da = 0, dbb = 0; for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; dbb += (b[i] - mb) ** 2 } return n / Math.sqrt(da * dbb) }
const spearman = (a: number[], b: number[]) => pearson(rank(a), rank(b))
const report = (label: string, pred: number[], truth: number[]) => {
  const err = pred.map((p, i) => Math.abs(p - truth[i]))
  console.log(`${label.padEnd(34)} Spearman ${spearman(pred, truth).toFixed(2)} · error medio ${(err.reduce((s, x) => s + x, 0) / err.length).toFixed(2)} · a ±1: ${Math.round((100 * err.filter((x) => x <= 1).length) / err.length)} % · a ±2: ${Math.round((100 * err.filter((x) => x <= 2).length) / err.length)} %`)
}

const items = ref.map((r) => ({ ...r, row: rowOf(r.id), moods: estilo.get(r.id) as Record<string, number> | undefined })).filter((x) => x.row?.lufs != null)
console.log(`${items.length} temas con referencia y análisis (${items.filter((x) => x.moods).length} con EffNet)`)
const truth = items.map((x) => x.ref)
report('Hoy (volumen, bailable, tempo)', items.map((x) => x.row!.energy ?? 5), truth)
for (const withModel of [false, true]) {
  const use = withModel ? items.filter((x) => x.moods) : items
  if (!use.length) continue
  const feats = use.map((x) => energyFeatures(x.row!, withModel ? x.moods : undefined))
  const t = use.map((x) => x.ref)
  // dejando uno afuera: ajustar con los demás y predecir el que quedó
  const loo = feats.map((_, i) => energyFrom(feats[i], fitEnergy(feats.filter((__, j) => j !== i), t.filter((__, j) => j !== i))))
  report(withModel ? 'Nueva, con EffNet (dejando uno)' : 'Nueva, solo la base (dejando uno)', loo, t)
  const w = fitEnergy(feats, t)
  console.log("  modelo:", JSON.stringify(w))
  if (process.argv.includes('--detalle')) use.forEach((x, i) => console.log(`  ${String(x.ref).padStart(2)} hoy ${x.row!.energy} nueva ${loo[i]}  ${x.name}`))
}
