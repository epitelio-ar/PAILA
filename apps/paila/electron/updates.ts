// Actualizaciones automáticas (Fase H) desde GitHub Releases, con aviso y opción de no actualizar. APAGADAS hasta que
// exista la primera versión publicada: se prenden con `pailaActualizaciones.activas` en apps/paila/package.json.
// Para probar sin GitHub: PAILA_UPDATE_FEED=http://127.0.0.1:<puerto>/ (un servidor con latest.yml y el instalador).
// Bajar y verificar: packages/core/updates.ts. La portable no se reemplaza sola: avisa y abre la página de descargas.
import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { app, ipcMain, shell } from 'electron'
import { checkForUpdate, cleanDownloads, downloadUpdate, REINTENTAR_MS, tocaBuscar, type UpdateInfo } from '@paila/core/updates'
import type { UpdateState } from '@paila/shared/types'
import type { Ctx } from './context'
import { textos } from '@paila/shared/idioma'

// Lo que se ve en Configuración → Actualizaciones (el porqué de apagadas se lee cada vez: sigue al idioma elegido).
const T = textos({
  sinVersiones: {
    es: 'Todavía no hay versiones publicadas de PAILA: las actualizaciones se prenden con la primera.',
    en: "There are no published versions of PAILA yet: updates turn on with the first one.",
  },
  desarrollo: { es: 'En desarrollo no se buscan versiones nuevas.', en: "New versions aren't checked for in development." },
  sinDireccion: { es: 'Falta la dirección de las versiones.', en: 'The address for the versions is missing.' },
  firma: { es: 'El instalador nuevo no tiene la misma firma que este PAILA: no se instala.', en: "The new installer doesn't have the same signature as this PAILA: it won't be installed." },
  ocupada: { es: (busy: string) => `Ahora PAILA está ${busy}. Cuando termine, tocá Instalar de nuevo.`, en: (busy: string) => `PAILA is ${busy} right now. When it's done, click Install again.` },
})

interface Config { activas?: boolean; feed?: string }

/** La configuración que viaja en el package.json de la app. */
function config(): Config {
  try { return (JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8')) as { pailaActualizaciones?: Config }).pailaActualizaciones ?? {} } catch { return {} }
}

/** Quién firmó un .exe (null = sin firma válida). Con PowerShell, como hace Windows. */
function signer(file: string): Promise<string | null> {
  const ps = `$s = Get-AuthenticodeSignature -LiteralPath '${file.replace(/'/g, "''")}'; if ($s.Status -eq 'Valid') { $s.SignerCertificate.Subject }`
  return new Promise((res) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 30_000 }, (e, out) => res(e ? null : out.trim() || null)))
}

export function registerUpdates(ctx: Ctx) {
  const cfg = config()
  const testFeed = process.env.PAILA_UPDATE_FEED
  const feed = testFeed || cfg.feed || ''
  const portable = !!process.env.PORTABLE_EXECUTABLE_DIR
  // en Mac, sin la firma de Apple, PAILA no se puede reemplazar sola: como la portable, abre la página para bajar el .dmg
  const mac = process.platform === 'darwin'
  const whyNow = () => testFeed ? null
    : !cfg.activas ? T.sinVersiones
      : !app.isPackaged ? T.desarrollo
        : !feed ? T.sinDireccion : null
  const why = whyNow()
  const dir = path.join(ctx.userData, 'actualizaciones')
  let info: UpdateInfo | null = null
  let file: string | null = null
  let st: UpdateState = {
    enabled: !why, why, auto: ctx.setting('updates.auto') !== '0', portable, mac, current: app.getVersion(),
    phase: 'quieta', available: null, progress: null, onQuit: false, error: null, lastCheck: ctx.setting('updates.last'),
  }
  const set = (p: Partial<UpdateState>) => { st = { ...st, ...p, why: whyNow() }; ctx.send('updates:state', st); return st }

  const check = async (): Promise<UpdateState> => {
    if (!st.enabled || st.phase === 'bajando' || st.phase === 'lista') return st
    set({ phase: 'buscando', error: null })
    try {
      info = await checkForUpdate(feed, st.current, { skip: ctx.setting('updates.skip') })
      const at = new Date().toISOString(); ctx.setSetting('updates.last', at)
      return set({ phase: info ? 'hay' : 'quieta', available: info && { version: info.version, releaseDate: info.releaseDate }, lastCheck: at })
    } catch (e) { return set({ phase: 'error', error: (e as Error).message }) }
  }

  const download = async (): Promise<UpdateState> => {
    if (!info || st.phase === 'bajando') return st
    // la portable no se reemplaza a sí misma: se baja a mano de la página de la versión
    if (portable || mac) { void shell.openExternal(feed.replace(/\/download\/?$/, '')); return st }
    set({ phase: 'bajando', progress: 0, error: null })
    try {
      let last = 0
      file = await downloadUpdate(feed, info, dir, { onProgress: (d, t) => { const p = t ? d / t : 0; if (p - last >= 0.01) { last = p; set({ progress: p }) } } })
      cleanDownloads(dir, path.basename(file))
      // si este PAILA está firmado, el instalador nuevo tiene que estar firmado por el mismo
      const mine = app.isPackaged ? await signer(process.execPath) : null
      if (mine && await signer(file) !== mine) { fs.rmSync(file, { force: true }); file = null; return set({ phase: 'error', progress: null, error: T.firma }) }
      return set({ phase: 'lista', progress: 1 })
    } catch (e) { return set({ phase: 'error', progress: null, error: (e as Error).message }) }
  }

  /** Corre el instalador sin preguntas (`--updated` respeta lo elegido la primera vez, por ejemplo sin NAPIA). */
  const runInstaller = (reopen: boolean) => {
    if (!file) return
    spawn(file, ['--updated', '/S', ...(reopen ? ['--force-run'] : [])], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  }

  ipcMain.handle('updates:state', () => ({ ...st, why: whyNow() }))
  ipcMain.handle('updates:check', () => check())
  ipcMain.handle('updates:download', () => download())
  ipcMain.handle('updates:install', (_e, when: 'ahora' | 'al-cerrar') => {
    if (st.phase !== 'lista') return st
    if (when === 'al-cerrar') return set({ onQuit: true })
    // nunca en medio de algo que escribe archivos: cerrar a la mitad dejaría trabajo para la recuperación
    const busy = ctx.lib.ops.busy
    if (busy) return set({ error: T.ocupada(busy) })
    runInstaller(true)
    setTimeout(() => app.quit(), 300)
    return st
  })
  ipcMain.handle('updates:skip', () => {
    if (st.available) ctx.setSetting('updates.skip', st.available.version)
    info = null
    return set({ phase: 'quieta', available: null, progress: null, onQuit: false })
  })
  ipcMain.handle('updates:auto', (_e, on: boolean) => { ctx.setSetting('updates.auto', on ? '1' : '0'); return set({ auto: on }) })

  app.on('will-quit', () => { if (st.onQuit && st.phase === 'lista') runInstaller(false) })
  // lo bajado la vez anterior ya se instaló (o se dejó): no se guarda un instalador de 140 MB para siempre
  try { cleanDownloads(dir, null) } catch { /* si está en uso, queda para la próxima */ }
  // Sola: una vez al abrir, después de que arranque lo demás. Si falla (sin internet), reintenta a la media hora, como
  // mucho dos veces. Nada periódico.
  let hechos = 0
  const sola = async () => {
    if (!st.enabled || !st.auto || !tocaBuscar(st.phase, hechos)) return
    hechos++
    if ((await check()).phase === 'error' && tocaBuscar('error', hechos)) setTimeout(() => { void sola() }, REINTENTAR_MS).unref()
  }
  setTimeout(() => { void sola() }, testFeed ? 3000 : 15_000)
}
