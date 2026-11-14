// Los discos de la biblioteca (el pie de la barra lateral): cuál es cada uno (nombre, letra, espacio, si es externo) y expulsarlo
// sin riesgo. El autor (01/11): "los íconos de los discos no se entienden, al apretarlo no te dice ni cuál es y no te permite
// desconectarlos". Expulsar pasa por el candado de operaciones (nada se está moviendo ni escribiendo) y pausa el análisis hasta
// que suelta los archivos; después le pide a Windows que lo expulse, como "Quitar hardware de forma segura". Cuando el disco ya
// no está, el análisis queda "en pausa: se desconectó F:" (core/rootswatch.ts) y sigue solo si vuelve.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { ipcMain } from 'electron'
import { infoDisco } from '@paila/core/sockseek/carpetas'
import type { DiscoRaiz } from '@paila/shared/types/api-discos'
import type { Ctx } from '../context'
import { textos } from '@paila/shared/idioma'

const T = textos({
  noExterno: { es: 'Ese disco no es externo: no se puede expulsar.', en: "That disk isn't external: it can't be ejected." },
  noConectado: { es: 'Ese disco ya no está conectado.', en: "That disk isn't connected anymore." },
  listo: { es: (l: string) => `Listo: podés desconectar ${l}.`, en: (l: string) => `Done: you can unplug ${l}.` },
  enUso: {
    es: (l: string) => `Windows no pudo expulsar ${l}: algún programa lo está usando (el Explorador, un reproductor, NAPIA…). Cerralo y probá de nuevo.`,
    en: (l: string) => `Windows couldn't eject ${l}: some program is using it (File Explorer, a player, NAPIA…). Close it and try again.`,
  },
})

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function registerDiscos(c: Ctx) {
  const { lib } = c
  ipcMain.handle('discos:info', (): DiscoRaiz[] => lib.roots().map((r) => {
    const d = r.available ? infoDisco(r.path) : null
    const letra = /^([a-z]:)/i.exec(r.path)?.[1]?.toUpperCase() ?? null
    return {
      rootId: r.id, carpeta: r.path, nombre: d?.etiqueta || r.volumeLabel || path.basename(r.path) || r.path, letra, conectado: r.available,
      externo: d?.externo ?? null, libre: d?.libre ?? null, total: d?.total ?? null,
    }
  }))

  ipcMain.handle('discos:expulsar', async (_e, rootId: number) => {
    const r = lib.roots().find((x) => x.id === rootId)
    if (!r?.available) return { ok: false, mensaje: T.noConectado }
    const letra = /^([a-z]:)/i.exec(r.path)?.[1]?.toUpperCase()
    if (!letra || infoDisco(r.path).externo !== true) return { ok: false, mensaje: T.noExterno }
    // nada moviendo ni escribiendo, y el análisis en pausa hasta que suelta los archivos: recién ahí se le pide a Windows
    return c.withPaused(async () => {
      if (process.platform === 'win32') {
        spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `(New-Object -ComObject Shell.Application).Namespace(17).ParseName('${letra}').InvokeVerb('Eject')`], { windowsHide: true, timeout: 20_000 })
      }
      for (let i = 0; i < 16; i++) { if (!fs.existsSync(`${letra}\\`)) return { ok: true, mensaje: T.listo(letra) }; await espera(500) }
      return { ok: false, mensaje: T.enUso(letra) }
    })
  })
}
