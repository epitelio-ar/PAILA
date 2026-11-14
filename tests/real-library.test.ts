// Prueba opcional contra una biblioteca real, en solo lectura y con una base temporal.
// Uso: PAILA_LIBRARY="<tu carpeta de música>" npx vitest run tests/real-library.test.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { analyzeFolder } from '@paila/core/collections'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'

const LIB = process.env.PAILA_LIBRARY

describe.runIf(!!LIB)('biblioteca real', () => {
  it('analiza, escanea y re-escanea', async () => {
    const t0 = Date.now()
    const a = await analyzeFolder(LIB!)
    console.log(`Análisis de carpetas: ${Date.now() - t0} ms, ${a.totals.audio} audio`)
    for (const s of a.suggestions.filter((x) => x.kind !== 'musica')) console.log(`  ${s.kind.padEnd(10)} ${s.rel}  — ${s.reason}`)

    // PAILA_KEEP_DB=carpeta deja la base ahí (sirve para abrir PAILA con PAILA_USER_DATA apuntando a esa carpeta).
    const keep = process.env.PAILA_KEEP_DB
    const dir = keep ? (fs.mkdirSync(keep, { recursive: true }), keep) : fs.mkdtempSync(path.join(os.tmpdir(), 'paila-real-'))
    const lib = new Library(path.join(dir, 'paila.db'), findFfprobe())
    try {
      await lib.addRoot(LIB!, a.suggestions.map((s) => ({ rel: s.rel, kind: s.kind })))
      const t1 = Date.now()
      const s1 = await lib.scan()
      console.log(`Primer escaneo: ${((Date.now() - t1) / 1000).toFixed(1)} s — ${s1.found} encontrados, ${s1.errors} errores`)
      const byKind: Record<string, number> = {}
      for (const r of lib.tracks()) byKind[String(r[3])] = (byKind[String(r[3])] || 0) + 1
      console.log('Por colección:', byKind)
      const errs = lib.db.prepare('SELECT rel_path, error FROM files WHERE error IS NOT NULL LIMIT 5').all()
      if (errs.length) console.log('Errores de ejemplo:', errs)
      const t2 = Date.now()
      const s2 = await lib.scan()
      console.log(`Re-escaneo: ${((Date.now() - t2) / 1000).toFixed(1)} s — ${s2.toProbe} para releer`)
      expect(s2.toProbe).toBe(0)
      console.log('Disco:', lib.roots()[0].volumeLabel, lib.roots()[0].volumeSerial)
    } finally {
      lib.close()
      if (!keep) fs.rmSync(dir, { recursive: true, force: true })
    }
  }, 30 * 60_000)
})
