// NAPIA: abrir en el router el puerto por el que los demás usuarios de Soulseek se conectan con sockseek, confirmarlo y
// cerrarlo al terminar. sockseek no lo hace solo (SoulseekQt sí, y solo mientras está abierto): sin eso, con la mayoría de
// los routers ninguna descarga arranca ("Failed to establish a direct or indirect … connection").
// - UPnP IGD: se busca el router por SSDP (UDP 239.255.255.250:1900), se lee su descripción y se le habla por SOAP
//   (AddPortMapping, GetSpecificPortMappingEntry para confirmarlo, DeletePortMapping, GetExternalIPAddress).
// - NAT-PMP (RFC 6886, routers Apple y algunos más): UDP al puerto 5351 de la puerta de enlace.
// - Desde afuera: la prueba de puerto del propio Soulseek (slsknet.org/porttest.php), la misma que usa Nicotine+.
// - El router trabado: con el puerto cerrado, cada búsqueda hace que sockseek abra miles de conexiones a la vez (cada usuario
//   con resultados le pide al servidor que lo llamemos); muchos routers de casa se llenan y dejan de dejar pasar conexiones
//   nuevas, hasta internet, por segundos o minutos (medido el 21/10 en un router común de proveedor de internet: ~5.000 a la vez). El sockseek con
//   freno de NAPIA lo evita; `hayConexion` sirve para darse cuenta mientras baja.
// Sin librerías (las que hay arrastran decenas de paquetes): todo lo de la red se puede cambiar en los tests (Red).
import dgram from 'node:dgram'
import net from 'node:net'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { textos } from '@paila/shared/idioma'
import { fetchSinBrotli } from '../online/http'

// Lo que se ve (en "Ver el detalle"). Lo que se le manda al router (la descripción del mapeo) no se traduce.
const T = textos({
  errorRouter: { es: 'error del router', en: 'router error' },
  sinIp: { es: 'No se pudo saber la dirección de esta compu en la red de tu casa.', en: 'Couldn\'t find this computer\'s address on your home network.' },
  otraCompu: { es: (port: number, ip: string) => `El router ya manda el puerto ${port} a otra compu (${ip}).`, en: (port: number, ip: string) => `The router already sends port ${port} to another computer (${ip}).` },
  yaUsado: { es: (port: number) => `El router dice que el puerto ${port} ya lo usa otra cosa.`, en: (port: number) => `The router says port ${port} is already used by something else.` },
  noDejo: { es: (por: string) => `El router no dejó abrir el puerto (${por}).`, en: (por: string) => `The router wouldn't open the port (${por}).` },
  natpmp: { es: (code: string) => `NAT-PMP, código ${code}`, en: (code: string) => `NAT-PMP, code ${code}` },
  sinRespuesta: { es: 'sin respuesta', en: 'no answer' },
  otroPuerto: {
    es: (otro: number | undefined, port: number) => `El router ofreció otro puerto (${otro}) en vez del ${port}: el ${port} ya lo usa otra cosa.`,
    en: (otro: number | undefined, port: number) => `The router offered another port (${otro}) instead of ${port}: ${port} is already used by something else.`,
  },
  noContesto: { es: 'El router no contestó: puede que no tenga UPnP (o lo tenga apagado).', en: 'The router didn\'t answer: it may not have UPnP (or it\'s turned off).' },
})

// ---------- piezas puras ----------

const SSDP_ST = ['urn:schemas-upnp-org:device:InternetGatewayDevice:1', 'urn:schemas-upnp-org:device:InternetGatewayDevice:2', 'urn:schemas-upnp-org:service:WANIPConnection:1', 'urn:schemas-upnp-org:service:WANPPPConnection:1']
export const ssdpSearch = (st: string) => `M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${st}\r\n\r\n`

/** La dirección de la descripción del router en una respuesta SSDP (encabezado LOCATION). */
export const ssdpLocation = (text: string) => text.match(/^location:\s*(\S+)\s*$/im)?.[1] ?? null

export interface WanService { serviceType: string; controlUrl: string }

/** Los servicios WANIPConnection / WANPPPConnection de la descripción del router, con la dirección de control completa. */
export function parseDescription(xml: string, location: string): { name: string | null; services: WanService[] } {
  const base = xml.match(/<URLBase>\s*([^<\s]+)\s*<\/URLBase>/i)?.[1] ?? location
  const services: WanService[] = []
  for (const m of xml.matchAll(/<service>([\s\S]*?)<\/service>/gi)) {
    const type = m[1].match(/<serviceType>\s*([^<\s]+)\s*<\/serviceType>/i)?.[1]
    const ctrl = m[1].match(/<controlURL>\s*([^<\s]+)\s*<\/controlURL>/i)?.[1]
    if (!type || !ctrl || !/:WAN(IP|PPP)Connection:\d/i.test(type)) continue
    try { services.push({ serviceType: type, controlUrl: new URL(ctrl, base).href }) } catch { /* dirección rota: se saltea */ }
  }
  // WANIPConnection primero: el PPP suele estar de adorno en routers que no usan PPPoE
  services.sort((a, b) => Number(/PPP/i.test(a.serviceType)) - Number(/PPP/i.test(b.serviceType)))
  const name = xml.match(/<friendlyName>\s*([^<]+?)\s*<\/friendlyName>/i)?.[1] ?? xml.match(/<modelName>\s*([^<]+?)\s*<\/modelName>/i)?.[1] ?? null
  return { name, services }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
export function soapEnvelope(serviceType: string, action: string, args: Record<string, string | number>): string {
  const body = Object.entries(args).map(([k, v]) => `<${k}>${esc(String(v))}</${k}>`).join('')
  return `<?xml version="1.0"?>\r\n<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${serviceType}">${body}</u:${action}></s:Body></s:Envelope>\r\n`
}

export type SoapResult = { ok: true; values: Record<string, string> } | { ok: false; code: number | null; text: string }

/** La respuesta SOAP: los valores (NewExternalIPAddress…) o el error UPnP (718 = ya usado por otro, 725 = solo permanentes…). */
export function parseSoap(xml: string, httpOk: boolean): SoapResult {
  if (!httpOk || /<(?:\w+:)?Fault>/i.test(xml)) {
    const code = xml.match(/<(?:\w+:)?errorCode>\s*(\d+)\s*</i)?.[1]
    const text = xml.match(/<(?:\w+:)?errorDescription>\s*([^<]*?)\s*</i)?.[1] ?? T.errorRouter
    return { ok: false, code: code ? Number(code) : null, text }
  }
  const values: Record<string, string> = {}
  for (const m of xml.matchAll(/<(?:\w+:)?(New\w+)>([^<]*)<\/(?:\w+:)?\1>/g)) values[m[1]] = m[2].trim()
  return { ok: true, values }
}

/** Direcciones que no son de internet: si el router tiene una de estas "afuera", hay otro router (o la empresa) delante. */
export function isPrivateIp(ip: string): boolean {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x))) return false
  return p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || (p[0] === 169 && p[1] === 254)
}

/** La puerta de enlace en la salida de `route print -4 0.0.0.0` (Windows), `ip route show default` o `route -n get default`. */
export function parseDefaultGateway(text: string): string | null {
  const ip = String.raw`(\d{1,3}(?:\.\d{1,3}){3})`
  const win = [...text.matchAll(new RegExp(String.raw`^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+${ip}\s+${ip}\s+(\d+)`, 'gm'))].sort((a, b) => Number(a[3]) - Number(b[3]))
  if (win[0]) return win[0][1]
  return text.match(new RegExp(String.raw`default via ${ip}`))?.[1] ?? text.match(new RegExp(String.raw`gateway:\s*${ip}`))?.[1] ?? null
}

/** El resultado de la prueba de puerto de Soulseek: "Port: 2416/tcp CLOSED." u "OPEN". */
export function parsePortTest(html: string, port: number): 'abierto' | 'cerrado' | null {
  const m = html.match(/Port:\s*(\d+)\/tcp\s+(OPEN|CLOSED)/i)
  if (!m || Number(m[1]) !== port) return null
  return m[2].toUpperCase() === 'OPEN' ? 'abierto' : 'cerrado'
}

// NAT-PMP (RFC 6886): pedidos y respuestas de 12 y 16 bytes
export function natpmpMapRequest(internalPort: number, externalPort: number, lifetime: number): Buffer {
  const b = Buffer.alloc(12)
  b.writeUInt8(0, 0); b.writeUInt8(2, 1) // versión 0, mapear TCP
  b.writeUInt16BE(internalPort, 4); b.writeUInt16BE(externalPort, 6); b.writeUInt32BE(lifetime, 8)
  return b
}
export function parseNatpmp(buf: Buffer): { op: number; result: number; externalIp?: string; internalPort?: number; externalPort?: number; lifetime?: number } | null {
  if (buf.length < 8 || buf[0] !== 0 || buf[1] < 128) return null
  const op = buf[1] - 128, result = buf.readUInt16BE(2)
  if (op === 0 && buf.length >= 12) return { op, result, externalIp: [...buf.subarray(8, 12)].join('.') }
  if (op === 2 && buf.length >= 16) return { op, result, internalPort: buf.readUInt16BE(8), externalPort: buf.readUInt16BE(10), lifetime: buf.readUInt32BE(12) }
  return { op, result }
}

// ---------- la red (se reemplaza en los tests) ----------

export interface Red {
  /** Respuestas SSDP (texto de cada una) que llegan durante `ms`. */
  ssdp(ms: number): Promise<{ text: string; from: string }[]>
  http(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ ok: boolean; text: string }>
  /** Manda un datagrama a host:puerto y devuelve la primera respuesta (o null si no contesta a tiempo). */
  udp(host: string, port: number, msg: Buffer, ms: number): Promise<Buffer | null>
  /** La IP de esta compu que se usa para llegar a `host` (la que se le dice al router). */
  localIpFor(host: string): Promise<string | null>
  defaultGateway(): string | null
  /** ¿Se puede abrir una conexión TCP a host:puerto en `ms`? */
  tcp(host: string, port: number, ms: number): Promise<boolean>
}

const httpTimeout = 5000
export const redReal: Red = {
  ssdp(ms) {
    return new Promise((resolve) => {
      const got: { text: string; from: string }[] = []
      const sockets: dgram.Socket[] = []
      // por cada placa de red (Wi-Fi, cable, adaptadores virtuales): si no, el aviso puede salir por la que no es
      const ifaces = Object.values(os.networkInterfaces()).flat().filter((i): i is os.NetworkInterfaceInfoIPv4 => !!i && i.family === 'IPv4' && !i.internal)
      for (const addr of ifaces.length ? ifaces.map((i) => i.address) : [undefined]) {
        const s = dgram.createSocket({ type: 'udp4', reuseAddr: true })
        sockets.push(s)
        s.on('error', () => { try { s.close() } catch { /* ya cerrado */ } })
        s.on('message', (m, r) => got.push({ text: m.toString('utf8'), from: r.address }))
        s.bind(0, addr, () => { for (const st of SSDP_ST) s.send(ssdpSearch(st), 1900, '239.255.255.250', () => {}) })
      }
      setTimeout(() => { for (const s of sockets) { try { s.close() } catch { /* ya cerrado */ } } resolve(got) }, ms)
    })
  },
  async http(url, init) {
    const r = await fetchSinBrotli(url, { method: init?.method ?? 'GET', headers: init?.headers, body: init?.body, signal: AbortSignal.timeout(httpTimeout) })
    return { ok: r.ok, text: await r.text() }
  },
  udp(host, port, msg, ms) {
    return new Promise((resolve) => {
      const s = dgram.createSocket('udp4')
      const end = (v: Buffer | null) => { clearTimeout(t); try { s.close() } catch { /* ya cerrado */ } resolve(v) }
      const t = setTimeout(() => end(null), ms)
      s.on('error', () => end(null))
      s.on('message', (m, r) => { if (r.address === host) end(m) })
      s.send(msg, port, host)
    })
  },
  localIpFor(host) {
    return new Promise((resolve) => {
      const s = dgram.createSocket('udp4')
      s.on('error', () => { try { s.close() } catch { /* ya cerrado */ } resolve(null) })
      s.connect(9, host, () => { const a = s.address().address; s.close(); resolve(a) })
    })
  },
  defaultGateway() {
    const cmd = process.platform === 'win32' ? ['route', ['print', '-4', '0.0.0.0']] : process.platform === 'darwin' ? ['route', ['-n', 'get', 'default']] : ['ip', ['route', 'show', 'default']]
    const r = spawnSync(cmd[0] as string, cmd[1] as string[], { encoding: 'latin1', windowsHide: true, timeout: 5000 })
    return parseDefaultGateway(r.stdout ?? '')
  },
  tcp(host, port, ms) {
    return new Promise((resolve) => {
      const c = net.connect({ host, port })
      const end = (ok: boolean) => { c.destroy(); resolve(ok) }
      c.setTimeout(ms, () => end(false))
      c.on('connect', () => end(true))
      c.on('error', () => end(false))
    })
  },
}

// ---------- abrir, confirmar y cerrar ----------

export interface Mapeo {
  via: 'upnp' | 'natpmp'
  port: number
  /** El nombre del router, si lo dice. */
  router: string | null
  /** La IP de afuera que dice el router (null si no la dijo). */
  externalIp: string | null
  /** La IP de afuera es privada: hay otro router o la empresa de internet delante, y abrir este no alcanza. */
  dobleNat: boolean
  /** El router confirmó que el puerto apunta a esta compu. */
  confirmado: boolean
  /** Segundos que dura (0 = hasta que se borre). */
  lease: number
}

export type Apertura = { ok: true; mapeo: Mapeo; renovar: () => Promise<boolean>; cerrar: () => Promise<void> }
  | { ok: false; motivo: 'sinRouter' | 'ocupado' | 'rechazado'; detalle: string; router: string | null }

interface Upnp { service: WanService; name: string | null; host: string }

const soap = async (red: Red, u: Upnp, action: string, args: Record<string, string | number>): Promise<SoapResult> => {
  try {
    const r = await red.http(u.service.controlUrl, { method: 'POST', headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${u.service.serviceType}#${action}"` }, body: soapEnvelope(u.service.serviceType, action, args) })
    return parseSoap(r.text, r.ok)
  } catch (e) { return { ok: false, code: null, text: (e as Error).message } }
}

/** Busca un router con UPnP que conteste. null si no hay (o lo tiene apagado). */
export async function findUpnp(red: Red, ms = 2500): Promise<(Upnp & { externalIp: string | null }) | null> {
  const locations = [...new Set((await red.ssdp(ms)).map((r) => ssdpLocation(r.text)).filter((x): x is string => !!x))]
  for (const loc of locations) {
    let desc: ReturnType<typeof parseDescription>
    try { const r = await red.http(loc); if (!r.ok) continue; desc = parseDescription(r.text, loc) } catch { continue }
    for (const service of desc.services) {
      const u = { service, name: desc.name, host: new URL(service.controlUrl).hostname }
      const ip = await soap(red, u, 'GetExternalIPAddress', {})
      // un servicio que contesta (aunque sea PPP sin conectar) sirve; se prefiere el que dice una IP de afuera
      if (ip.ok && ip.values.NewExternalIPAddress) return { ...u, externalIp: ip.values.NewExternalIPAddress }
    }
    if (desc.services[0]) return { service: desc.services[0], name: desc.name, host: new URL(desc.services[0].controlUrl).hostname, externalIp: null }
  }
  return null
}

const DESCRIPTION = 'NAPIA (sockseek)'

/**
 * Abre `port` (TCP, el mismo adentro y afuera) hacia esta compu: primero UPnP y, si no hay, NAT-PMP. Pide `lease` segundos
 * (se renueva mientras sockseek baja y se cierra al terminar; si NAPIA se cae, el router lo cierra solo al vencer).
 */
export async function abrirPuerto(port: number, o: { lease?: number; red?: Red; descripcion?: string } = {}): Promise<Apertura> {
  const red = o.red ?? redReal, lease = o.lease ?? 3600, desc = o.descripcion ?? DESCRIPTION
  const u = await findUpnp(red)
  if (u) {
    const me = await red.localIpFor(u.host)
    if (!me) return { ok: false, motivo: 'rechazado', detalle: T.sinIp, router: u.name }
    const entry = async () => { const r = await soap(red, u, 'GetSpecificPortMappingEntry', { NewRemoteHost: '', NewExternalPort: port, NewProtocol: 'TCP' }); return r.ok ? r.values : null }
    const before = await entry()
    if (before && before.NewInternalClient && before.NewInternalClient !== me) {
      return { ok: false, motivo: 'ocupado', detalle: T.otraCompu(port, before.NewInternalClient), router: u.name }
    }
    let usedLease = lease
    const add = async (l: number) => soap(red, u, 'AddPortMapping', { NewRemoteHost: '', NewExternalPort: port, NewProtocol: 'TCP', NewInternalPort: port, NewInternalClient: me, NewEnabled: 1, NewPortMappingDescription: desc, NewLeaseDuration: l })
    let r = await add(usedLease)
    // 725: el router solo acepta mapeos permanentes (entonces se borra sí o sí al terminar)
    if (!r.ok && r.code === 725) { usedLease = 0; r = await add(0) }
    if (!r.ok) {
      if (r.code === 718) return { ok: false, motivo: 'ocupado', detalle: T.yaUsado(port), router: u.name }
      return { ok: false, motivo: 'rechazado', detalle: T.noDejo(`${r.code ?? ''} ${r.text}`.replace(/^ /, '')), router: u.name }
    }
    const after = await entry()
    const confirmado = !!after && after.NewInternalClient === me && Number(after.NewInternalPort) === port
    // si ya estaba abierto para esta compu y para siempre (lo abrió otro programa o la persona), al terminar se deja como estaba
    const keep = !!before && before.NewInternalClient === me && Number(before.NewLeaseDuration) === 0 && usedLease !== 0
    return {
      ok: true,
      mapeo: { via: 'upnp', port, router: u.name, externalIp: u.externalIp, dobleNat: !!u.externalIp && isPrivateIp(u.externalIp), confirmado, lease: usedLease },
      renovar: async () => (await add(usedLease)).ok,
      cerrar: async () => { if (!keep) await soap(red, u, 'DeletePortMapping', { NewRemoteHost: '', NewExternalPort: port, NewProtocol: 'TCP' }) },
    }
  }

  const gw = red.defaultGateway()
  if (gw) {
    const ask = async (msg: Buffer) => {
      for (const ms of [250, 500, 1000]) { const r = await red.udp(gw, 5351, msg, ms); if (r) return parseNatpmp(r) }
      return null
    }
    const ext = await ask(Buffer.from([0, 0]))
    if (ext && ext.result === 0) {
      const map = (l: number) => ask(natpmpMapRequest(port, port, l))
      const r = await map(lease)
      if (!r || r.result !== 0) return { ok: false, motivo: 'rechazado', detalle: T.noDejo(T.natpmp(String(r?.result ?? T.sinRespuesta))), router: null }
      if (r.externalPort !== port) {
        await map(0)
        return { ok: false, motivo: 'ocupado', detalle: T.otroPuerto(r.externalPort, port), router: null }
      }
      return {
        ok: true,
        mapeo: { via: 'natpmp', port, router: null, externalIp: ext.externalIp ?? null, dobleNat: !!ext.externalIp && isPrivateIp(ext.externalIp), confirmado: true, lease: r.lifetime ?? lease },
        renovar: async () => (await map(lease))?.result === 0,
        cerrar: async () => { await map(0) },
      }
    }
  }
  return { ok: false, motivo: 'sinRouter', detalle: T.noContesto, router: null }
}

/** La puerta de enlace (el router) y la IP de esta compu en la red de la casa: lo que hace falta para abrirlo a mano. */
export async function datosDeRed(red: Red = redReal): Promise<{ gateway: string | null; ipLocal: string | null }> {
  const gateway = red.defaultGateway()
  return { gateway, ipLocal: gateway ? await red.localIpFor(gateway) : null }
}

/** El servidor de Soulseek: si no se llega ahí, no anda nada (es lo que usa `hayConexion`). */
export const SERVIDOR_SOULSEEK = { host: 'server.slsknet.org', port: 2242 }

/** ¿Hay conexión? Prueba abrir una al servidor de Soulseek (no le manda nada). Con el router trabado, no se puede. */
export const hayConexion = (red: Red = redReal, ms = 4000) => red.tcp(SERVIDOR_SOULSEEK.host, SERVIDOR_SOULSEEK.port, ms)

/** Pregunta a Soulseek si desde internet se llega a `port` de esta compu. Tiene que haber algo escuchando (sockseek abierto). */
export async function probarDesdeAfuera(port: number, red: Red = redReal): Promise<'abierto' | 'cerrado' | null> {
  try {
    const r = await red.http(`https://www.slsknet.org/porttest.php?port=${port}`)
    return parsePortTest(r.text, port)
  } catch { return null }
}
