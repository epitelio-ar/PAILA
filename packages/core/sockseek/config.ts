// NAPIA: encontrar sockseek (el programa que baja de Soulseek) y leer su configuración, sin mostrar nunca la cuenta.
// sockseek busca su sockseek.conf en ~/.config/sockseek, %APPDATA%\sockseek y al lado del .exe (en ese orden, como dice
// `sockseek --help config`). NAPIA no pide ni guarda la cuenta de Soulseek: solo mira si está puesta.
import fs from 'node:fs'
import path from 'node:path'

export interface FindEnv {
  /** %LOCALAPPDATA%, %APPDATA%, la carpeta del usuario y el PATH. */
  localAppData?: string
  appData?: string
  home?: string
  pathVar?: string
  /** El que eligió la persona (guardado en la config de NAPIA). */
  chosen?: string | null
  /** Carpetas donde puede estar el sockseek con freno de NAPIA (su carpeta de datos, la del programa instalado). */
  frenoDirs?: string[]
}

const isFile = (f: string) => { try { return fs.statSync(f).isFile() } catch { return false } }

/**
 * El sockseek con freno de NAPIA (apps/napia/sockseek-freno): su versión termina en "napia" (3.0.6-napia.1). Frena las
 * miles de conexiones que abre cada búsqueda con el puerto cerrado, que traban muchos routers (ver router.ts).
 */
export const tieneFreno = (version: string | null) => !!version && /-napia\b/i.test(version)

/** Cómo se llama el programa: sockseek.exe en Windows, sockseek en Mac. */
export const SOCKSEEK_EXE = process.platform === 'win32' ? 'sockseek.exe' : 'sockseek'

/**
 * Dónde puede estar sockseek.exe, en orden: el elegido a mano, el con freno de NAPIA, la carpeta de programas del usuario,
 * Program Files y el PATH.
 */
export function findSockseek(env: FindEnv): { exe: string; from: string } | null {
  const tries: [string | undefined, string][] = [[env.chosen ?? undefined, 'elegido a mano']]
  for (const dir of env.frenoDirs ?? []) tries.push([path.join(dir, SOCKSEEK_EXE), 'con freno de NAPIA'])
  if (env.localAppData) tries.push([path.join(env.localAppData, 'Programs', 'sockseek', 'sockseek.exe'), 'carpeta de programas'])
  for (const pf of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) if (pf) tries.push([path.join(pf, 'sockseek', 'sockseek.exe'), 'Program Files'])
  for (const dir of (env.pathVar ?? '').split(path.delimiter).filter(Boolean)) tries.push([path.join(dir, 'sockseek.exe'), 'PATH'], [path.join(dir, 'sockseek'), 'PATH'])
  for (const [f, from] of tries) if (f && isFile(f)) return { exe: f, from }
  return null
}

/** Los lugares donde sockseek busca su config, en su orden. El primero que existe es el que usa. */
export function configCandidates(env: FindEnv, exe: string | null): string[] {
  return [
    env.home && path.join(env.home, '.config', 'sockseek', 'sockseek.conf'),
    env.appData && path.join(env.appData, 'sockseek', 'sockseek.conf'),
    exe && path.join(path.dirname(exe), 'sockseek.conf'),
  ].filter((x): x is string => !!x)
}

export interface ConfigSummary {
  hasUser: boolean
  hasPass: boolean
  outputDir: string | null
  onComplete: boolean
  /** Carpetas que aparecen en las acciones al terminar (sin el {outputdir}), por si mueven lo bajado. */
  moveTo: string[]
  /** El puerto por el que entran los demás usuarios (listen-port), si la config lo dice. */
  listenPort: number | null
}

/** El puerto de escucha de sockseek si la config no dice otro (`sockseek --help`). */
export const DEFAULT_LISTEN_PORT = 49998

const KEYS: Record<string, string> = { user: 'username', username: 'username', pass: 'password', password: 'password', 'output-dir': 'output-dir', o: 'output-dir', 'on-complete': 'on-complete', 'listen-port': 'listen-port' }

/**
 * Lee el texto de un sockseek.conf: `clave = valor` por línea, # comentarios y [perfiles]. Las claves de la parte de arriba
 * valen siempre; las de un perfil, solo si se activa (por eso la cuenta y la carpeta se miran arriba, y las acciones en todos).
 * Devuelve si la cuenta está puesta, pero nunca su valor.
 */
export function readConfig(text: string, home = ''): ConfigSummary {
  let section = '', user = '', pass = '', outputDir: string | null = null, onComplete = false, listenPort: number | null = null
  const actions: string[] = []
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const sec = line.match(/^\[(.+)\]$/)
    if (sec) { section = sec[1].trim(); continue }
    const m = line.match(/^([\w-]+)\s*=\s*(.*)$/)
    if (!m) continue
    const key = KEYS[m[1].toLowerCase()]
    const value = m[2].trim().replace(/^"(.*)"$/, '$1')
    if (key === 'on-complete') { onComplete = true; actions.push(value); continue }
    if (section) continue
    if (key === 'username') user = value
    else if (key === 'password') pass = value
    else if (key === 'output-dir' && value) outputDir = value.replace(/^~(?=[\\/]|$)/, home)
    else if (key === 'listen-port' && /^\d+$/.test(value) && Number(value) > 0 && Number(value) < 65536) listenPort = Number(value)
  }
  const moveTo = new Set<string>()
  for (const a of actions) {
    for (const q of a.matchAll(/"([^"]+)"/g)) {
      const p = q[1].trim()
      if (/^(?:[a-z]:[\\/]|\\\\|\/)/i.test(p) && !/\{[^}]+\}/.test(p) && !/\.(?:ps1|exe|bat|cmd|py|sh|js)$/i.test(p)) moveTo.add(p)
    }
  }
  return { hasUser: !!user, hasPass: !!pass, outputDir, onComplete, moveTo: [...moveTo], listenPort }
}

/** Una config nueva para completar a mano (si no hay ninguna). La cuenta queda vacía: la escribe cada uno. */
export const CONFIG_TEMPLATE = [
  '# Configuración de sockseek (la armó NAPIA para que completes tu cuenta de Soulseek).',
  '# Escribí tu usuario y tu contraseña después del "=", guardá el archivo y volvé a NAPIA.',
  '# NAPIA no lee ni guarda tu contraseña: queda solo acá, en tu compu.',
  'username = ',
  'password = ',
  '',
].join('\r\n')
