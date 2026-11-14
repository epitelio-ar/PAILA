// Los programas del video corren en la compu del autor mientras él (u otra sesión) la usa: no pueden abrir ventanas
// (24/10/2026: la consola de ffmpeg y el cartel de "Error" de Electron pasaban al frente y trababan el manejo de Rekordbox).
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const DIR = path.join(__dirname, '..', 'scripts', 'video')
const conElectron = fs.readdirSync(DIR).filter((f) => f.endsWith('.cjs')).map((f) => [f, fs.readFileSync(path.join(DIR, f), 'utf8')] as const)

describe('el video no abre ventanas', () => {
  it('ffmpeg sale oculto (desde Electron, Windows le abriría una consola visible)', () => {
    for (const [f, s] of conElectron) {
      const llamadas = [...s.matchAll(/\b(spawn|spawnSync|execFile|execFileSync)\(FF\b[^\n]*(?:\n(?!\s*(?:const|let|if|for|\/\/)\b)[^\n]*)*/g)].map((m) => m[0])
      for (const l of llamadas) expect(l, `${f}: ${l.slice(0, 60)}`).toContain('windowsHide: true')
    }
  })
  it('un error se escribe y cierra, sin el cartel de Electron', () => {
    for (const [f, s] of conElectron) if (s.includes("require('electron')")) expect(s, f).toMatch(/process\.on\('uncaughtException'/)
  })
  it('las ventanas de Electron se dibujan sin mostrarse', () => {
    for (const [f, s] of conElectron) for (const m of s.matchAll(/new BrowserWindow\(\{[^}]*/g)) expect(m[0], f).toContain('show: false')
  })
})
