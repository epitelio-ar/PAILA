// Las frases humanas de la calidad (MASTERPLAN-5, 2.4; @paila/shared/frases-calidad) y el enlace de NAPIA armado de su avance
// (core/sockseek/enlace-armar.ts): lo que Sonido de PAILA muestra arriba sin cambiar de ventana.
import { describe, expect, it } from 'vitest'
import { fraseCalidad, fraseLlegada, fraseTrucho, kbpsConocidos } from '@paila/shared/frases-calidad'
import { armarEnlace, faltaNapia, ultimoDe } from '@paila/core/sockseek/enlace-armar'
import type { RunStatus, TrackProgress } from '@paila/shared/napia'

describe('la calidad en una frase', () => {
  it('un FLAC falso dice cómo suena de verdad', () => {
    expect(fraseCalidad({ ext: 'flac', effKbps: 131, grade: 'D', reasons: ['lossless_falso'] })).toBe('Suena como un MP3 de 128 kbps aunque diga FLAC: pesa como un CD y suena como el MP3')
  })
  it('un MP3 marcado como sin pérdida falso se dice como inflado, nunca "aunque diga MP3" (copia de la base real, 13/11)', () => {
    expect(fraseCalidad({ ext: 'mp3', kbps: 320, effKbps: 320, grade: 'D', reasons: ['lossless_falso'] })).not.toMatch(/aunque diga MP3/)
    expect(fraseCalidad({ ext: 'mp3', kbps: 320, effKbps: 192, grade: 'D', reasons: ['lossless_falso'] })).toMatch(/^Dice 320 kbps pero suena como un MP3 de 192/)
  })
  it('un MP3 inflado, uno de 128 y uno de 192', () => {
    expect(fraseCalidad({ ext: 'mp3', kbps: 320, effKbps: 128, grade: 'D', reasons: ['inflado'] })).toBe('Dice 320 kbps pero suena como un MP3 de 128 kbps: lo inflaron, pesa más y no suena mejor')
    expect(fraseCalidad({ ext: 'mp3', kbps: 128, effKbps: 128, grade: 'D', reasons: ['nota'] })).toBe('Es un MP3 de 128 kbps: en el auto suena bien, en un equipo bueno se nota')
    expect(fraseCalidad({ ext: 'mp3', kbps: 192, effKbps: null, grade: 'C', reasons: ['nota'] })).toBe('Es un MP3 de 192 kbps: está bien, pero se puede conseguir mejor')
    expect(fraseCalidad({ ext: 'm4a', kbps: 96, effKbps: 96, grade: 'F', reasons: ['nota'] })).toMatch(/^Es un M4A de 96 kbps: suena apagado/)
  })
  it('lo que no tenés dice de dónde viene', () => {
    expect(fraseCalidad({ ext: null, effKbps: null, grade: null, reasons: ['falta'], fileId: null, requests: ['Para el viaje'] })).toBe('Está en tu lista «Para el viaje» y no lo tenés')
    expect(fraseCalidad({ ext: null, effKbps: null, grade: null, reasons: ['falta_disco'], fileId: null })).toBe('Le falta a un disco tuyo')
  })
  it('lo que Rekordbox no lee y lo que puede venir de un MP3', () => {
    expect(fraseCalidad({ ext: 'wma', effKbps: null, grade: 'B', reasons: ['rekordbox'] })).toBe('Rekordbox y las CDJ no leen el WMA')
    expect(fraseCalidad({ ext: 'flac', effKbps: 1411, grade: 'B', reasons: ['puede_mp3'] })).toMatch(/puede venir de uno/)
  })
  it('los kbps se redondean a los que conoce cualquiera', () => {
    expect([kbpsConocidos(131), kbpsConocidos(250), kbpsConocidos(300)]).toEqual(['128 kbps', '256 kbps', '320 kbps'])
  })
  it('lo que llegó: mejor, no mejor, te faltaba, trucho', () => {
    expect(fraseLlegada({ decision: 'reemplazar', ext: 'flac', check: { ok: true, newGrade: 'A', newLabel: 'FLAC calidad CD', oldGrade: 'D', problems: [], warnings: [] } })).toBe('Llegó una copia mejor (FLAC calidad CD): reemplaza a la tuya')
    expect(fraseLlegada({ decision: 'no-sirve', ext: 'flac', check: { ok: false, newGrade: 'D', newLabel: '', oldGrade: 'D', problems: ['Es un MP3 disfrazado de FLAC.'], warnings: [] } })).toBe('Llegó, pero no es mejor que la tuya: Es un MP3 disfrazado de FLAC')
    expect(fraseLlegada({ decision: 'falta', ext: 'mp3', check: null })).toBe('Te faltaba: va a tu Música')
    expect(fraseTrucho('MP3 inflado: suena como uno de 128 kbps')).toBe('Llegó trucho: MP3 inflado: suena como uno de 128 kbps. NAPIA busca otra copia')
  })
})

const tema = (title: string, state: TrackProgress['state'], calidad?: TrackProgress['calidad']): TrackProgress => ({ artist: 'A', title, state, percent: null, detail: null, path: null, format: null, calidad })
const cuenta = { espera: 0, buscando: 0, bajando: 1, bajado: 2, yaEstaba: 0, noEncontrado: 1, fallo: 0, cancelado: 0 }

describe('el enlace de NAPIA para PAILA', () => {
  it('cuenta bajados, truchos y no encontrados, y lo último va primero', () => {
    const t = [tema('Uno', 'bajado', { estado: 'buena', nota: 'A', es: null, motivo: null, descartadas: 0, intentos: 0 }), tema('Dos', 'bajado', { estado: 'trucho', nota: 'D', es: 'MP3 inflado', motivo: 'inflado', descartadas: 1, intentos: 1 }), tema('Tres', 'noEncontrado'), tema('Cuatro', 'bajando')]
    const st = { running: true, listName: 'PAILA - mejorar calidad', tracks: t, counts: cuenta, calidad: null } as unknown as RunStatus
    const e = armarEnlace(st, { carpeta: 'C:/NAPIA', fin: null, enEspera: 1, falta: null, hora: 5 })
    expect(e).toMatchObject({ hora: 5, corriendo: true, hechos: 3, total: 4, bajados: 2, truchos: 1, noEncontrados: 1, enEspera: 1, falta: null })
    expect(e.ultimos!.map((u) => `${u.title}:${u.estado}`)).toEqual(['Tres:noEsta', 'Dos:trucho', 'Uno:llego'])
    expect(e.ultimos![1].es).toBe('MP3 inflado')
    expect(ultimoDe(tema('Cinco', 'buscando'))).toBeNull()
    // llegó trucho y NAPIA consiguió otra copia buena: llegó, pero se dice
    expect(ultimoDe(tema('Seis', 'bajado', { estado: 'reemplazado', nota: 'A', es: null, motivo: 'inflado', descartadas: 1, intentos: 1 }))).toEqual({ artist: 'A', title: 'Seis', estado: 'llego', otraCopia: true })
  })
  it('dice qué le falta a NAPIA para bajar', () => {
    expect(faltaNapia({ exe: null, hasUser: true, hasPass: true }, true)).toBe('sockseek')
    expect(faltaNapia({ exe: 'x', hasUser: false, hasPass: true }, true)).toBe('cuenta')
    expect(faltaNapia({ exe: 'x', hasUser: true, hasPass: true }, false)).toBe('carpeta')
    expect(faltaNapia({ exe: 'x', hasUser: true, hasPass: true }, true)).toBeNull()
  })
})
