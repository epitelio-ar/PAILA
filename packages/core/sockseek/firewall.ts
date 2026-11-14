// NAPIA: el firewall de Windows y el tipo de red, cruzados. Cada regla del firewall vale para ciertos tipos de red (Privada,
// Pública, de Dominio) y la red de ahora es de uno: sockseek recibe conexiones solo si una regla que permite cubre ese tipo y
// ninguna que bloquea lo cubre (la que bloquea gana). De ahí salen los casos (nunca se contestó el cartel, se dijo que no,
// tiene permiso en el otro tipo de red, todo bien) y el arreglo, que se corre una vez con el permiso de Windows (UAC).
// Acá está lo puro: leer la salida de netsh (en el idioma de Windows; sale en la página de códigos de la consola, "P£blica"
// es "Pública" en la 850) y la del tipo de red, cruzarlas y armar el arreglo. Lo que toca el sistema está en firewall-sistema.ts.
import type { FirewallDiag, PerfilRed } from '@paila/shared/napia'

export const PERFILES: PerfilRed[] = ['dominio', 'privada', 'publica']

/** "Privada,Pública", "Domain,Private,Public", "Cualquiera"… → los tipos de red. null si no se entiende. */
export function perfilesDe(valor: string): PerfilRed[] | null {
  const out = new Set<PerfilRed>()
  for (const t of valor.split(/[,;]/).map((x) => x.trim().toLowerCase()).filter(Boolean)) {
    if (/^(any|all|cualquier|tod|tous|alle|qualsiasi|qualquer)/.test(t)) PERFILES.forEach((p) => out.add(p))
    else if (/^dom/.test(t)) out.add('dominio')
    else if (/^priv/.test(t)) out.add('privada')
    else if (/^p.{0,2}bl|ffentl/.test(t)) out.add('publica')
  }
  return out.size ? PERFILES.filter((p) => out.has(p)) : null
}

export interface Regla {
  habilitada: boolean
  accion: 'permitir' | 'bloquear' | null
  /** null: no se pudo leer (cuenta como todas). */
  perfiles: PerfilRed[] | null
  /** Vale para TCP (por donde llegan los temas). Una regla solo de UDP no cambia nada. */
  tcp: boolean
}

const valor = (lineas: string[], etiqueta: RegExp) => {
  const l = lineas.find((x) => etiqueta.test(x.trim()))
  return l ? l.slice(l.indexOf(':') + 1).trim() : null
}

/** Las variables de una ruta (%USERPROFILE%\…), como las deja a veces el firewall. Sin importar mayúsculas. */
function expandir(ruta: string, env: Record<string, string | undefined>) {
  return ruta.replace(/%([^%]+)%/g, (m, k: string) => {
    const clave = Object.keys(env).find((x) => x.toUpperCase() === k.toUpperCase())
    return (clave && env[clave]) || m
  })
}
const normal = (ruta: string) => ruta.replace(/\//g, '\\').replace(/^"|"$/g, '').toLowerCase()

/**
 * Las reglas de entrada para ese programa en la salida de `netsh advfirewall firewall show rule name=all dir=in verbose`.
 * Se reconocen por la ruta del programa (con o sin variables) y se leen Habilitada, Perfiles, Protocolo y Acción en el idioma
 * de Windows. null si la salida está vacía (no se pudo leer).
 */
export function parseReglas(text: string, exe: string, env: Record<string, string | undefined> = process.env): Regla[] | null {
  if (!text.trim()) return null
  const want = normal(exe)
  const out: Regla[] = []
  for (const b of text.split(/\r?\n\s*\r?\n/)) {
    const lineas = b.split(/\r?\n/)
    const prog = valor(lineas, /^Program[a-z]*\s*:/i)
    if (prog ? normal(expandir(prog, env)) !== want : !b.toLowerCase().includes(want)) continue
    const hab = valor(lineas, /^(Habilitad|Enabled|Activ|Aktiviert|Abilitat)[^:]*:/i)
    const acc = valor(lineas, /^(Acci|Action|Aktion|Azione|A..o\b)[^:]*:/i) ?? lineas.map((l) => l.trim()).reverse().find((l) => /\b(Bloquear|Block|Bloquer|Blockieren|Permitir|Allow|Autoriser|Zulassen)\s*$/i.test(l)) ?? ''
    const perf = valor(lineas, /^(Perfil|Profil)[^:]*:/i)
    const proto = valor(lineas, /^Proto[ck]ol[a-z]*\s*:/i)
    out.push({
      habilitada: !/^(No|Non|Nein)\b/i.test(hab ?? ''),
      accion: /(Bloquear|Block|Bloquer|Blockieren|Blocca)/i.test(acc) ? 'bloquear' : /(Permitir|Allow|Autoriser|Zulassen|Consenti)/i.test(acc) ? 'permitir' : null,
      perfiles: perf ? perfilesDe(perf) : null,
      tcp: !proto || !(/^(UDP|ICMP)/i.test(proto) || (/^\d+$/.test(proto) && proto !== '6')),
    })
  }
  return out
}

/** La red de ahora y el firewall de cada tipo de red (Get-NetConnectionProfile y Get-NetFirewallProfile, sin administrador). */
export interface EstadoRed {
  redes: { perfil: PerfilRed; nombre: string | null; internet: boolean }[]
  firewall: { perfil: PerfilRed; prendido: boolean; dejaReglas: boolean }[]
}

const categoria = (v: unknown): PerfilRed | null => {
  const s = String(v ?? '').toLowerCase()
  return s === 'public' || s === '0' ? 'publica' : s === 'private' || s === '1' ? 'privada' : s.startsWith('domain') || s === '2' ? 'dominio' : null
}
const lista = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v : v && typeof v === 'object' ? [v] : []) as Record<string, unknown>[]
const no = (v: unknown) => /^(false|0)$/i.test(String(v ?? ''))

/** El JSON que arma ESTADO_PS (los valores pueden venir como nombre o número, según Windows). null si no se entiende. */
export function parseEstado(json: string | null): EstadoRed | null {
  if (!json?.trim()) return null
  let o: { redes?: unknown; firewall?: unknown }
  try { o = JSON.parse(json.replace(/^\uFEFF/, '')) } catch { return null }
  const redes = lista(o.redes).flatMap((r) => {
    const perfil = categoria(r.categoria)
    return perfil ? [{ perfil, nombre: typeof r.nombre === 'string' && r.nombre.trim() ? r.nombre.trim() : null, internet: [r.v4, r.v6].some((x) => /^(internet|4)$/i.test(String(x ?? ''))) }] : []
  })
  const firewall = lista(o.firewall).flatMap((f) => {
    const perfil = perfilesDe(String(f.perfil ?? ''))?.[0]
    return perfil ? [{ perfil, prendido: !no(f.prendido), dejaReglas: !no(f.reglas) }] : []
  })
  return { redes, firewall }
}

/** Lo que corre PowerShell (sin administrador) para saber el tipo de la red de ahora y si el firewall está prendido. */
export const ESTADO_PS = [
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
  "$ErrorActionPreference = 'SilentlyContinue'",
  '$r = @(Get-NetConnectionProfile | ForEach-Object { [pscustomobject]@{ nombre = $_.Name; categoria = [string]$_.NetworkCategory; v4 = [string]$_.IPv4Connectivity; v6 = [string]$_.IPv6Connectivity } })',
  '$f = @(Get-NetFirewallProfile -PolicyStore ActiveStore | ForEach-Object { [pscustomobject]@{ perfil = [string]$_.Name; prendido = [string]$_.Enabled; reglas = [string]$_.AllowInboundRules } })',
  '[pscustomobject]@{ redes = $r; firewall = $f } | ConvertTo-Json -Depth 3 -Compress',
].join('\n')

const NETSH: Record<PerfilRed, string> = { dominio: 'domain', privada: 'private', publica: 'public' }
const PS: Record<PerfilRed, string> = { dominio: 'Domain', privada: 'Private', publica: 'Public' }
const MASCARA: Record<PerfilRed, number> = { dominio: 1, privada: 2, publica: 4 }

/**
 * Cruza las reglas con la red de ahora. Si no se pudo saber el tipo de red, se mira solo si hay algún permiso.
 * null si no se pudieron leer las reglas.
 */
export function diagnosticar(reglas: Regla[] | null, estado: EstadoRed | null, exe: string): FirewallDiag | null {
  if (!reglas) return null
  const vale = reglas.filter((r) => r.habilitada && r.tcp && r.accion)
  const cubre = (r: Regla, p: PerfilRed) => !r.perfiles || r.perfiles.includes(p)
  const permite = (p: PerfilRed) => vale.some((r) => r.accion === 'permitir' && cubre(r, p))
  const bloquea = (p: PerfilRed) => vale.some((r) => r.accion === 'bloquear' && cubre(r, p))
  const permitidos = PERFILES.filter((p) => permite(p) && !bloquea(p))
  const bloqueados = PERFILES.filter(bloquea)
  // la red que importa es la que tiene internet (un adaptador virtual sin internet suele figurar como Pública)
  const redes = estado?.redes ?? []
  const usadas = redes.some((r) => r.internet) ? redes.filter((r) => r.internet) : redes
  const activos = PERFILES.filter((p) => usadas.some((r) => r.perfil === p))
  const red = usadas.find((r) => r.nombre)?.nombre ?? null
  const base = { activos, red, permitidos, bloqueados, arreglo: null, aMano: null }
  const fw = (p: PerfilRed) => estado?.firewall.find((f) => f.perfil === p)
  if (activos.length && activos.every((p) => fw(p)?.prendido === false)) return { ...base, caso: 'apagado' }
  if (activos.some((p) => fw(p)?.prendido !== false && fw(p)?.dejaReglas === false)) return { ...base, caso: 'todoBloqueado' }
  let caso: FirewallDiag['caso']
  if (!activos.length) caso = permitidos.length ? 'bien' : bloqueados.length ? 'bloqueado' : 'sinRegla'
  else {
    const fallan = activos.filter((p) => !permitidos.includes(p))
    caso = !fallan.length ? 'bien' : permitidos.length ? 'otroPerfil' : fallan.some(bloquea) ? 'bloqueado' : 'sinRegla'
  }
  if (caso === 'bien') return { ...base, caso }
  // el arreglo deja con permiso la red de ahora y siempre las privadas (las de casa); si no se sabe la red, como antes: privadas y de dominio
  const perfiles = activos.length ? PERFILES.filter((p) => activos.includes(p) || p === 'privada') : (['dominio', 'privada'] as PerfilRed[])
  const arreglo = { perfiles, sacarBloqueos: perfiles.some(bloquea), permitir: perfiles.filter((p) => !permite(p)) }
  return { ...base, caso, arreglo, aMano: comandoAMano(exe, arreglo, permitidos) }
}

/** Para la Terminal como administrador: sacar las reglas de entrada de sockseek (si alguna bloquea) y dar permiso donde hace falta. */
export function comandoAMano(exe: string, a: NonNullable<FirewallDiag['arreglo']>, permitidos: PerfilRed[] = []): string {
  const perfiles = PERFILES.filter((p) => a.perfiles.includes(p) || (a.sacarBloqueos && permitidos.includes(p)))
  const sumar = `netsh advfirewall firewall add rule name="sockseek (NAPIA)" dir=in action=allow program="${exe}" enable=yes profile=${perfiles.map((p) => NETSH[p]).join(',')}`
  return a.sacarBloqueos ? `netsh advfirewall firewall delete rule name=all dir=in program="${exe}"\n${sumar}` : sumar
}

/**
 * El script del arreglo (PowerShell, con administrador): saca solo las reglas de entrada de ese programa que bloquean en esos
 * tipos de red y suma una que permite donde falta. Sale con 0 si anduvo y 1 si no.
 */
export function scriptArreglo(exe: string, a: NonNullable<FirewallDiag['arreglo']>): string {
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`
  const mascara = a.perfiles.reduce((m, p) => m | MASCARA[p], 0)
  return [
    "$ErrorActionPreference = 'Stop'",
    'try {',
    `  $exe = ${q(exe)}`,
    ...(a.sacarBloqueos ? [
      '  Get-NetFirewallRule -Direction Inbound -Action Block -ErrorAction SilentlyContinue | Where-Object {',
      '    $p = ($_ | Get-NetFirewallApplicationFilter).Program',
      `    $p -and ([Environment]::ExpandEnvironmentVariables($p) -ieq $exe) -and (([int]$_.Profile -eq 0) -or (([int]$_.Profile -band ${mascara}) -ne 0))`,
      '  } | Remove-NetFirewallRule',
    ] : []),
    ...(a.permitir.length ? [`  New-NetFirewallRule -DisplayName 'sockseek (NAPIA)' -Direction Inbound -Action Allow -Program $exe -Profile ${a.permitir.map((p) => PS[p]).join(',')} -Enabled True | Out-Null`] : []),
    '  exit 0',
    '} catch { exit 1 }',
  ].join('\n')
}

const base64 = (s: string) => Buffer.from(s, 'utf16le').toString('base64')
/** Código con que sale PowerShell si la persona dijo que no al permiso de Windows (ERROR_CANCELLED). */
export const CANCELADO = 1223

/**
 * Los argumentos de powershell.exe para correr un script con el permiso de Windows (UAC): Start-Process -Verb RunAs, oculto,
 * espera a que termine y devuelve su código; si se dijo que no al permiso, sale con CANCELADO. Todo va cifrado en base64
 * (-EncodedCommand): las rutas con espacios, comillas o acentos no se rompen.
 */
export function argumentosElevado(script: string): string[] {
  const afuera = `try { $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${base64(script)}'; exit $p.ExitCode } catch { exit ${CANCELADO} }`
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', base64(afuera)]
}
