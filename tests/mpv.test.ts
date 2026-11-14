// Tests de la salida "bit perfect" (core/mpv.ts): opciones de mpv, lectura de sus salidas y de su canal de control, y mpv
// de verdad tocando un archivo con la salida nula (sin hacer sonido) si está (apps/paila/recursos/mpv o PAILA_MPV).
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Mpv, mpvArgs, parseDevices, parseLine, sameOut, type MpvEvent } from '@paila/core/mpv'

const ffmpeg: string = createRequire(import.meta.url)('ffmpeg-static')
const exe = process.env.PAILA_MPV ?? path.join(__dirname, '..', 'apps', 'paila', 'recursos', 'mpv', 'mpv.exe')
/** Un aparato que no existe, en el formato de la salida exclusiva de cada sistema. */
const NO_DEVICE = process.platform === 'darwin' ? 'coreaudio_exclusive/NoExiste:0' : 'wasapi/{00000000-0000-0000-0000-000000000000}'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paila-mpv-'))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('mpv: opciones y lecturas', () => {
  it('abre en exclusiva, sin tocar el volumen ni el sonido, y sin caer a otra salida', () => {
    const a = mpvArgs({ device: 'wasapi/{x}', pipe: '\\\\.\\pipe\\p', ao: 'wasapi' })
    for (const o of ['--ao=wasapi', '--audio-exclusive=yes', '--audio-device=wasapi/{x}', '--audio-fallback-to-null=no', '--volume=100', '--volume-max=100', '--replaygain=no', '--no-video', '--no-config', '--input-ipc-server=\\\\.\\pipe\\p']) expect(a).toContain(o)
    expect(a.some((x) => x.startsWith('--audio-samplerate'))).toBe(false) // la frecuencia la pone el archivo
  })

  it('lee la lista de salidas de mpv (sin la automática ni las que no son WASAPI)', () => {
    const out = "List of detected audio devices:\n  'auto' (Autoselect device)\n  'wasapi/{af0c1270-97c6-43be-8354-e47a776bf051}' (Altavoz (Conexant ISST Audio))\n  'openal' (Default (openal))\n"
    expect(parseDevices(out)).toEqual([{ id: 'wasapi/{af0c1270-97c6-43be-8354-e47a776bf051}', label: 'Altavoz (Conexant ISST Audio)' }])
  })

  it('en Mac, la salida exclusiva de CoreAudio (no la compartida)', () => {
    const out = "List of detected audio devices:\n  'auto' (Autoselect device)\n  'coreaudio_exclusive/AppleUSBAudioEngine:Topping:D10:1:1' (D10)\n  'coreaudio/BuiltInSpeakerDevice' (MacBook Pro Speakers)\n"
    expect(parseDevices(out)).toEqual([{ id: 'coreaudio_exclusive/AppleUSBAudioEngine:Topping:D10:1:1', label: 'D10' }])
    expect(mpvArgs({ device: 'coreaudio_exclusive/x', pipe: '/tmp/p.sock', ao: 'coreaudio_exclusive' })).toContain('--ao=coreaudio_exclusive')
  })

  it('sabe si sale igual a como está grabado (24 bits dentro de 32 sigue intacto; otra frecuencia no)', () => {
    expect(sameOut({ samplerate: 44100, format: 's16', channels: 'stereo' }, { samplerate: 44100, format: 's16', channels: 'stereo' })).toBe(true)
    expect(sameOut({ samplerate: 96000, format: 's24', channels: 'stereo' }, { samplerate: 96000, format: 's32', channels: 'stereo' })).toBe(true)
    expect(sameOut({ samplerate: 44100, format: 's16', channels: 'stereo' }, { samplerate: 48000, format: 's16', channels: 'stereo' })).toBe(false)
    expect(sameOut({ samplerate: 44100, format: 's32', channels: 'stereo' }, { samplerate: 44100, format: 's16', channels: 'stereo' })).toBe(false)
    expect(sameOut(null, null)).toBeNull()
  })

  it('separa respuestas y avisos del canal de control', () => {
    expect(parseLine('{"data":1.5,"request_id":3,"error":"success"}')).toEqual({ reply: { id: 3, error: 'success', data: 1.5 } })
    expect(parseLine('{"event":"end-file","reason":"eof"}')?.event?.reason).toBe('eof')
    expect(parseLine('basura')).toBeNull()
  })
})

describe.skipIf(!fs.existsSync(exe))('mpv de verdad (salida nula: no suena nada)', () => {
  it('toca un WAV de 44,1 kHz y 16 bits tal cual, avisa el tiempo y el final', async () => {
    const wav = path.join(dir, 'silencio.wav')
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '1.2', '-c:a', 'pcm_s16le', wav])
    const events: MpvEvent[] = []
    let ended!: () => void
    const done = new Promise<void>((r) => { ended = r })
    const mpv = new Mpv(exe, (e) => { events.push(e); if (e.event === 'end-file') ended() }, () => {})
    try {
      await mpv.start('auto', { ao: 'null' })
      await mpv.command('observe_property', 1, 'audio-params')
      await mpv.command('observe_property', 2, 'audio-out-params')
      await mpv.command('loadfile', wav, 'replace')
      await done
      const prop = (n: string) => events.filter((e) => e.name === n && e.data).map((e) => e.data as { samplerate: number; format: string }).pop()
      expect(prop('audio-params')).toMatchObject({ samplerate: 44100, format: 's16' })
      expect(sameOut(prop('audio-params') as never, prop('audio-out-params') as never)).toBe(true)
      expect(events.find((e) => e.event === 'end-file')?.reason).toBe('eof')
    } finally { await mpv.stop() }
    expect(mpv.running).toBe(false)
  }, 30_000)

  it('si el aparato no existe, mpv no toca por otro lado: avisa con un error', async () => {
    const events: MpvEvent[] = []
    let ended!: () => void
    const done = new Promise<void>((r) => { ended = r })
    const mpv = new Mpv(exe, (e) => { events.push(e); if (e.event === 'end-file') ended() }, () => ended())
    const wav = path.join(dir, 'silencio.wav')
    try {
      await mpv.start(NO_DEVICE)
      await mpv.command('loadfile', wav, 'replace')
      await done
      expect(events.find((e) => e.event === 'end-file')?.reason).toBe('error')
    } finally { await mpv.stop() }
  }, 30_000)
})
