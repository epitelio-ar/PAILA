// Lo que encontró el repaso de criterios del 24/10 en la Bandeja (docs/pruebas/2026-10-24-repaso-criterios.md): entre dos archivos
// que llegaron para el mismo tema iba el de mejor nota y, si empataban, el primero por nombre. Ahora, la regla de Duplicados.
// Y "mejor que el tuyo" se mide con la misma vara que NAPIA (core/better.ts).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { InboxFlow, verify } from '@paila/core/inboxflow'
import type { CandidateInfo } from '@paila/core/replace'
import { clearlyBetter, type Copy } from '@paila/core/better'
import { grade } from '@paila/core/analysis/grade'
import type { RawAnalysis } from '@paila/core/analysis/analyze'
import { DANADO_DE_VERDAD } from '@paila/core/sockseek/calidad'
import type { InboxResult } from '@paila/shared/types'

let dir: string, lib: Library, fileId: number
const inbox = () => path.join(dir, 'Bandeja')

/** Un archivo que la Bandeja ya revisó: "reemplazar" el tema de la biblioteca, con lo que midió el análisis. */
function llego(name: string, ext: string, kbps: number, grade: string, sound: InboxResult['sound']) {
  const file = path.join(inbox(), name)
  fs.writeFileSync(file, Buffer.alloc(1000 + name.length))
  const st = fs.statSync(file)
  const lib0 = lib.db.prepare('SELECT size, mtime FROM files WHERE id = ?').get(fileId) as { size: number; mtime: number }
  const res: InboxResult = {
    path: file, name, ext, size: st.size, kbps, duration: 200, codec: ext === 'm4a' ? 'aac' : 'mp3', artist: 'Guns N\' Roses', title: 'Dust N\' Bones',
    match: { fileId, rel: 'Rock/Guns N\' Roses/02 Dust N\' Bones.mp3', kind: 'mismo', by: 'sonido', wantedId: null, sharedSeconds: null } as unknown as InboxResult['match'],
    missing: null, check: { ok: true, newGrade: grade, newLabel: '', oldGrade: 'D', problems: [], problemsEs: [], notAnalyzed: false, warnings: [] } as unknown as InboxResult['check'],
    decision: 'reemplazar', why: '', checkedAt: '2026-10-24', libStamp: `${lib0.size}|${lib0.mtime}`, sound,
  }
  lib.db.prepare('INSERT INTO inbox_items (path, size, mtime, result, checked_at) VALUES (?, ?, ?, ?, ?)').run(file, st.size, Math.round(st.mtimeMs), JSON.stringify(res), res.checkedAt)
  return file
}
const plan = () => new InboxFlow(lib.db, { workDir: path.join(dir, 'trabajo') } as never, null as never, null as never, { ffprobe: '', describe: null as never, inRekordbox: () => [] }).plan(inbox())
const sano = {
  cutoff: { cutoff: 20200, drop: 40, cdEdgeDrop: null, frames: 500, spectrum: [] }, hires: null, effBits: null, flicker: 1.5, lufs: -9, lra: 6, truePeak: -1, samplePeak: -1,
  clipEvents: 0, stereoCorr: 0.8, sideRatio: 0.1, decodeErrors: 0, meta: {}, mp3: null, dj: null, prints: { audioMd5: null, chromaprint: null, size: null, mtime: null }, ms: 1,
} satisfies RawAnalysis
const sound = (over: Partial<NonNullable<InboxResult['sound']>> = {}) => ({ clipEvents: 0, lufs: -9, cutoff: 20200, encoder: 'LAME3.99r', sampleRate: 44100, gaps: false, ...over })

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-bandeja-repaso-'))
  fs.mkdirSync(path.join(dir, 'M')); fs.mkdirSync(inbox())
  lib = new Library(path.join(dir, 'paila.db'), null)
  const root = (await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])).id
  fileId = Number(lib.db.prepare("INSERT INTO files (root_id, rel_path, size, mtime, kind, ext, probed_at) VALUES (?, 'Rock/Guns N'' Roses/02 Dust N'' Bones.mp3', 5, 7, 'musica', 'mp3', 'x')").run(root).lastInsertRowid)
})
afterEach(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('repaso de criterios: Bandeja, dos archivos para el mismo tema', () => {
  it('a igual nota, el de más bitrate ("Dust N\' Bones" llegó en MP3 320 y en M4A 274, los dos B)', () => {
    llego("a - 02 Dust N' Bones.m4a", 'm4a', 274, 'B', sound())
    const mp3 = llego("b - 02 - Dust N' Bones.mp3", 'mp3', 320, 'B', sound())
    expect(plan().replace.map((p) => p.path)).toEqual([mp3])
  })

  it('a igual nota y bitrate, el que no está recomprimido con ffmpeg; y uno con huecos pierde aunque tenga mejor nota', () => {
    llego('a - lavf.mp3', 'mp3', 320, 'B', sound({ encoder: 'Lavf' }))
    const lame = llego('b - lame.mp3', 'mp3', 320, 'B', sound())
    expect(plan().replace.map((p) => p.path)).toEqual([lame])
    const limpio = llego('c - limpio.mp3', 'mp3', 192, 'C', sound())
    fs.rmSync(lame); fs.rmSync(path.join(inbox(), 'a - lavf.mp3'))
    llego('d - con huecos.mp3', 'mp3', 320, 'B', sound({ gaps: true }))
    expect(plan().replace.map((p) => p.path)).toEqual([limpio])
  })
})

describe('repaso de criterios: la Bandeja no cambia un tema limpio por uno con huecos', () => {
  const cand = (o: Partial<CandidateInfo>): CandidateInfo => ({
    path: 'x.mp3', ext: 'mp3', codec: 'mp3', kbps: 320, sampleRate: 44100, bits: null, duration: 200, size: 1, grade: 'B', label: 'MP3 de ~320 kbps', says: '', why: [],
    lufs: -9, cutoff: 20200, artist: null, title: null, album: null, flags: [], clipEvents: 0, spectrum: [], ...o,
  })
  it('un 320 con 3 cortes no reemplaza a tu 128 limpio; si el tuyo también tiene, sí', () => {
    const old = { grade: 'D', duration: 200, clipEvents: 0, lufs: -9, flags: 'low_bitrate' }
    expect(verify(old, cand({ flags: ['gaps'] })).problemsEs.join()).toMatch(/cortes/)
    expect(verify({ ...old, flags: 'low_bitrate,gaps' }, cand({ flags: ['gaps'] })).ok).toBe(true)
    expect(verify(old, cand({})).ok).toBe(true)
  })

  // la misma vara que NAPIA cuando baja algo para reemplazar el tuyo (el autor, 24/10): antes la Bandeja pedía mejor nota, y lo
  // que NAPIA traía por "la misma nota, pero suena con más calidad" la Bandeja lo mandaba a no-sirvió
  it('con la misma nota, solo si suena con más calidad real y se lee entero', () => {
    const old = { grade: 'B', duration: 200, clipEvents: 0, lufs: -9, flags: null, effKbps: 256 }
    expect(verify(old, cand({ effKbps: 320 })).ok).toBe(true)
    expect(verify(old, cand({ effKbps: 256 })).problemsEs.join()).toMatch(/misma nota.*no suena con más calidad \(256 kbps reales contra 256\)/)
    expect(verify(old, cand({ effKbps: 320, flags: ['damaged'] })).problemsEs.join()).toMatch(/dañado.*partes que no se pueden leer/)
    expect(verify({ ...old, flags: 'gaps' }, cand({ effKbps: 320, flags: ['gaps'] })).ok).toBe(false) // los dos con cortes: no gana
    expect(verify({ ...old, effKbps: null }, cand({ effKbps: 320 })).ok).toBe(false) // sin saber cuánto suena el tuyo, no
    expect(verify(old, cand({ grade: 'C', effKbps: 320 })).problemsEs.join()).toMatch(/No es mejor: el nuevo tiene nota C/)
  })
})

describe('repaso de criterios: "claramente mejor", una sola vara para la Bandeja y NAPIA (core/better.ts)', () => {
  const c = (grade: string | null, effKbps: number | null, ...flags: string[]): Copy => ({ grade, effKbps, flags })
  it('los casos de la regla de NAPIA (docs/DECISIONES.md, 24/10) y los cortes', () => {
    expect(clearlyBetter(c('B', 320), c('D', 128))).toBe(true) // mejor nota
    expect(clearlyBetter(c('D', 128), c('B', 320))).toBe(false)
    expect(clearlyBetter(c('B', 320), c('B', 256))).toBe(true) // misma nota, más calidad real
    expect(clearlyBetter(c('B', 320), c('B', 320))).toBe(false)
    expect(clearlyBetter(c('B', 320), c('B', null))).toBe(false)
    expect(clearlyBetter(c('A', 1411), c(null, null))).toBe(true) // tu copia sin nota: no hay con qué comparar
    expect(clearlyBetter(c('B', 320, 'gaps'), c('D', 128))).toBe(false) // con cortes no reemplaza a uno limpio
    expect(clearlyBetter(c('B', 320, 'gaps'), c('D', 128, 'gaps'))).toBe(true)
    expect(clearlyBetter(c('B', 320, 'gaps'), c('B', 256, 'gaps'))).toBe(false) // misma nota: tiene que leerse entero
  })
  it('NAPIA da por dañado con los mismos tropiezos que PAILA', () => {
    const info = { codec: 'mp3', ext: 'mp3', lossless: false, kbps: 320, sampleRate: 44100, bits: null, channels: 2 }
    const raw = (decodeErrors: number) => ({ ...sano, decodeErrors }) as RawAnalysis
    expect(grade(info, raw(DANADO_DE_VERDAD)).flags).not.toContain('damaged')
    expect(grade(info, raw(DANADO_DE_VERDAD + 1)).flags).toContain('damaged')
  })
})
