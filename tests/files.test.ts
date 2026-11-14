// Recorrido de carpetas (core/files.ts): mirar varios archivos a la vez no cambia qué se encuentra ni en qué orden.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isAudio, isSystemDir, walkAudio } from '@paila/core/files'

/** El recorrido de antes, de a un archivo por vez: la referencia. */
function reference(root: string) {
  const out: { rel: string; size: number }[] = []
  const stack = ['']
  while (stack.length) {
    const rel = stack.pop()!
    for (const e of fs.readdirSync(rel ? path.join(root, ...rel.split('/')) : root, { withFileTypes: true })) {
      const child = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) { if (!isSystemDir(e.name)) stack.push(child) } else if (e.isFile() && isAudio(e.name)) out.push({ rel: child, size: fs.statSync(path.join(root, ...child.split('/'))).size })
    }
  }
  return out
}

describe('recorrido de carpetas', () => {
  it('encuentra lo mismo y en el mismo orden que de a un archivo', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-walk-'))
    for (const d of ['A', 'A/Disco 1', 'B', '_PAILA/papelera', '.oculta']) fs.mkdirSync(path.join(root, d), { recursive: true })
    for (let i = 0; i < 75; i++) fs.writeFileSync(path.join(root, 'A', `${String(i).padStart(2, '0')} tema.mp3`), 'x'.repeat(i))
    for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(root, 'A/Disco 1', `t${i}.flac`), 'y')
    fs.writeFileSync(path.join(root, 'B', 'tapa.jpg'), 'z')
    fs.writeFileSync(path.join(root, 'B', 'uno.wav'), 'zz')
    fs.writeFileSync(path.join(root, '_PAILA/papelera', 'viejo.mp3'), 'w')
    fs.writeFileSync(path.join(root, 'suelto.m4a'), 'v')
    const got: { rel: string; size: number }[] = []
    for await (const f of walkAudio(root, () => false, () => {})) got.push({ rel: f.rel, size: f.size })
    expect(got).toEqual(reference(root))
    expect(got).toHaveLength(75 + 5 + 1 + 1)
    fs.rmSync(root, { recursive: true, force: true })
  })
})
