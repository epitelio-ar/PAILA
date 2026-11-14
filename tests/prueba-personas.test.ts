// Modo prueba (core/prueba.ts y core/prueba-informe.ts): el registro JSON Lines (pantallas, tiempo en cada una, volver atrás,
// clics con su pantalla), las tareas que se ven cumplidas en la base (una sola vez) y el informe por persona (tiempos y trabas).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { openDb } from '@paila/core/db'
import { RegistroPrueba, VigiaTareas, archivoRegistro, fueraDeLaPrueba, leerRegistro, tareasHechas, type LineaPrueba } from '@paila/core/prueba'
import { informeMarkdown, reloj, resumir } from '@paila/core/prueba-informe'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prueba-personas-'))
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

/** Un reloj que avanza a mano. */
function reloj0() {
  let t = new Date(2026, 9, 27, 15, 30, 0).getTime()
  return { ahora: () => new Date(t), pasar: (s: number) => { t += s * 1000 } }
}

describe('registro del modo prueba', () => {
  it('el archivo se llama por la hora local de apertura', () => {
    expect(path.basename(archivoRegistro(tmp, new Date(2026, 9, 27, 15, 30, 12)))).toBe('2026-10-27_15-30-12.jsonl')
  })

  it('anota pantallas con el tiempo en la anterior, "volver" al ir a la de antes, y la pantalla de cada clic', () => {
    const r0 = reloj0()
    const reg = new RegistroPrueba(path.join(tmp, 'a', 'r.jsonl'), r0.ahora)
    reg.anotar({ tipo: 'inicio', version: '0.5.17', musica: 'X' })
    reg.cambio('Inicio')
    r0.pasar(12)
    reg.cambio('Duplicados')
    reg.cambio('Duplicados') // la misma: no cuenta
    r0.pasar(30.5)
    reg.anotar({ tipo: 'clic', texto: 'Buscar repetidos', boton: true })
    reg.cambio('Inicio')
    const l = leerRegistro(reg.archivo)
    expect(l.map((x) => x.tipo)).toEqual(['inicio', 'pantalla', 'pantalla', 'clic', 'pantalla', 'volver'])
    expect(l[2]).toMatchObject({ pantalla: 'Duplicados', antes: 'Inicio', segAntes: 12, seg: 12, hora: '2026-10-27T15:30:12' })
    expect(l[3]).toMatchObject({ texto: 'Buscar repetidos', pantalla: 'Duplicados', seg: 42.5 })
    expect(l[4]).toMatchObject({ pantalla: 'Inicio', segAntes: 30.5 })
  })

  it('una línea cortada a la mitad no tira abajo la lectura', () => {
    const f = path.join(tmp, 'roto.jsonl')
    fs.writeFileSync(f, '{"tipo":"fin","hora":"x","seg":1}\n{"tipo":"cli')
    expect(leerRegistro(f)).toHaveLength(1)
  })
})

describe('tareas cumplidas, desde la base', () => {
  const db = openDb(path.join(tmp, 'paila.db'))
  db.exec('PRAGMA foreign_keys = OFF')
  const reg = new RegistroPrueba(path.join(tmp, 'b', 'r.jsonl'))
  const vigia = new VigiaTareas(db, reg)

  it('con la base vacía no hay ninguna', () => {
    vigia.revisar()
    expect(tareasHechas(db)).toEqual({})
    expect(fs.existsSync(reg.archivo)).toBe(false)
  })

  it('repetidos, nombres, lista y pendrive se anotan una sola vez cada uno (NAPIA salió del juego, 02/11)', () => {
    const at = new Date().toISOString()
    db.prepare("INSERT INTO trash_log (batch_id, file_id, orig_rel, trash_rel, reason, created_at) VALUES (1, 1, 'a.mp3', 't/a.mp3', 'Duplicados', ?)").run(at)
    db.prepare("INSERT INTO trash_log (batch_id, file_id, orig_rel, trash_rel, reason, created_at, restored_at) VALUES (1, 2, 'b.mp3', 't/b.mp3', 'Duplicados', ?, ?)").run(at, at)
    vigia.revisar()
    db.prepare("INSERT INTO journal (batch_id, file_id, rel_path, field, before, after, applied_at) VALUES (1, 5, 'x.mp3', 'artist', '', 'J Balvin', ?)").run(at)
    db.prepare("INSERT INTO requests (name, source, created_at) VALUES ('Para el viaje', 'csv', ?)").run(at)
    db.prepare("INSERT INTO inbox_added (batch, root_id, rel, src, at) VALUES (1, 1, 'Recibidos/x.mp3', 'D:/NAPIA/x.mp3', ?)").run(at)
    db.prepare("INSERT INTO inbox_added (batch, root_id, rel, src, at, undone_at) VALUES (1, 1, 'Recibidos/y.mp3', 'D:/NAPIA/y.mp3', ?, ?)").run(at, at)
    db.prepare("INSERT INTO copies_log (batch, kind, dest, dst, size, at) VALUES (1, 'pendrive', 'F:/PENDRIVE', 'a.mp3', 10, ?)").run(at)
    db.prepare("INSERT INTO copies_log (batch, kind, dest, dst, size, at) VALUES (2, 'listas', 'F:/x', 'a.m3u8', 10, ?)").run(at)
    vigia.revisar(); vigia.revisar(); vigia.revisar()
    const tareas = leerRegistro(reg.archivo).filter((l) => l.tipo === 'tarea')
    expect(tareas.map((t) => t.tipo === 'tarea' && [t.tarea, t.detalle])).toEqual([
      ['duplicados', '1 repetido a la papelera'], ['nombres', '1 tema con el nombre arreglado'], ['lista', '1 lista traída'], ['pendrive', '1 archivo copiado'],
    ])
  })

  it('tapas, carpetas, deshacer y volumen salen de la base; una trampa tirada se anota en los repetidos', () => {
    const at = new Date().toISOString()
    db.prepare("INSERT INTO journal (batch_id, file_id, rel_path, field, before, after, applied_at) VALUES (2, 6, 'y.mp3', 'cover', '', 'jpg', ?)").run(at)
    db.prepare("INSERT INTO journal (batch_id, file_id, rel_path, field, before, after, applied_at) VALUES (2, 6, 'y.mp3', 'replaygain', '', '-6 dB', ?)").run(at)
    db.prepare("INSERT INTO moves_log (batch_id, root_id, file_id, from_rel, to_rel, created_at) VALUES (1, 1, 5, 'x.mp3', 'A/x.mp3', ?)").run(at)
    db.prepare("INSERT INTO moves_log (batch_id, root_id, file_id, from_rel, to_rel, created_at, undone_at) VALUES (1, 1, 6, 'y.mp3', 'A/y.mp3', ?, ?)").run(at, at)
    const t = tareasHechas(db, ['a.mp3'])
    expect([t.tapas, t.carpetas, t.deshacer, t.volumen]).toEqual(['1 tema con tapa', '1 tema en su carpeta', '1 tema de vuelta donde estaba', '1 tema con el volumen parejo'])
    expect(t.duplicados).toBe('1 repetido a la papelera · TIRÓ 1 QUE NO ERA COPIA')
    expect(tareasHechas(db).duplicados).toBe('1 repetido a la papelera')
  })

  it('una tanda a medio mover no se anota hasta que el número deja de cambiar (salía "3 repetidos" de 10)', () => {
    const reg2 = new RegistroPrueba(path.join(tmp, 'c', 'r.jsonl'))
    const v = new VigiaTareas(db, reg2)
    const at = new Date().toISOString()
    db.exec('DELETE FROM trash_log')
    db.prepare("INSERT INTO trash_log (batch_id, file_id, orig_rel, trash_rel, reason, created_at) VALUES (2, 7, 'c.mp3', 't/c.mp3', 'Duplicados', ?)").run(at)
    v.revisar()
    db.prepare("INSERT INTO trash_log (batch_id, file_id, orig_rel, trash_rel, reason, created_at) VALUES (2, 8, 'd.mp3', 't/d.mp3', 'Duplicados', ?)").run(at)
    v.revisar()
    const dups = () => leerRegistro(reg2.archivo).filter((l) => l.tipo === 'tarea' && l.tarea === 'duplicados')
    expect(fs.existsSync(reg2.archivo) ? dups() : []).toEqual([])
    v.revisar()
    expect(dups().map((l) => l.tipo === 'tarea' && l.detalle)).toEqual(['2 repetidos a la papelera'])
    // al cerrar, lo que quedó sin anotar se anota igual
    const reg3 = new RegistroPrueba(path.join(tmp, 'd', 'r.jsonl'))
    new VigiaTareas(db, reg3).revisar(true)
    expect(leerRegistro(reg3.archivo).filter((l) => l.tipo === 'tarea')).toHaveLength(8)
    db.close()
  })
})

/** Un registro de mentira: segundos y hechos. */
const L = (seg: number, h: Record<string, unknown>) => ({ hora: '', seg, ...h }) as LineaPrueba

describe('informe por persona', () => {
  const lineas = [
    L(0, { tipo: 'inicio', version: '0.5.17', musica: 'X' }),
    L(1, { tipo: 'pantalla', pantalla: 'Inicio', antes: null, segAntes: null }),
    L(40, { tipo: 'pantalla', pantalla: 'Duplicados', antes: 'Inicio', segAntes: 39 }),
    L(45, { tipo: 'clic', texto: 'Mandar a la papelera', boton: true, pantalla: 'Duplicados' }),
    L(60, { tipo: 'tarea', tarea: 'duplicados', detalle: '8 repetidos a la papelera' }),
    L(70, { tipo: 'pantalla', pantalla: 'Arreglar nombres', antes: 'Duplicados', segAntes: 30 }),
    L(300, { tipo: 'pantalla', pantalla: 'Inicio', antes: 'Arreglar nombres', segAntes: 230 }),
    L(310, { tipo: 'pantalla', pantalla: 'Traer una lista', antes: 'Inicio', segAntes: 10 }),
    L(320, { tipo: 'pantalla', pantalla: 'Inicio', antes: 'Traer una lista', segAntes: 10 }),
    L(330, { tipo: 'pantalla', pantalla: 'Traer una lista', antes: 'Inicio', segAntes: 10 }),
    L(331, { tipo: 'clic', texto: 'tabla', boton: false, pantalla: 'Traer una lista' }),
    L(332, { tipo: 'clic', texto: 'tabla', boton: false, pantalla: 'Traer una lista' }),
    L(333, { tipo: 'clic', texto: 'tabla', boton: false, pantalla: 'Traer una lista' }),
    L(340, { tipo: 'pantalla', pantalla: 'Inicio', antes: 'Traer una lista', segAntes: 10 }),
    L(350, { tipo: 'pantalla', pantalla: 'Traer una lista', antes: 'Inicio', segAntes: 10 }),
    L(355, { tipo: 'aviso', clase: 'error', texto: 'No se pudo leer el archivo', pantalla: 'Traer una lista' }),
    L(400, { tipo: 'fin' }),
  ]

  it('sin marcas: el calentamiento hasta la primera tarea cumplida, cada una desde la anterior, y las que faltan sin final', () => {
    const r = resumir(lineas)
    expect(r.duracion).toBe(400)
    expect(r.tareas.map((t) => [t.tarea, t.desde, t.hasta, t.hecha])).toEqual([
      ['cancion', 0, 60, false], ['duplicados', 0, 60, true],
      ...['nombres', 'tapas', 'carpetas', 'deshacer', 'lista', 'pendrive', 'volumen'].map((t) => [t, 60, null, false]),
    ])
    expect(r.pantallas[0]).toEqual({ pantalla: 'Arreglar nombres', visitas: 1, seg: 230 })
  })

  it('las trabas: quieto mucho rato, ir y venir, clics en cosas que no son botones y los errores', () => {
    const motivos = resumir(lineas).trabas.map((t) => `${t.pantalla}: ${t.motivo}`)
    expect(motivos).toEqual([
      'Arreglar nombres: 230 s casi sin tocar nada (0 clics)',
      'Inicio: entró 3 veces en 3 min (va y viene)',
      'Traer una lista: entró 3 veces en 3 min (va y viene)',
      'Traer una lista: 3 clics en cosas que no son botones (tabla)',
      'Traer una lista: error: No se pudo leer el archivo',
    ])
  })

  it('con marcas (Ctrl+Mayús+FN), cada tarea va desde su marca', () => {
    const r = resumir([L(0, { tipo: 'marca', tarea: 1 }), L(50, { tipo: 'marca', tarea: 2 }), L(90, { tipo: 'marca', tarea: 3 }), L(120, { tipo: 'tarea', tarea: 'duplicados', detalle: 'x' }), L(130, { tipo: 'marca', tarea: 4 }), L(200, { tipo: 'fin' })])
    expect(r.tareas.map((t) => [t.tarea, t.desde, t.hasta, t.hecha])).toEqual([['cancion', 0, 50, false], ['contar', 50, 90, false], ['duplicados', 90, 120, true], ['nombres', 130, null, false]])
  })

  it('el Markdown trae las tablas y la foto más cercana de cada traba', () => {
    const md = informeMarkdown('Ana', '27/10/2026', lineas, (s) => `fotos/${Math.round(s)}.jpg`)
    expect(md).toContain('# Prueba con personas: Ana (27/10/2026)')
    expect(md).toContain('| Sacar las copias de más (sin tirar ninguno que no sea copia) | 0:00 | 1:00 | 1:00 | cumplida: 8 repetidos a la papelera |')
    expect(md).toContain('- **1:10** en *Arreglar nombres*: 230 s casi sin tocar nada (0 clics) · [foto](fotos/70.jpg)')
    expect(reloj(3700)).toBe('1:01:40')
  })
})

describe('la prueba no sale de su carpeta', () => {
  it('solo deja usar lo que está dentro del kit; sin prueba, todo', () => {
    const kit = path.join(os.tmpdir(), 'kit-prueba')
    expect(fueraDeLaPrueba(kit, path.join(kit, 'Música'))).toBe(false)
    expect(fueraDeLaPrueba(kit, path.join(kit, 'Música', 'Rock'))).toBe(false)
    expect(fueraDeLaPrueba(kit, kit)).toBe(false)
    expect(fueraDeLaPrueba(kit, path.join(os.tmpdir(), 'Música'))).toBe(true)
    expect(fueraDeLaPrueba(kit, kit + '-otra')).toBe(true) // empieza igual pero es otra carpeta
    expect(fueraDeLaPrueba(kit, path.resolve('/otra/Música'))).toBe(true)
    expect(fueraDeLaPrueba(undefined, path.resolve('/otra/Música'))).toBe(false)
  })
})

describe('NAPIA en la prueba (31/10)', () => {
  it('anota en el mismo registro con la hora de arranque de PAILA, y al volver a PAILA se anota su pantalla otra vez', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'prueba-napia-')), f = path.join(d, 'r.jsonl')
    let t = new Date('2026-10-31T10:00:00').getTime()
    const ahora = () => new Date(t)
    const paila = new RegistroPrueba(f, ahora)
    paila.cambio('Faltan o suenan mal')
    t += 60_000
    const napia = new RegistroPrueba(f, ahora, paila.desde)
    napia.cambio('NAPIA')
    napia.anotar({ tipo: 'clic', texto: 'Bajar', boton: true })
    t += 120_000
    paila.volvio()
    const l = leerRegistro(f)
    expect(l.map((x) => [x.tipo, (x as { pantalla?: string }).pantalla, x.seg])).toEqual([
      ['pantalla', 'Faltan o suenan mal', 0], ['pantalla', 'NAPIA', 60], ['clic', 'NAPIA', 60], ['pantalla', 'Faltan o suenan mal', 180],
    ])
    fs.rmSync(d, { recursive: true, force: true })
  })
})

