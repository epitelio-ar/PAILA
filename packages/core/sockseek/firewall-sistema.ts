// NAPIA: leer el firewall de Windows y la red de ahora (sin administrador) y correr el arreglo con el permiso de Windows.
// Lo de Windows entra por `Sistema` (netsh, PowerShell y el permiso de Windows), así los tests y las pantallas de prueba no
// tocan nada: con NAPIA_RED_FALSA=<archivo.json> se usa uno inventado (ver `sistemaFalso`), también desde PAILA.
// Cambiar el tipo de red (Pública → Privada) lo decide la persona: acá solo está qué pantalla de Windows se abre.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import type { FirewallDiag, PerfilRed, ResultadoArreglo } from '@paila/shared/napia'
import { CANCELADO, ESTADO_PS, argumentosElevado, diagnosticar, parseEstado, parseReglas, scriptArreglo } from './firewall'
import type { Apertura } from './router'

export interface Sistema {
  /** La salida de `netsh advfirewall firewall show rule name=all dir=in verbose` ('' si no se pudo). */
  reglas: (exe: string) => Promise<string>
  /** El JSON de ESTADO_PS (null si no se pudo). */
  estado: () => Promise<string | null>
  /** Corre el script con el permiso de Windows; devuelve su código de salida (CANCELADO si se dijo que no). */
  elevado: (script: string, arreglo: NonNullable<FirewallDiag['arreglo']>) => Promise<number | null>
}

/** Las pantallas de Windows que se pueden abrir desde NAPIA y PAILA (solo estas, nunca una que venga de afuera). */
export const PANTALLA_WINDOWS = { red: 'ms-settings:network-status', firewall: 'windowsdefender://network' } as const

/** Corre un programa sin ventana y junta lo que dice; con tope de tiempo. */
function correr(cmd: string, args: string[], o: { encoding: BufferEncoding; timeout: number }): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    let out = ''
    let p: ReturnType<typeof spawn>
    try { p = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }) } catch { resolve({ code: null, out: '' }); return }
    const timer = setTimeout(() => { try { p.kill() } catch { /* ya terminó */ } }, o.timeout)
    p.stdout!.setEncoding(o.encoding)
    p.stdout!.on('data', (d: string) => { if (out.length < 64 * 1024 * 1024) out += d })
    p.on('error', () => { clearTimeout(timer); resolve({ code: null, out }) })
    p.on('close', (code) => { clearTimeout(timer); resolve({ code, out }) })
  })
}

const ps = (script: string) => ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]

export const sistemaReal: Sistema = {
  // la consola de Windows escribe en su página de códigos (850, 437…): latin1 deja cada byte como una letra y el parser lo tolera
  reglas: async () => (await correr('netsh', ['advfirewall', 'firewall', 'show', 'rule', 'name=all', 'dir=in', 'verbose'], { encoding: 'latin1', timeout: 30_000 })).out,
  estado: async () => { const r = await correr('powershell.exe', ps(ESTADO_PS), { encoding: 'utf8', timeout: 30_000 }); return r.code === 0 ? r.out : null },
  // se espera hasta que la persona conteste el permiso de Windows (sin tope corto: puede tardar en leerlo)
  elevado: async (script) => (await correr('powershell.exe', argumentosElevado(script), { encoding: 'utf8', timeout: 10 * 60_000 })).code,
}

/**
 * Lo que dice el archivo de NAPIA_RED_FALSA (para ver las pantallas y probar el botón sin tocar el firewall de nadie):
 * `reglas`: la salida de netsh tal cual, o reglas cortas ({ perfiles: 'Privada', accion: 'Permitir' }) que se arman para el programa;
 * `redes` y `firewall`: como los devuelve ESTADO_PS; `arreglo`: qué pasa al apretar "Arreglarlo" ('listo' de fábrica, 'cancelado'
 * o 'error'); `router`: lo que contesta el router (lo usa NAPIA).
 */
export interface RedFalsa {
  reglas?: string | { perfiles: string; accion: 'Permitir' | 'Bloquear'; habilitada?: string; protocolo?: string }[]
  redes?: { nombre?: string; categoria: string; v4?: string; v6?: string }[]
  firewall?: { perfil: string; prendido?: string; reglas?: string }[]
  arreglo?: 'listo' | 'cancelado' | 'error'
  router?: { ok: boolean; via?: 'upnp' | 'natpmp'; nombre?: string; dobleNat?: boolean; motivo?: 'sinRouter' | 'ocupado' | 'rechazado'; detalle?: string }
}

const NOMBRE: Record<PerfilRed, string> = { dominio: 'Dominio', privada: 'Privada', publica: 'Pública' }
const reglaTexto = (exe: string, r: { perfiles: string; accion: string; habilitada?: string; protocolo?: string }) =>
  ['Nombre de regla:                      sockseek.exe', '-'.repeat(70), `Habilitada:                           ${r.habilitada ?? 'Sí'}`, 'Dirección:                            Dentro',
    `Perfiles:                             ${r.perfiles}`, `Protocolo:                            ${r.protocolo ?? 'TCP'}`, `Programa:                             ${exe}`, `Acción:                               ${r.accion}`].join('\r\n')

/** Un sistema inventado con lo de `RedFalsa`. "Arreglarlo" cambia solo lo inventado (en memoria), como lo haría Windows. */
export function sistemaFalso(f: RedFalsa): Sistema & { ultimoScript: string | null } {
  let reglas = f.reglas ?? []
  const s = {
    ultimoScript: null as string | null,
    reglas: async (exe: string) => (typeof reglas === 'string' ? reglas : reglas.map((r) => reglaTexto(exe, r)).join('\r\n\r\n') || 'Sin reglas'),
    estado: async () => JSON.stringify({ redes: f.redes ?? [], firewall: f.firewall ?? [] }),
    elevado: async (script: string, a: NonNullable<FirewallDiag['arreglo']>) => {
      s.ultimoScript = script
      const r = f.arreglo ?? 'listo'
      if (r !== 'listo') return r === 'cancelado' ? CANCELADO : 1
      // como el script: fuera los bloqueos en esos tipos de red, y una regla que permite donde faltaba
      const lista = typeof reglas === 'string' ? [] : reglas.filter((x) => !(a.sacarBloqueos && /bloq/i.test(x.accion)))
      if (a.permitir.length) lista.push({ perfiles: a.permitir.map((p) => NOMBRE[p]).join(','), accion: 'Permitir' })
      reglas = lista
      return 0
    },
  }
  return s
}

const falsos = new Map<string, ReturnType<typeof sistemaFalso>>()
/** El sistema de verdad, o el inventado si está NAPIA_RED_FALSA (uno por archivo: lo que cambia "Arreglarlo" queda). */
export function sistemaActual(): Sistema | null {
  const f = process.env.NAPIA_RED_FALSA
  if (f) {
    if (!falsos.has(f)) { try { falsos.set(f, sistemaFalso(JSON.parse(fs.readFileSync(f, 'utf8')) as RedFalsa)) } catch { return null } }
    return falsos.get(f)!
  }
  return process.platform === 'win32' ? sistemaReal : null
}

/** Lo que contesta el router en NAPIA_RED_FALSA, si hay (para las pantallas de prueba: no se le habla a ningún router). */
export function routerFalso(): Apertura | undefined {
  const f = process.env.NAPIA_RED_FALSA
  let r: RedFalsa['router']
  try { r = f ? (JSON.parse(fs.readFileSync(f, 'utf8')) as RedFalsa).router : undefined } catch { r = undefined }
  if (!r) return undefined
  if (r.ok) return { ok: true, mapeo: { via: r.via ?? 'upnp', port: 0, router: r.nombre ?? null, externalIp: null, dobleNat: !!r.dobleNat, confirmado: true, lease: 0 }, renovar: async () => true, cerrar: async () => {} }
  return { ok: false, motivo: r.motivo ?? 'sinRouter', detalle: r.detalle ?? '', router: r.nombre ?? null }
}

/** El firewall de Windows para ese programa en la red de ahora. null si no se puede saber (otro sistema, o Windows no contestó). */
export async function leerFirewall(exe: string, s: Sistema | null = sistemaActual()): Promise<FirewallDiag | null> {
  if (!s) return null
  const [texto, estado] = await Promise.all([s.reglas(exe), s.estado()])
  return diagnosticar(parseReglas(texto, exe), parseEstado(estado), exe)
}

/** "Arreglarlo": lo vuelve a mirar (pudo cambiar), corre el arreglo con el permiso de Windows y mira cómo quedó. */
export async function arreglarFirewall(exe: string, s: Sistema | null = sistemaActual()): Promise<{ resultado: ResultadoArreglo; firewall: FirewallDiag | null }> {
  const antes = await leerFirewall(exe, s)
  if (!s || !antes?.arreglo) return { resultado: 'nada', firewall: antes }
  const code = await s.elevado(scriptArreglo(exe, antes.arreglo), antes.arreglo)
  const despues = await leerFirewall(exe, s)
  const anda = !!despues && (despues.caso === 'bien' || despues.caso === 'apagado')
  return { resultado: code === CANCELADO ? 'cancelado' : code === 0 && anda ? 'listo' : 'error', firewall: despues }
}
