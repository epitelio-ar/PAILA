// Tests de "Herramientas para DJ y producción" (shared/profile.ts y core/djsignals.ts): una sola opción apagada de fábrica,
// el pase de quien ya había elegido DJ o producción, la oferta de una vez, la barra lateral y el estilo de fábrica.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { openDb, transaction } from '@paila/core/db'
import { djSignals } from '@paila/core/djsignals'
import { DJ_TOOLS_HELP, DJ_TOOLS_NAME, defaultColumns, djOfferReasons, legacyDjTools, parseDjTools, qualityExample, resolveDjTools, type DjSignals } from '@paila/shared/profile'
import { ESTILO_DE_FABRICA, ESTILOS, leerEstilo } from '@paila/diseno'

const ROOT = path.join(__dirname, '..')
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8')

describe('herramientas para DJ y producción', () => {
  it('lo guardado se lee como sí, no o "todavía no se decidió"', () => {
    expect(parseDjTools('1')).toBe(true)
    expect(parseDjTools('0')).toBe(false)
    expect(parseDjTools(null)).toBeNull()
    expect(parseDjTools('basura')).toBeNull()
  })

  it('apagadas de fábrica: sin nada guardado ni de antes, no hay herramientas', () => {
    expect(resolveDjTools(null, null, null)).toBe(false)
    expect(defaultColumns(false, ['artist', 'title'], ['bpm', 'camelot'])).toEqual(['artist', 'title'])
  })

  it('quien ya había elegido DJ o producción queda con las herramientas prendidas', () => {
    expect(resolveDjTools(null, '["dj"]', null)).toBe(true)
    expect(resolveDjTools(null, '["escuchar","produccion"]', '2026-10-01')).toBe(true)
    expect(legacyDjTools('["escuchar","dj","produccion"]', null)).toBe(true)
  })

  it('quien eligió solo "escuchar" queda con todo apagado', () => {
    expect(resolveDjTools(null, '["escuchar"]', '2026-10-01')).toBe(false)
  })

  it('quien dijo "Ahora no (ver todo)" en la pregunta de antes sigue viendo todo', () => {
    expect(resolveDjTools(null, null, '2026-10-01')).toBe(true)
  })

  it('lo de antes que no se entiende no prende nada', () => {
    expect(legacyDjTools('basura', null)).toBe(false)
    expect(legacyDjTools('{"no":1}', null)).toBe(false)
  })

  it('lo decidido ahora manda sobre lo de antes, para los dos lados', () => {
    expect(resolveDjTools('0', '["dj"]', null)).toBe(false)
    expect(resolveDjTools('1', '["escuchar"]', '2026-10-01')).toBe(true)
  })

  it('con las herramientas prendidas suben las columnas de BPM y tono y la frase de la calidad suma la cabina', () => {
    expect(defaultColumns(true, ['artist', 'title'], ['bpm', 'camelot'])).toEqual(['artist', 'title', 'bpm', 'camelot'])
    expect(qualityExample(false)).toContain('auriculares')
    expect(qualityExample(false)).not.toMatch(/cabina|pinch/)
    expect(qualityExample(true)).toContain('equipo grande')
  })
})

describe('la oferta de una sola vez (parece que pinchás)', () => {
  const base: DjSignals = { tracks: 1000, withBpmOrKey: 0, folders: ['Rock', 'Jazz'], imported: false }

  it('una biblioteca común no ofrece nada', () => {
    expect(djOfferReasons(base)).toEqual([])
  })

  it('muchos temas con BPM o tono: se ofrece; pocos o una parte chica, no', () => {
    expect(djOfferReasons({ ...base, withBpmOrKey: 400 })).toHaveLength(1)
    expect(djOfferReasons({ ...base, withBpmOrKey: 30 })).toEqual([]) // pocos
    expect(djOfferReasons({ ...base, withBpmOrKey: 60 })).toEqual([]) // 6 %: una parte chica
    expect(djOfferReasons({ tracks: 100, withBpmOrKey: 60, folders: [], imported: false })).toHaveLength(1) // biblioteca chica, casi toda con BPM
  })

  it('carpetas "Sets", "Rekordbox" o "PIONEER" (en cualquier mayúscula)', () => {
    for (const f of ['Sets', 'sets', 'DJ Sets', 'Rekordbox', 'REKORDBOX', 'PIONEER', 'Pioneer', '_Serato_']) expect(djOfferReasons({ ...base, folders: ['Rock', f] }).join(' ')).toContain(f)
    for (const f of ['Settings', 'Pioneers of Funk', 'Offsets', 'Sets de luces']) expect(djOfferReasons({ ...base, folders: [f] })).toEqual([])
  })

  it('un rekordbox.xml traído', () => {
    expect(djOfferReasons({ ...base, imported: true })).toHaveLength(1)
  })

  it('las razones se suman', () => {
    expect(djOfferReasons({ tracks: 100, withBpmOrKey: 80, folders: ['Sets'], imported: true })).toHaveLength(3)
  })
})

describe('las señales, sacadas de la base', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-djsignals-'))
  const abiertas: { close: () => void }[] = []
  afterAll(() => { for (const d of abiertas) d.close(); fs.rmSync(dir, { recursive: true, force: true }) })

  function base(name: string, o: { rules?: string[]; sources?: (string | null)[]; trashed?: number; rb?: boolean; serato?: boolean; root?: string } = {}) {
    const db = openDb(path.join(dir, name))
    abiertas.push(db)
    transaction(db, () => {
      db.exec("INSERT INTO volumes (serial, label, last_mount) VALUES ('X', 'X', 'C:\\')")
      db.prepare("INSERT INTO roots (volume_id, rel_path, added_at) VALUES (1, ?, '2026-01-01')").run(o.root ?? 'Musica')
      for (const r of o.rules ?? []) db.prepare('INSERT INTO rules (root_id, rel_prefix, kind) VALUES (1, ?, ?)').run(r, 'musica')
      const f = db.prepare("INSERT INTO files (root_id, rel_path, size, mtime, kind, ext, trashed_at) VALUES (1, ?, 1, 1, 'musica', 'mp3', ?)")
      const a = db.prepare('INSERT INTO analysis (file_id, version, src_size, src_mtime, analyzed_at, bpm_source) VALUES (?, 1, 1, 1, ?, ?)')
      const fuentes = o.sources ?? []
      fuentes.forEach((s, i) => { f.run(`t${i}.mp3`, null); a.run(i + 1, '2026-01-01', s) })
      for (let i = 0; i < (o.trashed ?? 0); i++) { const id = fuentes.length + i + 1; f.run(`x${i}.mp3`, '2026-01-02'); a.run(id, '2026-01-01', 'tag') }
      if (o.rb) db.prepare("INSERT INTO rb_ids (file_id, track_id, source) VALUES (1, '1', 'rekordbox')").run()
      if (o.serato) db.prepare("INSERT INTO dj_grid (file_id, method, bpm, segments, made_at) VALUES (1, 'serato', 120, '[]', '2026-01-01')").run()
    })
    return db
  }

  it('cuenta los temas con BPM o tono escritos (tag o nombre), no los medidos por PAILA, y no cuenta los de la papelera', () => {
    const db = base('a.db', { sources: ['tag', 'nombre', 'mixto', null, 'tag'], trashed: 3 })
    expect(djSignals(db)).toMatchObject({ tracks: 5, withBpmOrKey: 3, imported: false })
  })

  it('junta los nombres de las carpetas de las colecciones y de la carpeta raíz', () => {
    const db = base('b.db', { rules: ['Sets', 'Rock/Vivo', 'PIONEER'], root: 'Mi Música/Rekordbox' })
    const f = djSignals(db).folders
    expect(f).toEqual(expect.arrayContaining(['Sets', 'Rock', 'Vivo', 'PIONEER', 'Mi Música', 'Rekordbox']))
    expect(djOfferReasons(djSignals(db))).not.toEqual([])
  })

  it('ve lo traído de Rekordbox o de Serato', () => {
    expect(djSignals(base('c.db', { sources: ['mixto'], rb: true })).imported).toBe(true)
    expect(djSignals(base('d.db', { sources: ['mixto'], serato: true })).imported).toBe(true)
    expect(djSignals(base('e.db', { sources: ['mixto'] })).imported).toBe(false)
  })

  it('una biblioteca común no ofrece nada', () => {
    expect(djOfferReasons(djSignals(base('f.db', { sources: ['mixto', 'mixto', null], rules: ['Rock', 'Jazz'] })))).toEqual([])
  })
})

describe('la interfaz: un solo modo, a la vista', () => {
  it('ya no hay pregunta "¿Para qué usás tu música?" ni elección de tres perfiles', () => {
    expect(fs.existsSync(path.join(ROOT, 'apps/paila/ui/src/ProfileAsk.tsx'))).toBe(false)
    expect(fs.existsSync(path.join(ROOT, 'apps/paila/ui/src/UseProfileChooser.tsx'))).toBe(false)
    for (const f of ['Wizard.tsx', 'Settings.tsx', 'App.tsx']) expect(read(`apps/paila/ui/src/${f}`)).not.toMatch(/¿Para qué usás tu música\?|UseProfileChooser|ProfileAsk/)
  })

  it('el interruptor está en Configuración y en Ctrl+K (ya no en la barra lateral: decisión del 27/10)', () => {
    expect(read('apps/paila/ui/src/Sidebar.tsx')).not.toMatch(/side-switch|setDjTools/)
    expect(read('apps/paila/ui/src/Settings.tsx')).toContain('setDjTools')
    expect(read('apps/paila/ui/src/CommandPalette.tsx')).toMatch(/herramientas para DJ y producción/)
    expect(DJ_TOOLS_NAME).toBe('Herramientas para DJ y producción')
    expect(DJ_TOOLS_HELP.length).toBeGreaterThan(40)
  })

  it('la sección "DJ y producción" depende de las herramientas; lo demás de la barra no', () => {
    const side = read('apps/paila/ui/src/Sidebar.tsx')
    expect(side).toContain('partesDe(sec, djTools)')
    expect(read('apps/paila/ui/src/secciones.ts')).toMatch(/djTools \|\| !SOLO_DJ\.has\(p\)/)
    expect(read('apps/paila/ui/src/Settings.tsx')).toMatch(/profile\.djTools && \([\s\S]*BpmRanges/)
  })

  it('"Carpetas → Playlists" no está en "DJ y producción": va en Llevar, para todos', async () => {
    const { NAV_GROUPS } = await import('../apps/paila/ui/src/nav')
    const grupo = (id: string) => NAV_GROUPS.find((g) => g.id === id)!
    expect(grupo('dj').items.map((i) => i.page)).not.toContain('folderpl')
    expect(grupo('carry').items.map((i) => i.page)).toContain('folderpl')
    expect(grupo('carry').title).toBe('Llevar')
  })

  it('la oferta pregunta una sola vez y sin tapar nada', () => {
    const o = read('apps/paila/ui/src/DjOffer.tsx')
    expect(o).toContain('dismissOffer')
    expect(o).toContain('Ahora no')
    expect(read('apps/paila/electron/ipc/library.ts')).toMatch(/profile:offer[\s\S]*DJ_TOOLS_OFFERED[\s\S]*profile:offered/)
  })
})

describe('el estilo de fábrica', () => {
  const guardado = new Map<string, string>()
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const poner = (ls: unknown) => Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true })
  afterEach(() => { if (original) Object.defineProperty(globalThis, 'localStorage', original); else delete (globalThis as { localStorage?: unknown }).localStorage; guardado.clear() })
  const falso = () => ({ getItem: (k: string) => guardado.get(k) ?? null, setItem: (k: string, v: string) => { guardado.set(k, v) } })

  it('quien no eligió ve la historieta', () => {
    poner(falso())
    expect(ESTILO_DE_FABRICA).toBe('historieta')
    expect(leerEstilo()).toBe('historieta')
    expect(ESTILOS[0].key).toBe('historieta')
  })

  it('quien ya eligió el sobrio se respeta; y si no se puede leer lo guardado, historieta', () => {
    poner(falso())
    guardado.set('paila.estilo', 'actual')
    expect(leerEstilo()).toBe('actual')
    guardado.set('paila.estilo', 'otra cosa')
    expect(leerEstilo()).toBe('historieta')
    poner({ getItem: () => { throw new Error('sin almacenamiento') } })
    expect(leerEstilo()).toBe('historieta')
  })

  it('el sobrio se elige desde Configuración (ya no desde la barra lateral: decisión del 27/10)', () => {
    expect(read('apps/paila/ui/src/Sidebar.tsx')).not.toMatch(/setEstilo/)
    expect(read('apps/paila/ui/src/Settings.tsx')).toContain('EstiloChooser')
  })
})
