// Las respuestas del autor del 13/11 sobre Sonido (docs/DECISIONES.md, "Sonido y la poda"), un test por cada una:
// 1. las copias mejores se proponen solo en Sonido y en la barra de arriba; 2. la pantalla sigue llamándose "Sonido de un vistazo";
// 3. NAPIA queda minimizada al terminar (nunca se trae adelante sola); 4. "Un disco" con varias ediciones no elige sola: marca la
// sugerida; 5. lo que se ofrece mejorar va de peor a mejor sonido; 6. las carpetas se escanean solas al abrir, con un botón chico.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { NAV_GROUPS } from '../apps/paila/ui/src/nav'
import { buscarEdiciones, claseEdicion, sugerida, type Pedir } from '@paila/core/sockseek/disco'
import { peorPrimero } from '@paila/core/peor-primero'
import { escanearAlAbrir } from '@paila/core/escaneo-al-abrir'
import type { EdicionDisco } from '@paila/shared/napia'

const ROOT = path.join(__dirname, '..')
const leer = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const archivos = (d: string): string[] => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? archivos(path.join(d, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : []))

describe('1. las copias mejores, solo en Sonido y en la barra de arriba', () => {
  it('la Bandeja ya no tiene "Reemplazar todos": lleva a Sonido y solo aparta lo que no sirve', () => {
    const inbox = leer('apps/paila/ui/src/Inbox.tsx'), plan = leer('apps/paila/ui/src/InboxPlan.tsx')
    expect(inbox).not.toMatch(/reemplazarTodos/)
    expect(inbox).toMatch(/onSonido/)
    expect(plan).toMatch(/setPlan\(soloApartar\(p\)\)/)
    expect(plan).toMatch(/soloApartar = \(p: InboxPlan\): InboxPlan => \(\{ \.\.\.p, replace: \[\]/)
    expect(leer('apps/paila/ui/src/App.tsx')).toMatch(/<Inbox onSonido=\{\(\) => setPage\('sonido'\)\}/)
  })
  it('ninguna otra pantalla aplica reemplazos por su cuenta: solo la Bandeja aparta, y las propuestas "reemplazo" las mira solo Sonido', () => {
    const ui = archivos('apps/paila/ui/src')
    expect(ui.filter((f) => leer(f).includes('inboxApply(')).map((f) => path.basename(f))).toEqual(['InboxPlan.tsx'])
    expect(ui.filter((f) => /field === 'reemplazo'/.test(leer(f))).map((f) => path.basename(f)).sort()).toEqual(['ChangesBar.tsx', 'Sonido.tsx'])
    // la revisión de Ordenar no las muestra
    expect(leer('packages/core/revision.ts')).toMatch(/reemplazo/)
  })
  it('los textos que mandaban a "Reemplazar todos" ahora dicen Sonido de un vistazo', () => {
    for (const f of ['apps/paila/ui/src/Inbox.textos.ts', 'apps/paila/ui/src/Wishlist.tsx', 'apps/paila/ui/src/WantedList.tsx', 'apps/paila/ui/src/nav.ts']) {
      expect(leer(f), f).not.toMatch(/Reemplazar todos|Replace all/)
    }
  })
})

describe('2. el nombre', () => {
  it('la pantalla sigue llamándose "Sonido de un vistazo"', () => {
    const item = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.page === 'sonido')
    expect(item?.label).toMatch(/^(Sonido de un vistazo|Sound at a glance)$/)
  })
})

describe('3. NAPIA queda minimizada al terminar', () => {
  it('lo único que la trae adelante es que le falte algo para bajar, o que la abras vos', () => {
    const napia = [...archivos('apps/napia/electron'), ...archivos('apps/napia/ui/src')]
    const lineas = napia.flatMap((f) => leer(f).split('\n').filter((l) => /\.(show|restore|focus|flashFrame|moveTop)\(/.test(l)).map((l) => `${path.basename(f)}: ${l.trim()}`))
    expect(lineas).toHaveLength(3)
    expect(lineas.every((l) => l.startsWith('main.ts: '))).toBe(true)
    // al abrirla desde Sonido: adelante solo si le falta algo (desdePaila devuelve qué); si no, minimizada y sin robar el foco
    expect(lineas.some((l) => l.includes('if (desdePaila(inicial)) w.show(); else { w.showInactive(); w.minimize() }'))).toBe(true)
    // otra lista desde PAILA con NAPIA ya abierta: si no le falta nada, ni se trae adelante
    expect(leer('apps/napia/electron/main.ts')).toMatch(/if \(f0 && bajarSola\(argv\) && !desdePaila\(f0\)\) return/)
    // al terminar una lista no hay avisos que la abran: ni notificaciones ni diálogos que no pidas
    expect(napia.filter((f) => /new Notification\(/.test(leer(f)))).toEqual([])
  })
})

const ed = (id: string, titulo: string, anio: string | null, temas: number, fuente: EdicionDisco['fuente'] = 'musicbrainz'): EdicionDisco =>
  ({ fuente, id, artista: 'Soda Stereo', titulo, anio, pais: null, formato: null, temas, tipo: 'Album' })

describe('4. Un disco con varias ediciones: no elige sola', () => {
  const eds = [ed('a', 'Signos', '1986', 8), ed('b', 'Signos (Remasterizado)', '2007', 8), ed('c', 'Signos (Edición de Lujo)', '2016', 14)]
  it('sugiere la que más se parece a lo escrito; si empatan, la más vieja', () => {
    expect(sugerida(eds, 'Soda Stereo', 'Signos')).toBe(0)
    expect(sugerida(eds, 'Soda Stereo', 'Signos de lujo')).toBe(2)
    expect(sugerida(eds, 'Soda Stereo', 'Signos remasterizado')).toBe(1)
    expect(sugerida([], 'x', 'y')).toBe(-1)
  })
  it('dice cuál es la original, la remasterizada y la de lujo', () => {
    expect(eds.map((e) => claseEdicion(e, eds))).toEqual(['original', 'remaster', 'deLujo'])
    expect(claseEdicion(eds[0], [eds[0]])).toBeNull()
  })
  it('la búsqueda marca una sola sugerida (solo si hay varias) y la pantalla no elige ninguna hasta que la persona toca', async () => {
    const mb = { releases: [{ id: 'm2', title: 'Signos (Remasterizado)', date: '2007-05-01', status: 'Official', 'track-count': 8 }, { id: 'm1', title: 'Signos', date: '1986-11-10', status: 'Official', 'track-count': 8 }] }
    const pedir: Pedir = async (u) => (u.includes('musicbrainz') ? mb : { data: [] })
    const r = await buscarEdiciones('Soda Stereo', 'Signos', pedir)
    expect(r.map((e) => `${e.id}:${e.anio}:${e.temas}:${e.clase}:${!!e.sugerida}`)).toEqual(['m1:1986:8:original:true', 'm2:2007:8:remaster:false'])
    const una = await buscarEdiciones('Soda Stereo', 'Signos', async (u) => (u.includes('musicbrainz') ? { releases: [mb.releases[1]] } : { data: [] }))
    expect(una[0].sugerida).toBeUndefined()
    const ui = leer('apps/napia/ui/src/UnDisco.tsx')
    // con una sola edición sigue como antes (la trae sola); con varias, ninguna elegida hasta que se toca
    // (salvo que MusicBrainz no haya contestado: puede haber más, y no se elige sola)
    expect(ui).toMatch(/if \(r\.ediciones\.length === 1 && !r\.sinMusicbrainz\) void elegir\(r\.ediciones\[0\]\)/)
    expect(ui).toMatch(/e\.sugerida && <><Pildora tone="ok">\{T\.sugerida\}<\/Pildora><Info tip=\{T\.sugeridaTip\} \/><\/>/)
    expect(ui).not.toMatch(/elegir\(r\[sugerida|\.find\(\(e\) => e\.sugerida\)/)
  })
})

describe('5. de peor a mejor sonido', () => {
  it('primero la peor nota (lo que no tenés antes que todo), y con la misma nota, el de menos kbps de verdad', () => {
    const xs = [
      { title: 'B 320', grade: 'B', effKbps: 320 }, { title: 'D 192', grade: 'D', effKbps: 192 }, { title: 'D 128', grade: 'D', effKbps: 128 },
      { title: 'F', grade: 'F', effKbps: 96 }, { title: 'D sin medir', grade: 'D', effKbps: null }, { title: 'falta', grade: null, effKbps: null },
    ]
    expect([...xs].sort(peorPrimero).map((x) => x.title)).toEqual(['falta', 'F', 'D 128', 'D 192', 'D sin medir', 'B 320'])
  })
  it('se usa en la lista, en lo que va a NAPIA (también "mejorar estos temas") y en los ejemplos de Sonido', () => {
    const wanted = leer('packages/core/wanted.ts')
    expect(wanted).toMatch(/ORDER\[a\.status\] - ORDER\[b\.status\] \|\| peorPrimero\(a, b\)/)
    expect(wanted).toMatch(/soloQue\(i, opts\.que\)\)\.sort\(peorPrimero\)/)
    expect(leer('packages/core/wanted-napia.ts')).toMatch(/\[\.\.\.filas\]\.sort\(peorPrimero\)/)
    expect(leer('apps/paila/electron/ipc/sonido.ts')).toMatch(/i\.fileId != null\)\.sort\(peorPrimero\)/)
  })
})

describe('6. las carpetas se escanean solas al abrir', () => {
  const base = { carpetas: 2, ocupada: false, snapshot: false, env: {} }
  it('escanea al abrir, salvo sin carpetas, con algo corriendo, en una captura o si se pide que no', () => {
    expect(escanearAlAbrir(base)).toBe(true)
    expect(escanearAlAbrir({ ...base, carpetas: 0 })).toBe(false)
    expect(escanearAlAbrir({ ...base, ocupada: true })).toBe(false)
    expect(escanearAlAbrir({ ...base, snapshot: true })).toBe(false)
    expect(escanearAlAbrir({ ...base, env: { PAILA_SIN_ESCANEO_AL_ABRIR: '1' } })).toBe(false)
  })
  it('PAILA lo hace al abrir, y arriba queda un botón chico con su ⓘ', () => {
    expect(leer('apps/paila/electron/main.ts')).toMatch(/if \(escanearAlAbrir\(\{ carpetas: lib\.roots\(\)\.length, ocupada: lib\.status\.running \|\| !!lib\.ops\.busy, snapshot: !!snapshot \}\)\) void scanThenAnalyze\(\)/)
    expect(leer('apps/paila/ui/src/App.tsx')).toMatch(/<Boton variant="ghost" size="sm" onClick=\{\(\) => startScan\(\)\} title=\{T\.escanearTip\}>\{T\.escanear\}<\/Boton><Info tip=\{T\.escanearTip\} \/>/)
  })
})
