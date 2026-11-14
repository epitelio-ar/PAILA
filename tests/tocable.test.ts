// Lo que se ve tocable hace algo (prueba con la persona 2, 01/11: tocaba las notas de Análisis, el disco y el artista en Escuchando, y
// el tema que suena en la cola, y no pasaba nada). Acá: la búsqueda "nota:F" que usan las notas de Análisis, y que esas
// pantallas tengan sus partes tocables conectadas.
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { queryTracks, type TableQuery } from '@paila/shared/tableview'
import type { Track } from '@paila/shared/types'

const tema = (id: number, title: string, grade: string | null, kind = 'musica') =>
  ({ id, title, artist: 'Sumo', album: 'Divididos por la felicidad', genre: null, rel: `${title}.mp3`, kind, grade, size: 1, ext: 'mp3' }) as unknown as Track
const temas = [tema(1, 'Mañana en el Abasto', 'F'), tema(2, 'La rubia tarada', 'A+'), tema(3, 'Divina TV Führer', 'A'), tema(4, 'Heroína', 'F', 'sets'), tema(5, 'Sin nota', null)]
const q = (query: string, extra: Partial<TableQuery> = {}): number[] =>
  queryTracks(temas, { kind: 'todo', problem: null, query, plIds: null, sort: { key: 'order', dir: 1 }, ...extra }, false).map((t) => t.id)
const src = (f: string) => fs.readFileSync(`apps/paila/ui/src/${f}`, 'utf8')

describe('buscar por nota', () => {
  it('"nota:F" deja solo los temas con esa nota, en todas las colecciones', () => {
    expect(q('nota:F')).toEqual([1, 4])
    expect(q('grade:f')).toEqual([1, 4])
  })
  it('"nota:A" no trae los A+ (y "nota:A+" solo esos)', () => {
    expect(q('nota:A')).toEqual([3])
    expect(q('nota:A+')).toEqual([2])
  })
  it('se suma a las palabras, a la colección y a los problemas', () => {
    expect(q('nota:F abasto')).toEqual([1])
    expect(q('nota:F', { kind: 'musica' })).toEqual([1])
  })
  it('una palabra parecida que no es una nota se busca como texto', () => {
    expect(q('nota:Z')).toEqual([])
    expect(q('sumo')).toEqual([1, 2, 3, 4, 5])
  })
})

describe('las partes tocables están conectadas', () => {
  it('Análisis: cada nota con temas es un botón que busca esa nota', () => {
    expect(src('Progress.tsx')).toMatch(/className="gbar tocable"[^>]*onClick=\{\(\) => buscarNota\(g\)\}/)
  })
  it('Escuchando: la tapa y el título abren la ficha; el artista y el disco, la biblioteca', () => {
    const s = src('Escuchando.tsx')
    expect(s).toMatch(/esc-figu tocable" onClick=\{ficha\}/)
    expect(s).toMatch(/buscarEnBiblioteca\(d\.artist\)/)
    expect(s).toMatch(/buscarEnBiblioteca\(track\.album!\)/)
  })
  it('la cola: lo que suena abre su ficha', () => {
    expect(src('PlayerQueue.tsx')).toMatch(/<Row id=\{q\.current\}[^>]*onClick=\{onOpenTrack/)
  })
  it('la barra de abajo ya no vuelve de Escuchando: ahí no es tocable', () => {
    expect(src('Player.tsx')).toMatch(/const tocable = track \? !expanded/)
  })
  it('con Escuchando abierto, la barra de abajo no repite controles, línea de tiempo ni volumen', () => {
    const s = src('Player.tsx')
    expect(s).toMatch(/<div className="player-centro">\{!expanded && <>\{botones\(false\)\}/)
    expect(s).toMatch(/\{!expanded && <>\{calidad\}\{pulso\}\{volumen\}<\/>\}/)
  })
  it('Separar voz: la fila (que se ilumina al pasar el mouse) hace sonar el tema', () => {
    expect(src('SepararVoz.tsx')).toMatch(/className="box-row"[^\n]*onClick=\{\(e\) => \{ if \(!\(e\.target as HTMLElement\)\.closest\('button'\)\) onPlay\?\.\(t\.id\) \}\}/)
    expect(src('App.tsx')).toMatch(/<SepararVoz onPlay=\{playId\} \/>/)
  })
  it('NAPIA: cada fila tiene qué hacer (tu copia, buscarlo de otra forma o verlo en PAILA)', () => {
    const s = fs.readFileSync('apps/napia/ui/src/Bajada.tsx', 'utf8')
    expect(s).toMatch(/accion=\{accionDe\(t\)\}/)
    expect(s).toMatch(/reintentar\(\[t\]\)/)
    expect(s).toMatch(/verEnPaila\(status\.folder!\)/)
  })
  it('App escucha las búsquedas que piden las otras pantallas', () => {
    expect(src('App.tsx')).toMatch(/alBuscar\(\(q\) => ir\(`\?\$\{q\}`\)\)/)
  })
})

describe('Organizar ya no pide aplicar los nombres primero (la vuelta 3, resuelta en la etapa 2 del MASTERPLAN-5)', () => {
  it('mira cómo van a quedar los temas y suma lo que mueve a la lista única: el orden lo pone Aplicar', () => {
    expect(src('App.tsx')).not.toMatch(/pendientesQueMueven/)
    expect(src('Organize.tsx')).toMatch(/window\.paila\.sumarMover\(/)
    expect(src('Organize.tsx')).not.toMatch(/organizeApply/)
  })
})

describe('Análisis: la barra grande sigue a la pasada que corre', () => {
  it('con todo escuchado y una pasada aparte en marcha, la barra y el texto son de esa pasada (no quedan en 100 %)', () => {
    const s = src('Progress.tsx')
    expect(s).toMatch(/const enPasada = !!d && d\.done >= d\.total && scan\.running && scan\.job === 'analysis' && scan\.toProbe > 0/)
    expect(s).toMatch(/const pct = enPasada \? Math\.round\(\(scan\.probed \* 100\) \/ scan\.toProbe\)/)
    expect(s).toMatch(/enPasada \? T\.avancePasada\(/)
  })
})

describe('Completar desde internet: secciones plegadas', () => {
  it('abre la primera que falta; la que elegís manda; 0 = todas cerradas', async () => {
    const { primeraAbierta } = await import('../apps/paila/ui/src/Plegable')
    const listo = { listo: true, texto: 'listo' }, falta = { listo: false, texto: 'faltan 6 búsquedas' }
    expect(primeraAbierta(null, [listo, falta, falta])).toBe(2)
    expect(primeraAbierta(null, [listo, listo, listo])).toBeNull()
    expect(primeraAbierta(null, [undefined, falta])).toBe(2)
    expect(primeraAbierta(3, [falta, falta, falta])).toBe(3)
    expect(primeraAbierta(0, [falta])).toBe(0)
  })
})

describe('El pie de la barra lateral: Configuración, Historial, Papelera y tus discos', () => {
  it('los tres botones llevan su nombre, y cada disco dice cuál es y se puede expulsar si es externo', () => {
    expect(src('Sidebar.tsx')).toMatch(/<span className="side-pie-label">\{it\.label\}<\/span>/)
    const s = src('SidePie.tsx')
    expect(s).toMatch(/d\?\.nombre/)
    expect(s).toMatch(/sel\.conectado && sel\.externo && <Boton[^>]*onClick=\{\(\) => void expulsar\(sel\)\}/)
    expect(s).toMatch(/window\.paila\.openFolder\(sel\.carpeta\)/)
    // expulsar pasa por el candado de operaciones y la pausa del análisis
    expect(fs.readFileSync('apps/paila/electron/ipc/discos.ts', 'utf8')).toMatch(/return c\.withPaused\(async \(\) => \{/)
  })
})

describe('La barra de arriba: una cosa por vez, sin cartelitos para cerrar', () => {
  it('aplicar bien no deja cartel de resultado ni «Terminó»: la barra dice «Listo» con Deshacer', () => {
    const s = src('ChangesBar.tsx')
    expect(s).toMatch(/if \(r\.failed\.length\) setRes\(/)
    expect(s).toMatch(/else \{ setRes\(null\); setRecien\(true\) \}/)
    expect(s).toMatch(/if \(job && !job\.running && !job\.failed && !job\.problems\.length\) void window\.paila\.dismissJob\('apply'\)/)
  })
  it('los avisos van abajo, arriba del reproductor (no tapan Aplicar)', () => {
    expect(src('styles/marco.css')).toMatch(/\.toasts \{ top: auto; bottom: calc\(80px \+ 26px \+ 14px\); \}/)
  })
  it('las pantallas que proponen se enteran cuando cambian los Cambios pendientes', () => {
    for (const f of ['Online.tsx', 'Genres.tsx', 'OfficialNames.tsx', 'Tidy.tsx']) expect(src(f)).toMatch(/useAlCambiarCambios\(/)
    expect(src('hooks/useChanges.ts')).toMatch(/window\.dispatchEvent\(new Event\(CAMBIOS\)\)/)
  })
})

describe('Organizar (repaso del 01/11)', () => {
  it('la vista previa se calcula sola, separa carpetas de nombres y se puede ordenar sin renombrar', () => {
    const s = src('Organize.tsx')
    expect(s).not.toMatch(/T\.vistaPrevia\}/) // ya no hay botón "Ver vista previa"
    expect(s).toMatch(/window\.paila\.organizePlan\(\{ rule, dest: dest\.trim\(\), soloCarpetas \}\)/)
    expect(s).toMatch(/T\.resumen2\(n\(mudan\.length\), n\(renombran\.length\)/)
    expect(s).toMatch(/checked=\{!soloCarpetas\}/)
    expect(s).toMatch(/\{personalizar && \(<>/) // la regla con códigos, solo al personalizar
    expect(s).not.toMatch(/useJob\('organize'\)/) // ya no mueve sola: suma a la lista única y el avance es el de Aplicar (MASTERPLAN-5, etapa 2)
  })
})
