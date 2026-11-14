// La nota de calidad y los errores guardados siguen el idioma elegido (pendiente del inglés, 24/10/2026; core/textosidioma.ts):
// la nota se arma en los dos idiomas al analizar y se intercambia al cambiar de idioma; lo guardado antes en un solo idioma se
// traduce cuando es un texto fijo. Un MP3 sintético hecho con ffmpeg (nunca la biblioteca real).
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { analyzeFile } from '@paila/core/analysis/analyze'
import { gradeEnLosDos } from '@paila/core/analysis/grade'
import { T as G } from '@paila/core/analysis/grade.textos'
import { openDb, type Db } from '@paila/core/db'
import { guardarOtro, pasarTextosAlIdioma } from '@paila/core/textosidioma'
import { enCadaIdioma, enEsteIdioma, ponerIdioma } from '@paila/shared/idioma'

const require = createRequire(import.meta.url)
const ffmpeg: string = require('ffmpeg-static')
let dir: string, db: Db

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-textos-idioma-'))
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anoisesrc=d=20:c=pink:r=44100:a=0.3', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '128k', path.join(dir, 'm128.mp3')])
  db = openDb(path.join(dir, 'paila.db'))
  db.prepare("INSERT INTO volumes (id, serial, label, last_mount) VALUES (1, 'X', '', 'C:/')").run()
  db.prepare("INSERT INTO roots (id, volume_id, rel_path, added_at) VALUES (1, 1, 'M', '')").run()
  for (const id of [1, 2, 3]) db.prepare("INSERT INTO files (id, root_id, rel_path, size, mtime, kind, ext) VALUES (?, 1, ?, 10, 1, 'musica', 'mp3')").run(id, `${id}.mp3`)
})
afterAll(() => { db.close(); ponerIdioma('es'); fs.rmSync(dir, { recursive: true, force: true }) })

describe('la nota en los dos idiomas', () => {
  it('enCadaIdioma arma lo mismo en castellano y en inglés y deja el idioma como estaba', () => {
    ponerIdioma('en')
    expect(enCadaIdioma(() => G.deMp3)).toEqual({ es: 'Viene de un MP3/AAC', en: 'Made from an MP3/AAC' })
    expect(G.deMp3).toBe('Made from an MP3/AAC')
    ponerIdioma('es')
  })

  it('gradeEnLosDos: la misma nota, con los textos del otro idioma aparte', async () => {
    ponerIdioma('es')
    const info = { codec: 'mp3', ext: 'mp3', lossless: false, kbps: 128, sampleRate: 44100, bits: null, channels: 2 }
    const raw = await analyzeFile({ ffmpeg, file: path.join(dir, 'm128.mp3'), ext: 'mp3', lossless: false, sampleRate: 44100, bits: null, channels: 2, duration: 20, withDj: false, withPrints: false })
    const v = gradeEnLosDos(info, raw)
    expect(v.otro.i).toBe('en')
    expect(v.otro.why.length).toBe(v.why.length)
    expect(v.otro.is).not.toBe(v.is) // "MP3 · 128 kbps" se dice distinto… o al menos la explicación
    expect(v.otro.why.join(' ')).not.toBe(v.why.join(' '))
  })

  it('enEsteIdioma traduce los textos fijos guardados y deja igual lo que no conoce', () => {
    expect(enEsteIdioma('Viene de un MP3/AAC', 'en')).toBe('Made from an MP3/AAC')
    expect(enEsteIdioma('Made from an MP3/AAC', 'es')).toBe('Viene de un MP3/AAC')
    expect(enEsteIdioma('Invalid data found when processing input', 'es')).toBe('Invalid data found when processing input')
  })

  it('los textos con datos se traducen por su molde, con los números en el otro formato', () => {
    ponerIdioma('es')
    expect(enEsteIdioma(G.conPerdida('MP3', 128), 'en')).toBe('MP3 at ~128 kbps')
    const es = G.archivoDe('32 kHz', '15,8 kHz')
    expect(enEsteIdioma(es, 'en')).toBe("It's a 32 kHz file: it can't hold sound above 15.8 kHz (a CD goes up to ~22 kHz).")
    // un texto dentro de otro (la etiqueta de un dañado)
    expect(enEsteIdioma(G.danado(G.conPerdida('MP3', 128)), 'en')).toBe('Damaged · MP3 at ~128 kbps')
    // y de vuelta
    expect(enEsteIdioma('MP3 at ~128 kbps', 'es')).toBe('MP3 de ~128 kbps')
    // lo que no tiene molde queda igual
    expect(enEsteIdioma('Algo que PAILA nunca dijo, 12,5 kHz', 'en')).toBe('Algo que PAILA nunca dijo, 12,5 kHz')
  })
})

describe('lo que PAILA dice que está haciendo', () => {
  it('"PAILA está ocupada con…" y lo que se estaba haciendo al revisar el sonido salen de pares, nunca de un texto suelto', () => {
    const ROOT = path.join(__dirname, '..'), malos: string[] = []
    for (const dir of ['packages/core', 'apps/paila/electron']) {
      for (const f of fs.readdirSync(path.join(ROOT, dir), { recursive: true }) as string[]) {
        if (!f.endsWith('.ts')) continue
        const s = fs.readFileSync(path.join(ROOT, dir, f), 'utf8')
        for (const m of s.matchAll(/\.(?:ops|lock)\.run\(\s*['"`]|checkSameAudio\([^)]*,\s*['"`][^'"`]*['"`]\s*[,)]/g)) malos.push(`${dir}/${f}: ${m[0]}`)
      }
    }
    expect(malos).toEqual([])
  })
})

describe('al cambiar de idioma, lo guardado en la base cambia con él', () => {
  it('intercambia lo que tiene los dos idiomas y traduce lo viejo que se puede', () => {
    const ins = db.prepare(`INSERT INTO analysis (file_id, version, src_size, src_mtime, analyzed_at, grade, says, is_label, why, sound, error)
      VALUES (?, 1, 10, 1, '', 'D', ?, ?, ?, ?, ?)`)
    // 1: analizado con esta versión (los dos idiomas)
    ins.run(1, 'MP3 · 128 kbps', 'MP3 de 128 kbps', JSON.stringify(['Corta de golpe en 16 kHz.']), JSON.stringify([]), null)
    guardarOtro(db, 1, { i: 'en', says: 'MP3 · 128 kbps', is: '128 kbps MP3', why: ['Cuts off sharply at 16 kHz.'], sound: [] })
    // 2: analizado antes, solo en castellano: un texto fijo y uno que no se reconoce
    ins.run(2, 'MP3 · 128 kbps', G.deMp3, JSON.stringify([G.casiNada, 'Corta de golpe en 16 kHz.']), JSON.stringify([]), null)
    db.prepare("UPDATE files SET error = 'El archivo no tiene audio' WHERE id = 3").run()

    expect(pasarTextosAlIdioma(db, 'en')).toBeGreaterThanOrEqual(3)
    const a = (id: number) => db.prepare('SELECT a.is_label, a.why, o.textos AS otro_idioma FROM analysis a LEFT JOIN analysis_otro o ON o.file_id = a.file_id WHERE a.file_id = ?').get(id) as { is_label: string; why: string; otro_idioma: string | null }
    expect(a(1).is_label).toBe('128 kbps MP3')
    expect(JSON.parse(a(1).why)).toEqual(['Cuts off sharply at 16 kHz.'])
    expect(JSON.parse(a(1).otro_idioma!)).toMatchObject({ i: 'es', is: 'MP3 de 128 kbps', why: ['Corta de golpe en 16 kHz.'] })
    expect(a(2).is_label).toBe('Made from an MP3/AAC')
    expect(JSON.parse(a(2).why)).toEqual(['There is almost no sound to analyze, so PAILA trusts the format.', 'Corta de golpe en 16 kHz.'])
    expect((db.prepare('SELECT error FROM files WHERE id = 3').get() as { error: string }).error).toBe('The file has no audio')

    // otra vez en inglés: no hace nada
    expect(pasarTextosAlIdioma(db, 'en')).toBe(0)
    // y de vuelta, queda como estaba
    pasarTextosAlIdioma(db, 'es')
    expect(a(1).is_label).toBe('MP3 de 128 kbps')
    expect(JSON.parse(a(1).otro_idioma!)).toMatchObject({ i: 'en', is: '128 kbps MP3' })
    expect(a(2).is_label).toBe('Viene de un MP3/AAC')
    expect((db.prepare('SELECT error FROM files WHERE id = 3').get() as { error: string }).error).toBe('El archivo no tiene audio')
  })
})
