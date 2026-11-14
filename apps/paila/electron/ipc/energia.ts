// IPC de la energía a tu oído y del estilo por el sonido (MASTERPLAN-3, punto 3): marcar temas y calibrar (core/energiamarcas.ts),
// y el modelo de estilos de la UPF, que se baja aparte (licencia no comercial) a <datos>/modelos/discogs-effnet, verificado.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { ipcMain, net } from 'electron'
import type { Ctx } from '../context'
import type { SoundStyleInfo } from '@paila/shared/types'
import { calibrate, markCandidates, marksState, resetCalibration, setMark } from '@paila/core/energiamarcas'
import { EFFNET_BASE_URL, EFFNET_DIR, EFFNET_FILES, effnetMissing, effnetToDownload } from '@paila/core/analysis/effnetrun'
import { heardStyle, pendingStyle } from '@paila/core/stylepass'
import { MODELS_SETTING, modelsFolder } from '../gridengine'
import { textos } from '@paila/shared/idioma'

// El proceso de bajar el modelo, como se ve en la lista de procesos.
const T = textos({
  bajando: { es: 'Bajando el modelo de estilos', en: 'Downloading the style model' },
  cancelado: { es: 'Cancelado', en: 'Cancelled' },
  noSePudo: { es: (f: string, st: number) => `No se pudo bajar ${f} (${st})`, en: (f: string, st: number) => `Couldn't download ${f} (${st})` },
  distinto: { es: (f: string) => `${f} llegó distinto de lo esperado: no se usa`, en: (f: string) => `${f} arrived different from what was expected: it won't be used` },
  listo: { es: 'Modelo listo: PAILA va a escuchar el estilo de tu Música en segundo plano', en: 'Model ready: PAILA will listen to the style of your Music in the background' },
})

export function registerEnergia(c: Ctx) {
  const db = c.lib.db
  const dir = path.join(c.userData, 'modelos', EFFNET_DIR)
  const ortDir = () => modelsFolder(c.setting(MODELS_SETTING))
  c.lib.styleModels = () => { const o = ortDir(); return o && !effnetMissing(dir, o) ? { dir, ortDir: o } : null }

  ipcMain.handle('energia:candidatos', (_e, n?: number) => markCandidates(db, n))
  ipcMain.handle('energia:estado', () => marksState(db))
  ipcMain.handle('energia:marcar', (_e, id: number, value: number | null) => { setMark(db, id, value); return marksState(db) })
  ipcMain.handle('energia:calibrar', () => calibrate(db))
  ipcMain.handle('energia:fabrica', () => resetCalibration(db))

  const info = (): SoundStyleInfo => {
    const missing = effnetMissing(dir, ortDir())
    return { ready: !missing, missing, toDownload: effnetToDownload(dir), bytes: EFFNET_FILES.reduce((s, f) => s + f.bytes, 0), pending: missing ? 0 : pendingStyle(db), heard: heardStyle(db) }
  }
  ipcMain.handle('estilo-sonido:info', () => info())
  // baja cada archivo a una carpeta aparte, verifica tamaño y huella, y recién ahí lo deja en su lugar
  ipcMain.handle('estilo-sonido:bajar', () => c.jobs.run('estilo-modelo', T.bajando, async (h) => {
    fs.mkdirSync(dir, { recursive: true })
    const tmp = path.join(path.dirname(dir), `${EFFNET_DIR}-bajando`)
    fs.mkdirSync(tmp, { recursive: true })
    h.update({ total: EFFNET_FILES.length })
    let done = 0
    for (const f of EFFNET_FILES) {
      if (h.cancelled()) throw new Error(T.cancelado)
      const dest = path.join(dir, f.file)
      if (fs.existsSync(dest) && fs.statSync(dest).size === f.bytes) { h.update({ done: ++done }); continue }
      h.update({ current: f.file })
      const r = await net.fetch(EFFNET_BASE_URL + f.url)
      if (!r.ok) throw new Error(T.noSePudo(f.file, r.status))
      const buf = Buffer.from(await r.arrayBuffer())
      const sha = crypto.createHash('sha256').update(buf).digest('hex')
      if (buf.length !== f.bytes || sha !== f.sha256) throw new Error(T.distinto(f.file))
      fs.writeFileSync(path.join(tmp, f.file), buf)
      fs.renameSync(path.join(tmp, f.file), dest)
      h.update({ done: ++done })
    }
    fs.rmSync(tmp, { recursive: true, force: true })
    void c.analyze() // la pasada de estilos arranca sola con lo ya analizado
    return info()
  }, () => T.listo))
  // sacar el modelo: borra solo sus archivos (de PAILA, nunca música); lo ya escuchado queda
  ipcMain.handle('estilo-sonido:quitar', () => {
    for (const f of EFFNET_FILES) fs.rmSync(path.join(dir, f.file), { force: true })
    return info()
  })
}
