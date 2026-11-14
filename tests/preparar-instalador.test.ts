// El instalador se arma de un solo comando: npm run dist / pack dejan en su lugar el sockseek con freno y Beat This! si
// los encuentran donde suelen estar, y si no, dicen en una línea qué falta y cómo conseguirlo (scripts/preparar-instalador.mjs).
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
// @ts-expect-error el script es .mjs sin tipos
import { fuentes, preparar, prepararFfprobe, prepararModelos, prepararMpv, prepararSockseek } from '../scripts/preparar-instalador.mjs'
// @ts-expect-error el script es .mjs sin tipos
import { ARCHIVOS, problemas } from '../scripts/modelos-beat-this.mjs'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'paila-instalador-'))
const LICENCIAS = ['AVISO.txt', 'LICENCIA-sockseek-AGPL-3.0.txt', 'LICENCIA-Soulseek.NET-GPL-3.0.txt', 'NOTICE-Soulseek.NET.txt', 'LICENSE']
/** La carpeta del sockseek como viene en el repositorio: las licencias, sin el .exe. */
function carpetaSockseek(): string {
  const dir = tmp()
  for (const f of LICENCIAS) fs.writeFileSync(path.join(dir, f), 'licencia')
  return dir
}
/** Un "sockseek.exe" de mentira; su versión la contesta `ver` según el contenido. */
const exe = (contenido: string) => { const f = path.join(tmp(), 'sockseek.exe'); fs.writeFileSync(f, contenido); return f }
const ver = (f: string) => fs.readFileSync(f, 'utf8')
/** Una carpeta de modelos completa (archivos vacíos, sin las huellas de verdad). */
function modelos(): string {
  const dir = tmp()
  for (const a of ARCHIVOS as { ruta: string[] }[]) {
    const f = path.join(dir, ...a.ruta)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, a.ruta.join('/') === 'npm/node_modules/onnxruntime-web/package.json' ? JSON.stringify({ version: '1.30.0' }) : a.ruta.join('/'))
  }
  return dir
}

describe('preparar el instalador', () => {
  it('copia el primer sockseek con freno que encuentra, y saltea el común', () => {
    const destino = carpetaSockseek()
    const comun = exe('3.0.6'), freno = exe('3.0.6-napia.2')
    expect(prepararSockseek([path.join(tmp(), 'no-esta.exe'), comun, freno], destino, ver)).toBe(`copiado de ${freno}`)
    expect(ver(path.join(destino, 'sockseek.exe'))).toBe('3.0.6-napia.2')
    // la segunda vez ya está: no toca nada
    expect(prepararSockseek([exe('3.0.6-napia.3')], destino, ver)).toBe('ya estaba')
    expect(ver(path.join(destino, 'sockseek.exe'))).toBe('3.0.6-napia.2')
  })

  it('copia el primer mpv que anda, y no arma sin su aviso de licencia', () => {
    const destino = tmp()
    expect(() => prepararMpv([], destino, () => true)).toThrow(/AVISO\.txt/)
    fs.writeFileSync(path.join(destino, 'AVISO.txt'), 'aviso')
    const roto = path.join(tmp(), 'mpv.exe'); fs.writeFileSync(roto, 'roto')
    const bueno = path.join(tmp(), 'mpv.exe'); fs.writeFileSync(bueno, 'mpv')
    const anda = (f: string) => fs.existsSync(f) && fs.readFileSync(f, 'utf8') === 'mpv'
    expect(prepararMpv([roto, bueno], destino, anda)).toBe(`copiado de ${bueno}`)
    expect(prepararMpv([], destino, anda)).toBe('ya estaba')
  })

  it('no arma sin los avisos de licencia del sockseek', () => {
    const destino = carpetaSockseek()
    fs.rmSync(path.join(destino, 'AVISO.txt'))
    expect(() => prepararSockseek([exe('3.0.6-napia.2')], destino, ver)).toThrow(/AVISO\.txt/)
  })

  it('arma Beat This! desde la primera carpeta completa, y saltea las que tienen algo mal', async () => {
    const destino = path.join(tmp(), 'modelos')
    const rota = modelos(); fs.rmSync(path.join(rota, 'beat-this', 'beat_this.onnx'))
    const buena = modelos()
    expect(await prepararModelos([rota, buena], destino, false)).toBe(`copiado de ${buena}`)
    expect(await problemas(destino, false)).toEqual([])
    expect(await prepararModelos([], destino, false)).toBe('ya estaba')
    // con las huellas (lo de siempre), una carpeta con otro modelo no sirve
    const otro = path.join(tmp(), 'modelos')
    expect(await prepararModelos([buena], otro)).toBeNull()
  })

  it('si no encuentra algo, dice en una línea qué falta y cómo conseguirlo', async () => {
    const mpv = tmp(); fs.writeFileSync(path.join(mpv, 'AVISO.txt'), 'aviso')
    const r = await preparar({ sockseek: [], modelos: [], mpv: [], ffprobe: [] }, { sockseek: carpetaSockseek(), modelos: path.join(tmp(), 'modelos'), mpv, ffprobe: tmp() }, { ver, mpv: () => false, ffprobe: async () => false })
    expect(r.hechos).toEqual([])
    expect(r.faltan).toHaveLength(4)
    expect(r.faltan[3]).toMatch(/^Falta ffprobe .*npm run ffprobe:bajar.*PAILA_FFPROBE/)
    expect(r.faltan[2]).toMatch(/^Falta mpv .*npm run mpv:bajar.*PAILA_MPV/)
    expect(r.faltan[0]).toMatch(/^Falta el sockseek con freno: .*npm run sockseek:freno.*PAILA_SOCKSEEK/)
    expect(r.faltan[1]).toMatch(/^Falta Beat This!: .*npm run modelos:armar -- --desde .*PAILA_MODELOS/)
    for (const l of r.faltan) expect(l).not.toContain('\n')
  })

  it('busca primero lo que se le indica, después en la carpeta principal del proyecto, en lo armado y en PAILA instalada', () => {
    const f = fuentes({ PAILA_SOCKSEEK: 'D:/sock', PAILA_MODELOS: 'D:/mod', PAILA_MPV: 'D:/mpv.exe', PAILA_FFPROBE: 'D:/ffprobe.exe' }, 'C:/proyecto', 'C:/inst')
    expect(f.ffprobe.map((p: string) => p.split(path.sep).join('/'))).toEqual(['D:/ffprobe.exe', 'C:/proyecto/apps/paila/recursos/ffprobe/ffprobe.exe', 'C:/inst/ffprobe/ffprobe.exe'])
    expect(f.mpv.map((p: string) => p.split(path.sep).join('/'))).toEqual(['D:/mpv.exe', 'C:/proyecto/apps/paila/recursos/mpv/mpv.exe', 'C:/inst/mpv/mpv.exe'])
    expect(f.sockseek.map((p: string) => p.split(path.sep).join('/'))).toEqual([
      'D:/sock/sockseek.exe', 'C:/proyecto/apps/napia/recursos/sockseek/sockseek.exe',
      path.join(os.homedir(), 'sockseek-freno', 'publicado', 'sockseek.exe').split(path.sep).join('/'), 'C:/inst/napia/recursos/sockseek/sockseek.exe',
    ])
    expect(f.modelos.map((p: string) => p.split(path.sep).join('/'))).toEqual(['D:/mod', 'C:/proyecto/apps/paila/recursos/modelos', 'C:/inst/modelos'])
    // sin copia de trabajo ni PAILA instalada, solo lo armado a mano
    expect(fuentes({}, null, null)).toEqual({ sockseek: [path.join(os.homedir(), 'sockseek-freno', 'publicado', 'sockseek.exe')], modelos: [], mpv: [], ffprobe: [] })
  })

  it('ffprobe: solo sirve el de gyan.dev 6.1.1 (por su huella), y lo copia de la primera fuente que lo sea', async () => {
    const bueno = path.join(tmp(), 'ffprobe.exe'); fs.writeFileSync(bueno, 'gyan 6.1.1')
    const viejo = path.join(tmp(), 'ffprobe.exe'); fs.writeFileSync(viejo, 'zeranoe 4.0.2')
    const anda = async (f: string) => fs.existsSync(f) && fs.readFileSync(f, 'utf8') === 'gyan 6.1.1'
    const destino = path.join(tmp(), 'ffprobe')
    expect(await prepararFfprobe([viejo], destino, anda)).toBeNull()
    expect(await prepararFfprobe([viejo, bueno], destino, anda)).toBe(`copiado de ${bueno}`)
    expect(await prepararFfprobe([], destino, anda)).toBe('ya estaba')
  })
})
