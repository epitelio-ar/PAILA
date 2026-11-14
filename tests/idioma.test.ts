// La base para traducir (@paila/shared/idioma, Rico de @paila/diseno y la revisión de textos sueltos): elegir el idioma,
// los pares, números, fechas y plurales en los dos idiomas, y que lo que PAILA escribe en los archivos no cambie con el idioma.
import { afterEach, describe, expect, it } from 'vitest'
import { createElement, isValidElement, type ReactElement } from 'react'
import { cant, fecha, fechaHora, idioma, idiomaDelSistema, lista, num, plural, ponerIdioma, textos, tr } from '@paila/shared/idioma'
import { rico } from '@paila/diseno'
import { DEFAULT_RULE, targetFor, type TagRow } from '@paila/core/organizer'
import { esFrase, textosSueltos } from '../scripts/textos-sueltos'

afterEach(() => ponerIdioma('es'))

describe('elegir el idioma', () => {
  it('la primera vez toma el de Windows; si no es castellano ni inglés, castellano', () => {
    expect(idiomaDelSistema(['es-AR', 'en-US'])).toBe('es')
    expect(idiomaDelSistema(['en-GB'])).toBe('en')
    expect(idiomaDelSistema(['fr-FR', 'en-US'])).toBe('en')
    expect(idiomaDelSistema(['pt-BR', 'de-DE'])).toBe('es')
    expect(idiomaDelSistema([])).toBe('es')
    expect(idiomaDelSistema(['ES_mx'])).toBe('es')
  })
  it('sin nada que lo diga (tests, núcleo), castellano', () => {
    expect(idioma()).toBe('es')
  })
})

describe('textos en pares', () => {
  const T = textos({
    titulo: { es: 'Duplicados', en: 'Duplicates' },
    temas: { es: (n: number) => `Hay ${cant(n, 'tema', 'temas')}`, en: (n: number) => `There are ${cant(n, 'track', 'tracks')}` },
  })
  const NAV = [{ label: T.titulo }] // armado al cargar el archivo: vale porque la ventana sabe el idioma antes (preload)

  it('cada texto se lee en el idioma de ahora', () => {
    expect(T.titulo).toBe('Duplicados')
    expect(T.temas(1)).toBe('Hay 1 tema')
    ponerIdioma('en')
    expect(T.titulo).toBe('Duplicates')
    expect(T.temas(1234)).toBe('There are 1,234 tracks')
    expect(tr({ es: 'Guardar', en: 'Save' })).toBe('Save')
    expect(NAV[0].label).toBe('Duplicados')
  })

  it('números, fechas, plurales y listas con el formato de cada idioma', () => {
    const d = new Date(2026, 9, 23)
    expect(num(12345.5)).toBe('12.345,5')
    expect(fecha(d)).toBe('23/10/2026')
    expect(cant(0, 'tema', 'temas')).toBe('0 temas')
    expect(plural(1, 'tema', 'temas')).toBe('tema')
    expect(lista(['A', 'B', 'C'])).toBe('A, B y C')
    ponerIdioma('en')
    expect(num(12345.5)).toBe('12,345.5')
    expect(fecha(d)).toBe('10/23/2026')
    expect(cant(1, 'track', 'tracks')).toBe('1 track')
    expect(lista(['A', 'B', 'C'])).toBe('A, B, and C')
  })

  it('fecha y hora: en castellano, de 24 horas (es-AR la daba de 12 y sin "p. m.": las 18:30 salían "06:30:00")', () => {
    const tarde = new Date(2026, 8, 14, 18, 30, 0)
    expect(fechaHora(tarde)).toBe('14/9/2026, 18:30:00')
    ponerIdioma('en')
    expect(fechaHora(tarde)).toBe('9/14/2026, 6:30:00 PM')
  })
})

describe('frases con negrita y huecos (Rico)', () => {
  it('arma la negrita y pone cada parte en su hueco', () => {
    const marca = createElement('span', null, 'i')
    const r = rico('Tenés **{n} temas** sin tapa {info}', { n: 3, info: marca })
    const b = r.find((x) => isValidElement(x) && x.type === 'b') as ReactElement<{ children: unknown[] }>
    expect(b).toBeTruthy()
    expect(JSON.stringify(b.props.children)).toContain(' temas')
    expect(r[0]).toBe('Tenés ')
    expect(JSON.stringify(r.at(-1))).toContain('"i"')
  })
  it('un hueco sin parte queda escrito tal cual (se nota al probar)', () => {
    expect(rico('Hola {nadie}')).toEqual(['Hola ', '{nadie}'])
  })
})

describe('lo que PAILA escribe en los archivos no cambia con el idioma', () => {
  const row = (o: Partial<TagRow>): TagRow => ({ id: 1, rootId: 1, rel: 'x.mp3', ext: 'mp3', kind: 'musica', artist: 'Otro', albumArtist: 'Various Artists', title: 'Tema', album: 'Disco', track: '3', year: '1996', genre: 'Rock', ...o })
  it('las carpetas de Organizar salen iguales en inglés', () => {
    const es = targetFor(row({}), { rule: DEFAULT_RULE, dest: '' })
    ponerIdioma('en')
    expect(targetFor(row({}), { rule: DEFAULT_RULE, dest: '' })).toBe(es)
    expect(es.startsWith('Varios Artistas/')).toBe(true)
  })
})

describe('revisión de textos sueltos', () => {
  it('distingue frases de claves, clases, rutas y nombres que no se traducen', () => {
    expect(esFrase('Guardar')).toBe(true)
    expect(esFrase('ver más')).toBe(true)
    expect(esFrase('row small muted')).toBe(false)
    expect(esFrase('produccion')).toBe(false)
    expect(esFrase('Rekordbox')).toBe(false)
    expect(esFrase('/ruta/a.png')).toBe(false)
    expect(esFrase('M12 3a9 9 0 100 18')).toBe(false)
    expect(esFrase('guardar', true)).toBe(true)
  })
  it('encuentra texto entre etiquetas, atributos, labels, toasts y es-AR a mano', () => {
    const codigo = [
      "const NAV = [{ key: 'home', label: 'Inicio' }]",
      "export const X = () => <div className=\"row small\" title=\"Abrir la ficha\" onKeyDown={(e) => e.key === 'ArrowRight'}>",
      '  Hola {n.toLocaleString(\'es-AR\')} <b>{ok ? \'Listo\' : T.no}</b>',
      "  <button onClick={() => toast('Se guardó')}>{T.guardar}</button>",
      "  {/* idioma-ok */}<span>Rekordbox Pro</span>",
      '</div>',
    ].join('\n')
    expect(textosSueltos(codigo).map((x) => `${x.linea}:${x.texto.split(' ')[0]}`)).toEqual(['1:Inicio', '2:Abrir', '3:Hola', "3:'es-AR'", '3:Listo', '4:Se'])
  })
  it('también los textos guardados en variables y propiedades (help, hace), pero no las claves', () => {
    const c = [
      'const title = `El tempo va de ${a} a ${b}`',
      "const A = [{ tecla: 'G', page: 'home', hace: 'Ir al inicio' }]",
      "if (e.key === 'Escape') localStorage.setItem('paila.x', 'Algo')",
    ].join('\n')
    expect(textosSueltos(c, 'x.ts').map((x) => x.texto)).toEqual(['El tempo va de … a …', 'Ir al inicio'])
  })
  it('lo que va en pares no cuenta', () => {
    expect(textosSueltos("const T = textos({ a: { es: 'Hola', en: 'Hello' } })\nexport const Y = () => <p title={T.a}>{T.a}</p>")).toEqual([])
  })
})
