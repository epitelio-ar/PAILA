// NAPIA y el router: abrir el puerto de sockseek con UPnP (un router de mentira que habla SOAP) o NAT-PMP, confirmarlo,
// renovarlo y cerrarlo; los casos raros (solo permanentes, otra compu con el mismo puerto, router sin UPnP, doble NAT) y la
// prueba de puerto de Soulseek. Sin red de verdad: todo pasa por un `Red` falso.
import { describe, expect, it } from 'vitest'
import {
  abrirPuerto, datosDeRed, hayConexion, isPrivateIp, natpmpMapRequest, parseDefaultGateway, parseDescription, parseNatpmp, parsePortTest,
  parseSoap, probarDesdeAfuera, soapEnvelope, ssdpLocation, type Red,
} from '@paila/core/sockseek/router'

const DESC = `<?xml version="1.0"?><root xmlns="urn:schemas-upnp-org:device-1-0"><device><friendlyName>Router de la casa</friendlyName>
<deviceList><device><deviceList><device><serviceList>
<service><serviceType>urn:schemas-upnp-org:service:WANPPPConnection:1</serviceType><controlURL>/ctl/PPP</controlURL></service>
<service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType><controlURL>/ctl/IP</controlURL></service>
</serviceList></device></deviceList></device></deviceList></device></root>`

interface Entry { client: string; port: number; lease: number; desc: string }

/** Un router con UPnP: guarda los mapeos y contesta como uno de verdad (errores SOAP con código). */
function routerFalso(o: { externalIp?: string; soloPermanentes?: boolean; mapeos?: Map<number, Entry>; sinUpnp?: boolean; natpmp?: boolean; trabado?: boolean } = {}) {
  const mapeos = o.mapeos ?? new Map<number, Entry>()
  const llamadas: string[] = []
  const fault = (code: number, text: string) => ({ ok: false, text: `<s:Envelope><s:Body><s:Fault><detail><UPnPError><errorCode>${code}</errorCode><errorDescription>${text}</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>` })
  const ok = (action: string, vals: Record<string, string | number> = {}) => ({ ok: true, text: `<s:Envelope><s:Body><u:${action}Response>${Object.entries(vals).map(([k, v]) => `<${k}>${v}</${k}>`).join('')}</u:${action}Response></s:Body></s:Envelope>` })
  const val = (body: string, k: string) => body.match(new RegExp(`<${k}>([^<]*)</${k}>`))?.[1] ?? ''
  const red: Red = {
    async ssdp() { return o.sinUpnp ? [{ text: 'HTTP/1.1 200 OK\r\nST: upnp:rootdevice\r\nLOCATION: http://192.168.18.4:1448/\r\n\r\n', from: '192.168.18.4' }] : [{ text: 'HTTP/1.1 200 OK\r\nST: urn:schemas-upnp-org:device:InternetGatewayDevice:1\r\nLocation: http://192.168.18.1:37215/desc.xml\r\n\r\n', from: '192.168.18.1' }] },
    async http(url, init) {
      if (url === 'http://192.168.18.4:1448/') return { ok: true, text: '<root><device><friendlyName>Tele</friendlyName></device></root>' }
      if (url === 'http://192.168.18.1:37215/desc.xml') return { ok: true, text: DESC }
      if (url.startsWith('https://www.slsknet.org/porttest.php')) return { ok: true, text: '<font face="fixedsys">IP: 200.61.165.58 Port: 2416/tcp OPEN.' }
      const action = init?.headers?.SOAPAction?.match(/#(\w+)"/)?.[1] ?? ''
      llamadas.push(`${url.endsWith('PPP') ? 'PPP' : 'IP'}:${action}`)
      if (url.endsWith('PPP')) return fault(401, 'Invalid Action')
      const body = init?.body ?? ''
      const port = Number(val(body, 'NewExternalPort'))
      switch (action) {
        case 'GetExternalIPAddress': return ok(action, { NewExternalIPAddress: o.externalIp ?? '200.61.165.58' })
        case 'GetSpecificPortMappingEntry': {
          const e = mapeos.get(port)
          return e ? ok(action, { NewInternalPort: e.port, NewInternalClient: e.client, NewEnabled: 1, NewPortMappingDescription: e.desc, NewLeaseDuration: e.lease }) : fault(714, 'NoSuchEntryInArray')
        }
        case 'AddPortMapping': {
          const lease = Number(val(body, 'NewLeaseDuration'))
          if (o.soloPermanentes && lease !== 0) return fault(725, 'OnlyPermanentLeasesSupported')
          const e = mapeos.get(port), client = val(body, 'NewInternalClient')
          if (e && e.client !== client) return fault(718, 'ConflictInMappingEntry')
          mapeos.set(port, { client, port: Number(val(body, 'NewInternalPort')), lease, desc: val(body, 'NewPortMappingDescription') })
          return ok(action)
        }
        case 'DeletePortMapping': mapeos.delete(port); return ok(action)
        default: return fault(401, 'Invalid Action')
      }
    },
    async udp(host, port, msg) {
      if (!o.natpmp || host !== '192.168.18.1' || port !== 5351) return null
      if (msg.length === 2) return Buffer.from([0, 128, 0, 0, 0, 0, 0, 1, 200, 61, 165, 58])
      const r = Buffer.alloc(16)
      r[0] = 0; r[1] = 130; r.writeUInt16BE(0, 2); r.writeUInt16BE(msg.readUInt16BE(4), 8); r.writeUInt16BE(msg.readUInt16BE(6), 10); r.writeUInt32BE(msg.readUInt32BE(8), 12)
      llamadas.push(`NATPMP:${msg.readUInt32BE(8)}`)
      return r
    },
    async localIpFor() { return '192.168.18.6' },
    defaultGateway() { return '192.168.18.1' },
    async tcp(host, port) { llamadas.push(`TCP:${host}:${port}`); return !o.trabado },
  }
  return { red, mapeos, llamadas }
}

describe('UPnP: abrir, confirmar, renovar y cerrar', () => {
  it('abre el puerto hacia esta compu (salteando el servicio PPP que no anda), lo confirma y lo cierra', async () => {
    const { red, mapeos, llamadas } = routerFalso()
    const a = await abrirPuerto(2416, { red })
    expect(a.ok && a.mapeo).toEqual({ via: 'upnp', port: 2416, router: 'Router de la casa', externalIp: '200.61.165.58', dobleNat: false, confirmado: true, lease: 3600 })
    expect(mapeos.get(2416)).toEqual({ client: '192.168.18.6', port: 2416, lease: 3600, desc: 'NAPIA (sockseek)' })
    if (!a.ok) throw new Error('no abrió')
    expect(await a.renovar()).toBe(true)
    await a.cerrar()
    expect(mapeos.has(2416)).toBe(false)
    expect(llamadas.filter((l) => l.startsWith('PPP'))).toEqual([]) // el IP va primero aunque esté segundo
  })

  it('router que solo acepta mapeos permanentes (725): lo abre sin vencimiento y lo borra al terminar', async () => {
    const { red, mapeos } = routerFalso({ soloPermanentes: true })
    const a = await abrirPuerto(2416, { red })
    expect(a.ok && a.mapeo.lease).toBe(0)
    if (a.ok) await a.cerrar()
    expect(mapeos.size).toBe(0)
  })

  it('el puerto ya va a otra compu de la casa: no lo pisa y lo dice', async () => {
    const { red, mapeos } = routerFalso({ mapeos: new Map([[2416, { client: '192.168.18.9', port: 2416, lease: 0, desc: 'otra' }]]) })
    const a = await abrirPuerto(2416, { red })
    expect(a).toMatchObject({ ok: false, motivo: 'ocupado' })
    expect(!a.ok && a.detalle).toMatch(/192\.168\.18\.9/)
    expect(mapeos.get(2416)?.client).toBe('192.168.18.9')
  })

  it('ya estaba abierto para siempre hacia esta compu (lo abrió la persona): al terminar se deja como estaba', async () => {
    const { red, mapeos } = routerFalso({ mapeos: new Map([[2416, { client: '192.168.18.6', port: 2416, lease: 0, desc: 'a mano' }]]) })
    const a = await abrirPuerto(2416, { red })
    if (!a.ok) throw new Error('no abrió')
    await a.cerrar()
    expect(mapeos.has(2416)).toBe(true)
  })

  it('doble NAT: el router dice una IP de afuera privada (hay otro router o la empresa delante)', async () => {
    const { red } = routerFalso({ externalIp: '100.72.10.5' })
    const a = await abrirPuerto(2416, { red })
    expect(a.ok && a.mapeo.dobleNat).toBe(true)
    expect(['10.0.0.1', '172.20.1.1', '192.168.0.1', '100.64.0.1', '200.61.165.58'].map(isPrivateIp)).toEqual([true, true, true, true, false])
  })
})

describe('sin UPnP', () => {
  it('con NAT-PMP: pide el mapeo a la puerta de enlace y lo borra con vida 0', async () => {
    const { red, llamadas } = routerFalso({ sinUpnp: true, natpmp: true })
    const a = await abrirPuerto(2416, { red, lease: 600 })
    expect(a.ok && a.mapeo).toMatchObject({ via: 'natpmp', port: 2416, externalIp: '200.61.165.58', confirmado: true, lease: 600 })
    if (a.ok) await a.cerrar()
    expect(llamadas).toEqual(['NATPMP:600', 'NATPMP:0'])
  })
  it('como un router real el 21/10 (solo contestan la tele y el Roku): "sinRouter", con la puerta de enlace para abrirlo a mano', async () => {
    const { red } = routerFalso({ sinUpnp: true })
    expect(await abrirPuerto(2416, { red })).toMatchObject({ ok: false, motivo: 'sinRouter' })
    expect(await datosDeRed(red)).toEqual({ gateway: '192.168.18.1', ipLocal: '192.168.18.6' })
  })
})

describe('el router trabado', () => {
  it('hayConexion prueba abrir una conexión al servidor de Soulseek: con el router trabado, no', async () => {
    const bien = routerFalso(), trabado = routerFalso({ trabado: true })
    expect(await hayConexion(bien.red)).toBe(true)
    expect(bien.llamadas).toEqual(['TCP:server.slsknet.org:2242'])
    expect(await hayConexion(trabado.red)).toBe(false)
  })
})

describe('piezas', () => {
  it('SSDP, la descripción del router y SOAP', () => {
    expect(ssdpLocation('HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=120\r\nLOCATION: http://192.168.1.1:5000/rootDesc.xml\r\n')).toBe('http://192.168.1.1:5000/rootDesc.xml')
    const d = parseDescription(DESC, 'http://192.168.18.1:37215/desc.xml')
    expect(d.name).toBe('Router de la casa')
    expect(d.services.map((s) => s.controlUrl)).toEqual(['http://192.168.18.1:37215/ctl/IP', 'http://192.168.18.1:37215/ctl/PPP'])
    expect(parseDescription(DESC.replace('<device>', '<URLBase>http://10.0.0.1:80/</URLBase><device>'), 'http://x/').services[0].controlUrl).toBe('http://10.0.0.1/ctl/IP')
    expect(soapEnvelope('urn:x:WANIPConnection:1', 'AddPortMapping', { NewPortMappingDescription: 'NAPIA <sockseek>' })).toContain('<NewPortMappingDescription>NAPIA &lt;sockseek&gt;</NewPortMappingDescription>')
    expect(parseSoap('<s:Envelope><s:Body><u:GetExternalIPAddressResponse><NewExternalIPAddress> 1.2.3.4 </NewExternalIPAddress></u:GetExternalIPAddressResponse></s:Body></s:Envelope>', true)).toEqual({ ok: true, values: { NewExternalIPAddress: '1.2.3.4' } })
    expect(parseSoap('<s:Fault><UPnPError><errorCode>718</errorCode><errorDescription>ConflictInMappingEntry</errorDescription></UPnPError></s:Fault>', false)).toEqual({ ok: false, code: 718, text: 'ConflictInMappingEntry' })
  })
  it('NAT-PMP: el pedido de 12 bytes y las respuestas', () => {
    expect([...natpmpMapRequest(2416, 2416, 3600)]).toEqual([0, 2, 0, 0, 9, 112, 9, 112, 0, 0, 14, 16])
    expect(parseNatpmp(Buffer.from([0, 128, 0, 0, 0, 0, 0, 1, 200, 61, 165, 58]))).toEqual({ op: 0, result: 0, externalIp: '200.61.165.58' })
    expect(parseNatpmp(Buffer.from([0, 2]))).toBeNull()
  })
  it('la puerta de enlace en Windows (la de menor métrica), Linux y Mac', () => {
    const win = 'Destino de red        Máscara de red   Puerta de enlace   Interfaz  Métrica\r\n          0.0.0.0          0.0.0.0     192.168.18.1     192.168.18.6     35\r\n          0.0.0.0          0.0.0.0      10.0.0.1         10.0.0.7     20\r\n'
    expect(parseDefaultGateway(win)).toBe('10.0.0.1')
    expect(parseDefaultGateway('default via 192.168.0.1 dev wlan0 proto dhcp metric 600')).toBe('192.168.0.1')
    expect(parseDefaultGateway('   route to: default\ndestination: default\n    gateway: 192.168.1.254\n')).toBe('192.168.1.254')
    expect(parseDefaultGateway('')).toBeNull()
  })
  it('la prueba de puerto de Soulseek (texto real del 21/10) y la falsa', async () => {
    expect(parsePortTest('<font face="fixedsys">IP: 200.61.165.58 Port: 2416/tcp CLOSED. Your router and/or Soulseek client needs to be configured correctly.', 2416)).toBe('cerrado')
    expect(parsePortTest('IP: 1.2.3.4 Port: 2416/tcp OPEN.', 2416)).toBe('abierto')
    expect(parsePortTest('IP: 1.2.3.4 Port: 2417/tcp OPEN.', 2416)).toBeNull()
    expect(await probarDesdeAfuera(2416, routerFalso().red)).toBe('abierto')
  })
})
