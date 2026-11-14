// Tests de "Llevar la música" directo al celular por cable (core/carry.ts sendToDevice + core/mtp.ts): primero se prepara
// en una carpeta temporal y después se pasa de a un archivo, verificando el tamaño. Sin celular: un "celular" de mentira
// para la lógica y, en Windows, el puente real de PowerShell contra una carpeta común (el mismo camino que con un Android).
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Library } from '@paila/core/library'
import { findFfprobe } from '@paila/core/probe'
import { DEFAULT_PHONE, PhoneCopier } from '@paila/core/carry'
import { sendToDevice, type DeviceSink } from '@paila/core/carrydevice'
import { MtpBridge, psMessage } from '@paila/core/mtp'
import { ponerIdioma } from '@paila/shared/idioma'
import type { PhoneTarget } from '@paila/shared/types'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const ffprobe = findFfprobe()!
let dir: string, lib: Library, pc: PhoneCopier, ids: number[]

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-cel-'))
  const M = path.join(dir, 'Música')
  const tone = (rel: string, extra: string[], meta: Record<string, string>) => {
    const out = path.join(M, rel)
    fs.mkdirSync(path.dirname(out), { recursive: true })
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-ac', '2', ...extra, ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), out])
  }
  tone('A/uno.flac', [], { artist: 'Ñandú', title: 'Canción: uno' })
  tone('A/dos.mp3', ['-b:a', '128k'], { artist: 'Soda Stereo', title: 'Dos' })
  lib = new Library(path.join(dir, 'paila.db'), ffprobe)
  await lib.addRoot(M, [{ rel: '', kind: 'musica' }])
  await lib.scan()
  ids = lib.tracks().map((r) => r[0] as number)
  pc = new PhoneCopier(lib.db, (i) => lib.trackPath(i), ffmpeg, ffprobe, () => lib.roots().map((r) => r.path), path.join(dir, 'temporal'))
})
afterAll(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }) })

/** Un celular de mentira: guarda lo que le llega en una carpeta y puede "desconectarse". */
function fakePhone(root: string, opts: { failAfter?: number } = {}): DeviceSink & { calls: number } {
  return {
    calls: 0,
    async copy(_id, parts, local, name, size) {
      if (opts.failAfter != null && this.calls >= opts.failAfter) throw new Error('El celular ya no aparece')
      this.calls++
      const d = path.join(root, ...parts)
      const out = path.join(d, name)
      if (fs.existsSync(out)) { if (fs.statSync(out).size === size) return 'already'; throw new Error('distinto: no se pisa') }
      fs.mkdirSync(d, { recursive: true })
      fs.copyFileSync(local, out)
      return 'sent'
    },
  }
}

describe('al celular por cable', () => {
  const t = (id: string): PhoneTarget => ({ id, name: 'Galaxy de prueba', storage: 'Almacenamiento interno', folder: 'Music' })

  it('el plan prepara en una carpeta temporal y dice adónde va en el celular', () => {
    const plan = pc.plan('Viaje', ids, { ...DEFAULT_PHONE, dest: '', device: t('cel-1') })
    expect(plan.folder.startsWith(path.join(dir, 'temporal'))).toBe(true)
    expect(plan.deviceFolder).toBe('Galaxy de prueba › Almacenamiento interno › Music › Viaje')
    expect(plan.warnings.some((w) => /dentro de tu biblioteca/.test(w))).toBe(false)
  })

  it('convierte, pasa todo con la playlist, retoma sin repetir y borra la carpeta temporal', async () => {
    const cel = path.join(dir, 'cel-a')
    const plan = pc.plan('Viaje', ids, { ...DEFAULT_PHONE, dest: '', device: t('cel-a') })
    const r = await pc.run(plan)
    const sink = fakePhone(cel)
    await sendToDevice(plan, r, sink, t('cel-a'))
    expect(r.failed).toEqual([])
    expect(r.device).toMatchObject({ sent: 3, already: 0 }) // 2 temas + el .m3u8
    const there = fs.readdirSync(path.join(cel, 'Almacenamiento interno', 'Music', 'Viaje')).sort()
    expect(there).toEqual([...plan.items.map((i) => i.outRel), 'Viaje.m3u8'].sort())
    expect(fs.existsSync(plan.folder)).toBe(false) // todo llegó: la temporal se borra
    // otra vez: lo que ya está igual se saltea
    const plan2 = pc.plan('Viaje', ids, { ...DEFAULT_PHONE, dest: '', device: t('cel-a') })
    const r2 = await pc.run(plan2)
    await sendToDevice(plan2, r2, fakePhone(cel), t('cel-a'))
    expect(r2.device).toMatchObject({ sent: 0, already: 3 })
  })

  it('si se desconecta, avisa, no sigue probando y guarda lo preparado para la próxima', async () => {
    const plan = pc.plan('Corte', ids, { ...DEFAULT_PHONE, dest: '', device: t('cel-b') })
    const r = await pc.run(plan)
    await sendToDevice(plan, r, fakePhone(path.join(dir, 'cel-b'), { failAfter: 0 }), t('cel-b'))
    expect(r.failed.at(-1)!.error).toMatch(/Se cortó la conexión/)
    expect(r.failed.filter((f) => f.error.startsWith('Al celular')).length).toBe(3)
    expect(fs.existsSync(plan.folder)).toBe(true)
  })

  it('se puede cancelar entre archivo y archivo', async () => {
    const plan = pc.plan('Cancelo', ids, { ...DEFAULT_PHONE, dest: '', device: t('cel-c') })
    const r = await pc.run(plan)
    const sink = fakePhone(path.join(dir, 'cel-c'))
    let n = 0
    await sendToDevice(plan, r, sink, t('cel-c'), { isCancelled: () => ++n > 1 })
    expect(r.cancelled).toBe(true)
    expect(sink.calls).toBe(1)
    expect(fs.existsSync(plan.folder)).toBe(true)
  })

  it.runIf(process.platform === 'win32')('el puente de Windows: sin celulares da una lista; copia, crea carpetas y verifica el tamaño', async () => {
    const m = new MtpBridge()
    try {
      expect(Array.isArray(await m.devices())).toBe(true)
      const root = path.join(dir, 'cel-real')
      fs.mkdirSync(path.join(root, 'Almacenamiento interno'), { recursive: true })
      const plan = pc.plan('Puente ñ', ids, { ...DEFAULT_PHONE, dest: '', device: t(root) })
      const r = await pc.run(plan)
      await sendToDevice(plan, r, m, t(root))
      expect(r.failed).toEqual([])
      expect(r.device).toMatchObject({ sent: 3 })
      const got = path.join(root, 'Almacenamiento interno', 'Music', 'Puente ñ')
      for (const it of plan.items) expect(fs.existsSync(path.join(got, it.outRel))).toBe(true)
      // un archivo distinto con el mismo nombre no se pisa
      const other = path.join(dir, 'otro.m4a'); fs.writeFileSync(other, 'x')
      await expect(m.copy(root, ['Almacenamiento interno', 'Music', 'Puente ñ'], other, plan.items[0].outRel, 1)).rejects.toThrow(/no se pisa/)
    } finally { m.close() }
  }, 120_000)
})

describe('los mensajes del puente de Windows', () => {
  it('el script habla en castellano; en inglés se pasan los conocidos y lo de Windows queda como está', () => {
    const msg = "No se pudo crear la carpeta 'Viaje' en el celular"
    expect(psMessage(msg)).toBe(msg)
    try {
      ponerIdioma('en')
      expect(psMessage(msg)).toBe("Couldn't create the folder 'Viaje' on the phone")
      expect(psMessage('No llegó completo al celular (¿se bloqueó la pantalla o se desconectó el cable?)')).toMatch(/didn't reach the phone/)
      expect(psMessage('Acceso denegado.')).toBe('Acceso denegado.')
    } finally { ponerIdioma('es') }
  })
})
