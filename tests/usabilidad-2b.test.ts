// Las propuestas de la segunda tanda de usabilidad (docs/pruebas/2026-10-27-usabilidad-2.md, decididas por el autor el 27/10):
// P1 la lista «Faltan o suenan mal» no traba la app (los nombres se limpian en un hilo aparte), la lista aprovecha el espacio,
// P2 flechas en la barra lateral, P3 el motivo de la Bandeja en los dos idiomas y P4 el pie fijo de Llevar la música.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { Wanted } from '@paila/core/wanted'
import { namesTidy } from '@paila/core/wanted-limpios'
import { InboxFlow } from '@paila/core/inboxflow'
import { findFfprobe } from '@paila/core/probe'
import type { Inbox } from '@paila/core/inbox'
import type { CandidateInfo, Replacer } from '@paila/core/replace'
import type { TidyChange } from '@paila/core/tidy'
import { ponerIdioma } from '@paila/shared/idioma'
import { destino, ordenar } from '../apps/paila/ui/src/barraTeclado'

const ROOT = path.join(__dirname, '..')
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8')
const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
let dir: string, lib: Library
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-usab2b-'))
  fs.mkdirSync(path.join(dir, 'M'))
  lib = new Library(path.join(dir, 'paila.db'), null)
  const root = await lib.addRoot(path.join(dir, 'M'), [{ rel: '', kind: 'musica' }])
  // un tag con letras rotas (mojibake): "Arreglar nombres" lo arregla, los tags no
  lib.db.prepare("INSERT INTO files (id, root_id, rel_path, size, mtime, kind, ext, duration, artist, title, probed_at) VALUES (1, ?, 'Bajados/a.mp3', 1, 1, 'musica', 'mp3', 1, 'BeyoncÃ©', 'Halo', '2026-10-27')").run(root.id)
  lib.db.prepare("INSERT INTO analysis (file_id, version, src_size, src_mtime, analyzed_at, grade, eff_kbps) VALUES (1, 1, 1, 1, '2026-10-27', 'A', 1411)").run()
})
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('P1. Faltan o suenan mal: los nombres se limpian en un hilo aparte', () => {
  it('sin hilo (tests, scripts) se limpia acá mismo, como antes', () => {
    expect(namesTidy(lib.db).some((c) => c.id === 1 && c.field === 'artist' && c.to === 'Beyoncé')).toBe(true)
    expect(new Wanted(lib.db).names([1]).get(1)).toEqual({ artist: 'Beyoncé', title: 'Halo' })
  })

  it('con hilo, la lista sale enseguida con los nombres de los tags; al llegar el aviso, limpios', async () => {
    const w = new Wanted(lib.db)
    let soltar: (c: TidyChange[]) => void = () => {}
    const pedidos: unknown[] = [], avisos: boolean[] = []
    w.limpios.enHilo((r) => { pedidos.push(r); return new Promise((res) => { soltar = res }) }, (l) => avisos.push(l))
    expect(w.names([1], undefined, true).get(1)).toEqual({ artist: 'BeyoncÃ©', title: 'Halo' })
    expect(w.limpios.limpiando).toBe(true)
    w.names([1], undefined, true) // pedirla otra vez no arranca otro hilo
    expect(pedidos).toHaveLength(1)
    expect(avisos).toEqual([true])
    soltar(namesTidy(lib.db))
    await w.limpios.limpiar()
    expect(avisos).toEqual([true, false])
    expect(w.names([1], undefined, true).get(1)).toEqual({ artist: 'Beyoncé', title: 'Halo' })
  })

  it('la lista entera tampoco espera: list() pide sin esperar; exportar y guardar un estado sí esperan el nombre limpio', async () => {
    const w = new Wanted(lib.db)
    let soltar: (c: TidyChange[]) => void = () => {}
    w.limpios.enHilo(() => new Promise((res) => { soltar = res }), () => {})
    const crit = { bad: false, fair: false, fakes: false, rekordbox: false, mp3like: false }
    lib.db.prepare("UPDATE analysis SET grade = 'F' WHERE file_id = 1").run()
    try {
      expect(w.list({ ...crit, bad: true }).find((i) => i.fileId === 1)?.artist).toBe('BeyoncÃ©')
      const espera = w.limpios.limpiar()
      soltar(namesTidy(lib.db))
      await espera
      expect(w.list({ ...crit, bad: true }).find((i) => i.fileId === 1)?.artist).toBe('Beyoncé')
      w.setStatus('f1', 'ignorar')
      expect(lib.db.prepare('SELECT artist FROM wanted WHERE file_id = 1').get()).toEqual({ artist: 'Beyoncé' })
    } finally { lib.db.prepare("UPDATE analysis SET grade = 'A' WHERE file_id = 1").run(); lib.db.prepare('DELETE FROM wanted').run() }
    const ipc = read('apps/paila/electron/ipc/inbox.ts')
    expect(ipc).toMatch(/wanted\.limpios\.enHilo\(/)
    expect(ipc.match(/await wanted\.limpios\.limpiar\(rules\(\)\)/g)).toHaveLength(3) // estado, exportar y NAPIA
  })

  it('si el hilo falla, se calcula acá (no queda pidiéndolo en un círculo)', async () => {
    const w = new Wanted(lib.db)
    let veces = 0
    w.limpios.enHilo(() => { veces++; return Promise.reject(new Error('sin hilo')) }, () => {})
    w.names([1], undefined, true)
    await w.limpios.limpiar()
    expect(w.names([1], undefined, true).get(1)).toEqual({ artist: 'Beyoncé', title: 'Halo' })
    expect(veces).toBe(1)
  })

  it('el hilo sabe hacer los dos trabajos (perfiles y nombres) y la pantalla vuelve a pedir la lista al aviso', () => {
    expect(read('packages/core/tidyworker.ts')).toMatch(/if \(job\.nombres\) result = namesTidy\(db, job\.rules\)/)
    expect(read('apps/paila/ui/src/WantedList.tsx')).toMatch(/onWantedLimpios\(\(l\) => \{ setLimpiando\(l\); if \(!l && crit\) void load\(crit\) \}\)/)
  })
})

describe('Faltan o suenan mal: los temas se ven sin bajar', () => {
  it('la explicación pasó a un ⓘ al lado de las pestañas, y acciones y filtros van en dos filas', () => {
    const w = read('apps/paila/ui/src/WantedList.tsx'), p = read('apps/paila/ui/src/Wishlist.tsx')
    expect(w).not.toMatch(/<Rico texto=\{T\.intro\}/)
    expect(p).not.toMatch(/<Rico texto=\{T\.intro\}/)
    expect(p).toMatch(/<Info tip=\{tab === 'tema' \? T\.introTema : T\.introDisco\} \/>/)
    expect(w).toMatch(/className="row wl-filtros"[\s\S]*<details className="wl-incluir">/)
    expect(read('apps/paila/ui/src/styles/listas.css')).toMatch(/\.wl-cab \{ position: sticky; top: 0;/)
  })
})

describe('P2. Barra lateral con flechas', () => {
  it('↑↓ (y ←→ en los íconos de abajo) se mueven de a uno, Inicio y Fin van a las puntas, sin pasarse', () => {
    expect([destino('ArrowDown', 0, 5), destino('ArrowUp', 0, 5), destino('ArrowRight', 4, 5), destino('ArrowLeft', 2, 5)]).toEqual([1, 0, 4, 1])
    expect([destino('Home', 3, 5), destino('End', 1, 5), destino('Tab', 1, 5), destino('Enter', 1, 5), destino('ArrowDown', 0, 0)]).toEqual([0, 4, null, null, null])
  })

  it('una sola parada del Tab: la última que tuvo el foco o, si no, la pantalla abierta', () => {
    const mk = (on = false, extra: Record<string, unknown> = {}) => {
      const attrs: Record<string, string> = {}
      return { tagName: 'BUTTON', disabled: false, isContentEditable: false, closest: () => null, getClientRects: () => [1], classList: { contains: (c: string) => on && c === 'on' }, getAttribute: (k: string) => attrs[k] ?? null, setAttribute: (k: string, v: string) => { attrs[k] = v }, ...extra }
    }
    const items = [mk(), mk(true), mk(), mk(false, { tagName: 'INPUT', type: 'text' }), mk(false, { getClientRects: () => [] })]
    const barra = { querySelectorAll: () => items } as unknown as HTMLElement
    const tabs = () => items.map((i) => i.getAttribute('tabindex'))
    expect(ordenar(barra, null)).toBe(items[1])
    expect(tabs()).toEqual(['-1', '0', '-1', null, null]) // el campo para escribir y lo que no se ve, ni se tocan
    ordenar(barra, items[2] as unknown as HTMLElement)
    expect(tabs().slice(0, 3)).toEqual(['-1', '-1', '0'])
  })

  it('la barra entera (navegación e íconos de abajo) usa las flechas', () => {
    const s = read('apps/paila/ui/src/Sidebar.tsx')
    expect(s).toMatch(/useFlechasBarra\(barra\)/)
    expect(s).toMatch(/<aside className="side" ref=\{barra\}>/)
  })
})

describe('P3. La Bandeja en el otro idioma, sin volver a revisar', () => {
  it('el motivo se guarda en castellano y en inglés, y se muestra el del idioma de hoy', async () => {
    const file = path.join(dir, 'Bandeja', 'b.mp3')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', file])
    const inbox = { workDir: path.join(dir, 'trabajo'), identify: async () => ({ artist: 'Beyoncé', title: 'Halo', missing: null, note: null, match: { fileId: 1, rel: 'Bajados/a.mp3', ext: 'mp3', kbps: 320, grade: 'A', duration: 1, by: 'sonido', kind: 'mismo', sharedSeconds: 1 } }) } as unknown as Inbox
    const peor = { grade: 'D', label: 'MP3 128', flags: [], duration: 1, effKbps: 128, clipEvents: 0, lufs: null, cutoff: 16000, spectrum: null, sampleRate: 44100, encoder: null } as unknown as CandidateInfo
    const flow = new InboxFlow(lib.db, inbox, new Wanted(lib.db), {} as Replacer, { ffprobe: findFfprobe()!, describe: async () => peor, inRekordbox: () => [] })
    ponerIdioma('es')
    try {
      const r = await flow.evaluate(file)
      expect(r.decision).toBe('no-sirve')
      expect(r.idiomas!.es.why).toBe(r.why)
      expect(r.idiomas!.en.why).not.toBe(r.idiomas!.es.why)
      expect(r.idiomas!.en.problems).toHaveLength(r.check!.problems.length)
      ponerIdioma('en')
      const en = flow.cached(file)!
      expect(en.why).toBe(r.idiomas!.en.why)
      expect(en.check!.problems).toEqual(r.idiomas!.en.problems)
      expect(en.check!.problemsEs).toEqual(r.check!.problems) // motivos.txt sigue en castellano
      // la traducción cambia solo las palabras: un aviso guardado (decide si se reemplaza solo) no lo borra
      const row = lib.db.prepare('SELECT result FROM inbox_items WHERE path = ?').get(file) as { result: string }
      const x = JSON.parse(row.result); x.check.warnings = ['Es otro master.']
      lib.db.prepare('UPDATE inbox_items SET result = ? WHERE path = ?').run(JSON.stringify(x), file)
      expect(flow.cached(file)!.check!.warnings).toEqual(['Es otro master.'])
    } finally { ponerIdioma('es') }
  })
})

describe('P4. Llevar la música: el botón siempre a la vista', () => {
  it('pie fijo abajo con qué se copia, de dónde y a dónde, y el botón', () => {
    const c = read('apps/paila/ui/src/CarryPhone.tsx')
    expect(c).toMatch(/<div className="pie-fijo">[\s\S]*T\.pieQue\(toCel, n\(plan\.items\.length\), fuente\(src, lists\)[\s\S]*<ConfirmarBoton[\s\S]*T\.pieBoton\(toCel\)/)
    expect(read('apps/paila/ui/src/styles/pages.css')).toMatch(/\.pie-fijo \{ position: sticky; bottom: calc\(-1 \* var\(--sp-6\)\);/) // pegado al borde de abajo, sin el relleno de la página
  })
})
