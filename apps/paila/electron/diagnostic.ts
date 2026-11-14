// Registro de errores y "Exportar diagnóstico" (Fase H). El registro junta los errores del proceso principal (lo que va a
// console.error, lo que nadie atrapó) y de la interfaz; el diagnóstico arma un zip sin datos personales
// (packages/core/diagnostic.ts) que se muestra antes de guardarlo.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app, dialog, ipcMain } from 'electron'
import { ErrorLog } from '@paila/core/errorlog'
import { diagnosticFiles, diagnosticZip, type DiagnosticEnv } from '@paila/core/diagnostic'
import type { Ctx } from './context'
import { textos } from '@paila/shared/idioma'

// El título de la ventana de guardar (el nombre del zip y lo que va adentro no se traducen: es para quien programa).
const T = textos({ guardar: { es: 'Guardar el diagnóstico', en: 'Save the diagnostic' } })

/** Prende el registro: desde acá, cada error queda anotado en `<datos>/registro/errores.log`. */
export function startErrorLog(userData: string): ErrorLog {
  const log = new ErrorLog(path.join(userData, 'registro'))
  const original = console.error.bind(console)
  console.error = (...args: unknown[]) => {
    original(...args)
    log.add('principal', args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack ?? ''}` : String(a))).join(' '))
  }
  process.on('uncaughtException', (e) => log.add('principal (sin atrapar)', e))
  process.on('unhandledRejection', (e) => log.add('principal (promesa sin atrapar)', e))
  app.on('render-process-gone', (_e, _w, d) => log.add('interfaz', `la ventana se cerró de golpe: ${d.reason} (código ${d.exitCode})`))
  app.on('child-process-gone', (_e, d) => { if (d.reason !== 'clean-exit') log.add('proceso aparte', `${d.type} ${d.name ?? ''} terminó: ${d.reason} (código ${d.exitCode})`) })
  ipcMain.on('log:ui', (_e, msg: string) => log.add('interfaz', String(msg).slice(0, 4000)))
  return log
}

const gb = (b: number) => Math.round((b / 1024 ** 3) * 10) / 10

export function registerDiagnostic(ctx: Ctx, log: ErrorLog, startupMs: () => number | null) {
  const env = (): DiagnosticEnv => {
    const dbFile = path.join(ctx.userData, 'paila.db')
    return {
      app: 'PAILA', version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node,
      os: `${os.version()} ${os.release()}`, arch: process.arch, cpu: os.cpus()[0]?.model?.trim() ?? '?', cores: os.cpus().length,
      ramGb: gb(os.totalmem()), freeRamGb: gb(os.freemem()), locale: app.getLocale(),
      portable: !!process.env.PORTABLE_EXECUTABLE_DIR, packaged: app.isPackaged, uptimeS: Math.round(process.uptime()), startupMs: startupMs(),
      ffmpeg: ctx.ffmpeg ? 'está' : null, ffprobe: ctx.ffprobe ? 'está' : null,
      dbBytes: fs.existsSync(dbFile) ? fs.statSync(dbFile).size : 0,
    }
  }
  const files = () => diagnosticFiles(ctx.lib.db, env(), log.read(500))
  ipcMain.handle('diag:preview', () => files())
  ipcMain.handle('diag:save', async () => {
    const day = new Date().toISOString().slice(0, 10)
    const w = ctx.win()
    const opts = { title: T.guardar, defaultPath: path.join(app.getPath('desktop'), `PAILA-diagnostico-${day}.zip`), filters: [{ name: 'Zip', extensions: ['zip'] }] }
    const r = w ? await dialog.showSaveDialog(w, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return null
    fs.writeFileSync(r.filePath, diagnosticZip(files()))
    return r.filePath
  })
}
