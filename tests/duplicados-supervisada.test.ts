// Un test por cada error que encontró la corrida supervisada de Duplicados del 20/10 (docs/archivo/pruebas/2026-10-20-duplicados.md),
// con los casos reales de una biblioteca real (solo nombres y huellas sintéticas: no hace falta el audio).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { findDuplicates, isCopyName, pickKeeper, soundRelation, titleCore } from '@paila/core/duplicates'
import { Library } from '@paila/core/library'
import { encodeFingerprint } from '@paila/core/analysis/chromaprint'
import { bestAlignment } from '@paila/core/soundmatch'
import type { DupItem } from '@paila/shared/types'

const item = (id: number, rel: string, over: Partial<DupItem> = {}): DupItem => ({
  id, rel, ext: 'mp3', size: 1, kbps: 320, duration: 154, grade: 'B', kind: 'musica', tagged: true, artist: 'MHD', title: 'Afro Trap', playlists: [], ...over,
})

describe('corrida supervisada de Duplicados (20/10)', () => {
  it('se queda el original y no la copia "(1)" del navegador, aunque la copia tenga la ruta más corta', () => {
    // MHD: "Rap - Varios/… (1).mp3" se quedaba y "Chengue y Trap/Trap/….mp3" iba a la papelera
    const copy = item(1, 'Rap - Varios/MHD - Afro Trap Part. 11 (King Kong) [www.slider.kz] (1).mp3')
    const orig = item(2, 'Chengue y Trap/Trap/MHD - Afro Trap Part. 11 (King Kong) [www.slider.kz].mp3')
    expect(pickKeeper([copy, orig])).toBe(2)
    // Las Pastillas del Abuelo: "candombe(2).mp3" contra "candombe loco0.mp3"
    expect(pickKeeper([item(3, 'Rock/LPDA/laspastillasdelabuelo-candombe(2).mp3'), item(4, 'Rock/LPDA/las pastillas del abuelo - candombe loco0.mp3')])).toBe(4)
    expect(isCopyName('a/Tema (1).mp3')).toBe(true)
    expect(isCopyName('a/lo mas lindo(2)(2).mp3')).toBe(true)
    expect(isCopyName('a/Tema - copia.flac')).toBe(true)
    expect(isCopyName('a/Opus (2000).flac')).toBe(false) // un año entre paréntesis no es una copia
    // la nota sigue mandando: una copia "(2)" de mejor calidad se queda
    expect(pickKeeper([item(5, 'r/el cielo del desengaño(2).mp3', { grade: 'C', kbps: 192 }), item(6, 'r/11 - El cielo del desengaño.mp3', { grade: 'D', kbps: 128 })])).toBe(5)
  })

  it('"Artista - Título" en el título no junta temas distintos del mismo artista como versiones', () => {
    // "Tan Bionica - Ella", "Tan Bionica - Ciudad Mágica" y "Tan Bionica - Obsesionario En La Mayor" salían como versiones
    expect(titleCore('Tan Bionica - Ella', 'Tan Bionica')).not.toBe(titleCore('Tan Bionica - Ciudad Mágica', 'Tan Bionica'))
    expect(titleCore('La Barra - Amor Infiel', 'LaBarraVEVO')).not.toBe(titleCore('La Barra - La Carta', 'LaBarraVEVO'))
    expect(titleCore('_LO MÁS ESCUCHADO 2024 ENGANCHADO FIESTERO - LO MÁS NUEVO - AGOSTO 2024', null))
      .not.toBe(titleCore('_LO MÁS ESCUCHADO 2024 ENGANCHADO FIESTERO - LO MÁS NUEVO - JUNIO 2024', null))
    // lo que sí son versiones sigue juntándose
    expect(titleCore('Tan Bionica - Ella', 'Tan Bionica')).toBe(titleCore('Ella', 'Tan Bionica'))
    expect(titleCore('Hola - Radio Edit')).toBe(titleCore('Hola'))
    expect(titleCore('Los Calientes (Swing-Ya-Mix) (Diego Ro-K)')).toBe(titleCore('Los Calientes'))
    expect(titleCore('La Nave Del Olvido (Vivo)')).toBe(titleCore('La nave del olvido'))
    expect(titleCore('Deléctrico - Chill Out Mix')).toBe(titleCore('Deléctrico'))
  })

  it('un disco con los mismos tags rotos en todos los temas no se junta (ni como duplicados ni como versiones)', async () => {
    // AL046 de KASST: cada tema tiene artista "AL046" y título "KAS:ST"; el nombre del archivo es lo único que los distingue.
    // El buscador viejo mandó "You Thought It Was The End" a la papelera el 19/10 por esto.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-dupnombres-'))
    const lib = new Library(path.join(dir, 'paila.db'), null)
    try {
      fs.mkdirSync(path.join(dir, 'M'))
      const root = await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
      const ins = lib.db.prepare("INSERT INTO files (root_id, rel_path, size, mtime, kind, ext, duration, artist, title, probed_at) VALUES (?, ?, ?, 1, 'musica', 'mp3', ?, ?, ?, '2026-10-20')")
      ins.run(root.id, 'melodic/AL046 - KASST - You Thought It Was The End.mp3', 100, 186.2, 'AL046', 'KAS:ST')
      ins.run(root.id, 'melodic/AL046 - KASST - Whos To Say Whats Real.mp3', 200, 184.3, 'AL046', 'KAS:ST')
      ins.run(root.id, 'TECHNO SET 1/01 KASST - The Gate.mp3', 300, 138, 'AL046', 'KAS:ST')
      ins.run(root.id, 'ambien/AL046 - KASST - Hope Im Alone.mp3', 400, 274, 'AL046', 'KAS:ST')
      // en cambio, el mismo título en dos discos (sin huella para comparar) sí es un probable por nombre
      ins.run(root.id, 'Oktubre/07 - Jijiji.flac', 500, 343.1, 'Patricio Rey', 'Jijiji')
      ins.run(root.id, 'Chateau/13 - Jijiji.flac', 600, 341.9, 'Patricio Rey', 'Jijiji')
      const groups = await findDuplicates(lib.db, () => null)
      expect(groups.some((g) => g.items.some((i) => i.rel.includes('KASST')))).toBe(false)
      expect(groups.map((g) => [g.level, g.items.map((i) => path.basename(i.rel)).sort()])).toEqual([['probable', ['07 - Jijiji.flac', '13 - Jijiji.flac']]])
    } finally { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) }
  })

  it('un set largo que contiene dos temas no los junta como "versiones" (ni encadena todo lo que suena adentro)', async () => {
    // "01 momentodou.wav" (77 minutos) compartía pedazos con temas de KASST y los encadenaba en un solo grupo
    let seed = 11
    const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 2 ** 32 }
    const song = () => { const fp = new Uint32Array(960); let v = (rnd() * 2 ** 32) >>> 0; for (let i = 0; i < 960; i++) { for (let b = 0; b < 32; b++) if (rnd() < 0.12) v ^= 1 << b; fp[i] = v >>> 0 } return fp }
    const a = song(), b = song(), set = new Uint32Array(960)
    set.set(a.subarray(0, 480), 0); set.set(b.subarray(0, 480), 480) // el set: un minuto de cada tema
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-dupset-'))
    const lib = new Library(path.join(dir, 'paila.db'), null)
    try {
      fs.mkdirSync(path.join(dir, 'M'))
      const root = await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
      const ins = lib.db.prepare("INSERT INTO files (root_id, rel_path, size, mtime, kind, ext, duration, probed_at) VALUES (?, ?, ?, 1, 'musica', 'mp3', ?, '2026-10-20')")
      const ana = lib.db.prepare("INSERT INTO analysis (file_id, version, src_size, src_mtime, analyzed_at, chromaprint, prints_at) VALUES (?, 1, ?, 1, '2026-10-20', ?, '2026-10-20')")
      ;([['Tema uno.mp3', 100, 300, a], ['Tema dos.mp3', 200, 280, b], ['01 momentodou.wav', 300, 4620, set]] as const).forEach(([rel, size, dur, fp]) => {
        ana.run(Number(ins.run(root.id, rel, size, dur).lastInsertRowid), size, encodeFingerprint(fp))
      })
      expect(await findDuplicates(lib.db, () => null)).toEqual([])
    } finally { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) }
  })

  it('dos temas de techno distintos que se parecen "de fondo" no son el mismo audio (contraste)', () => {
    // Simone Tavazzi "Trigonometry" y Anticyclone "Desiderio": 79 % de bits iguales en cualquier corrimiento.
    // Huellas hechas de los mismos pocos valores (como el techno percusivo, casi sin notas), en distinto orden.
    let seed = 3
    const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 2 ** 32 }
    const pool = Array.from({ length: 6 }, () => (rnd() * 2 ** 32) >>> 0)
    const track = () => Uint32Array.from({ length: 900 }, () => pool[Math.floor(rnd() * pool.length)] ^ (rnd() < 0.3 ? 1 << Math.floor(rnd() * 32) : 0))
    const a = track(), b = track()
    const al = bestAlignment(a, b, 0)
    expect(al.background).toBeGreaterThan(0.6) // se parecen "a todo"
    expect(al.contrast).toBeLessThan(0.05)
    expect(soundRelation(al, 300, 300, a.length, b.length)).toBe('none')
    // y una copia del mismo, aunque sea de ese estilo, sí se reconoce
    const copy = a.map((v) => (rnd() < 0.05 ? v ^ (1 << Math.floor(rnd() * 32)) : v) >>> 0)
    const same = bestAlignment(a, copy, 0)
    expect(same.contrast).toBeGreaterThan(0.08)
    expect(soundRelation(same, 300, 300, a.length, copy.length)).toBe('same')
  })
})
