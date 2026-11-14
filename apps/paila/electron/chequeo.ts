// El Chequeo (Configuración → Chequeo, core/chequeo.ts) del lado del proceso principal: arma las pruebas de verdad (las claves,
// MusicBrainz, la base, NAPIA y su firewall) y los pedidos `chequeo:*`. Y los avisos sin abrirlo: cuando algo falla al usarse
// (un error que dice "disco lleno" o "base dañada", una búsqueda que se cortó porque el servicio no aceptó la clave), prueba
// ese control y, si está mal, lo manda a la ventana con el mismo texto y arreglo (`chequeo:aviso`, uno por tema cada 15 minutos).
// Al minuto de abrir, en segundo plano, mira lo liviano (los programas, la carpeta de datos, el lugar): solo avisa si está mal.
import fs from 'node:fs'
import path from 'node:path'
import { app, ipcMain, shell } from 'electron'
import type { Control, ControlId } from '@paila/shared/types'
import { CONTROLES, chequear, chequearUno, controlDelError, controlFirewall, type EntradaChequeo, type Sondas } from '@paila/core/chequeo'
import { escribir, libre, musicbrainz, responde, revisarBase } from '@paila/core/chequeo-sondas'
import { soloLectura } from '@paila/core/journal'
import type { ErrorLog } from '@paila/core/errorlog'
import { DEFAULT_LISTEN_PORT, SOCKSEEK_EXE, findSockseek } from '@paila/core/sockseek/config'
import { napiaJsonCandidates } from '@paila/core/sockseek/paila'
import { isProgramOpen } from '@paila/core/sockseek/run'
import { abrirPuerto } from '@paila/core/sockseek/router'
import { PANTALLA_WINDOWS, arreglarFirewall, leerFirewall, routerFalso } from '@paila/core/sockseek/firewall-sistema'
import type { Ctx } from './context'

const CADA = 15 * 60_000
const MB_JOBS = ['names', 'mb', 'albums', 'covers']

/** El sockseek que usa NAPIA: el elegido en NAPIA, el que viene con ella o el de su carpeta de datos. null si no hay. */
function sockseekDeNapia(): string | null {
  const appData = app.getPath('appData'), portable = process.env.PORTABLE_EXECUTABLE_DIR
  let chosen: string | null = null
  for (const f of napiaJsonCandidates(appData, portable)) { try { const e = (JSON.parse(fs.readFileSync(f, 'utf8')) as { exe?: unknown }).exe; if (typeof e === 'string') { chosen = e; break } } catch { /* sin NAPIA */ } }
  const frenoDirs = [
    app.isPackaged ? path.join(process.resourcesPath, 'napia', 'recursos', 'sockseek') : path.join(__dirname, '../../../napia/recursos/sockseek'),
    path.join(appData, 'NAPIA', 'sockseek'), ...(portable ? [path.join(portable, 'NAPIA-datos', 'sockseek')] : []),
  ]
  return findSockseek({ chosen, frenoDirs, localAppData: process.env.LOCALAPPDATA, pathVar: process.env.PATH })?.exe ?? null
}

/** ¿El router deja que NAPIA abra el puerto? Lo abre dos minutos y lo cierra; si NAPIA está bajando, no se toca. */
async function routerDeNapia(): Promise<'ok' | 'dobleNat' | 'no' | 'bajando'> {
  if (isProgramOpen(SOCKSEEK_EXE)) return 'bajando'
  const a = routerFalso() ?? await abrirPuerto(DEFAULT_LISTEN_PORT, { lease: 120 })
  if (!a.ok) return 'no'
  await a.cerrar().catch(() => {})
  return a.mapeo.dobleNat ? 'dobleNat' : 'ok'
}

/** Las búsquedas que se cortaron porque el servicio no aceptó la clave: se avisan con el control de esa clave. */
export function avisarClaves(c: Ctx, porFuente: Partial<Record<string, { clave?: boolean } | undefined>>) {
  for (const s of ['discogs', 'acoustid', 'lastfm'] as const) if (porFuente[s]?.clave) c.avisarControl?.(`clave-${s}`)
}

export function registerChequeo(c: Ctx, log: ErrorLog) {
  const ua = `PAILA/${app.getVersion()} (https://github.com/epitelio-ar/PAILA)`
  const entrada = (): EntradaChequeo => ({
    ffmpeg: c.ffmpeg || null, ffprobe: c.ffprobe || null, datos: c.userData, soloMirar: soloLectura(),
    raices: c.lib.roots().map((r) => ({ path: r.path, nombre: r.path, available: r.available })),
  })
  const sondas: Sondas = {
    responde, escribir, libre,
    clave: (s) => c.probarClave?.(s) ?? Promise.resolve({ hay: false }),
    musicbrainz: async () => (MB_JOBS.some((k) => c.jobs.isWorking(k)) ? 'enUso' : musicbrainz(ua)),
    base: () => revisarBase(path.join(c.userData, 'paila.db')),
    napia: async () => {
      const exe = sockseekDeNapia()
      if (!exe) return null
      const [firewall, router] = await Promise.all([leerFirewall(exe), routerDeNapia().catch(() => null)])
      return { firewall, router }
    },
  }

  let corriendo: Promise<Control[]> | null = null
  ipcMain.handle('chequeo:correr', () => (corriendo ??= chequear(entrada(), sondas, (ctl) => c.send('chequeo:control', ctl)).finally(() => { corriendo = null })))
  ipcMain.handle('chequeo:uno', (_e, id: ControlId) => (CONTROLES.includes(id) ? chequearUno(id, entrada(), sondas) : null))
  ipcMain.handle('chequeo:arreglarFirewall', async () => {
    const exe = sockseekDeNapia()
    if (!exe) return { resultado: 'nada', control: null, firewall: null }
    const r = await arreglarFirewall(exe)
    return { ...r, control: controlFirewall(r.firewall) }
  })
  // solo las dos pantallas de Windows conocidas; con la red inventada (pruebas) no se abre nada
  ipcMain.handle('chequeo:abrirWindows', (_e, que: keyof typeof PANTALLA_WINDOWS) => { if (!process.env.NAPIA_RED_FALSA && PANTALLA_WINDOWS[que]) void shell.openExternal(PANTALLA_WINDOWS[que]) })

  // ---- los avisos sin abrir el Chequeo ----
  // cada control se prueba como mucho una vez cada 15 minutos (mil errores de disco lleno no son mil pruebas ni mil avisos)
  const avisado = new Map<ControlId, number>()
  const avisar = (id: ControlId, soloMal = false) => {
    if (Date.now() - (avisado.get(id) ?? 0) < CADA) return
    avisado.set(id, Date.now())
    void chequearUno(id, entrada(), sondas).then((ctl) => {
      if (ctl && (ctl.estado === 'mal' || (!soloMal && ctl.estado === 'atencion'))) c.send('chequeo:aviso', ctl)
    }).catch(() => {})
  }
  c.avisarControl = (id) => avisar(id)
  log.alAnotar = (_where, msg) => { const id = controlDelError(msg); if (id) avisar(id) }
  c.jobs.alTerminar = (j) => {
    const msgs = [j.failed ? j.summary ?? '' : '', ...j.problems.map((p) => p.error)]
    const id = msgs.map(controlDelError).find(Boolean)
    if (id) avisar(id)
  }
  // las capturas y pruebas (ventana oculta) no necesitan avisos
  if (!process.env.PAILA_SNAPSHOT) setTimeout(() => { for (const id of ['programas', 'datos', 'espacio'] as const) avisar(id, true) }, 60_000).unref()
}
