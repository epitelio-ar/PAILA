// NAPIA: el firewall de Windows cruzado con el tipo de red (core/sockseek/firewall.ts y firewall-sistema.ts). Las muestras de
// netsh son inventadas, en castellano como sale de verdad (página de códigos 850 leída como latin1: "P£blica", "S¡",
// "Acci¢n"), en castellano bien escrito y en inglés. El arreglo se prueba con el sistema inventado: nunca toca el firewall.
import { afterEach, describe, expect, it } from 'vitest'
import { argumentosElevado, comandoAMano, diagnosticar, parseEstado, parseReglas, perfilesDe, scriptArreglo, type EstadoRed } from '@paila/core/sockseek/firewall'
import { arreglarFirewall, leerFirewall, sistemaFalso } from '@paila/core/sockseek/firewall-sistema'
import { firewallMal, textoFirewall, textoResultado } from '@paila/shared/firewall'
import { ponerIdioma } from '@paila/shared/idioma'

const EXE = 'C:\\Users\\Ana María\\AppData\\Roaming\\NAPIA\\sockseek\\sockseek.exe'
const OTRO = 'C:\\Program Files\\SoulseekQt\\SoulseekQt.exe'

/** Una regla como la muestra netsh en un Windows en castellano (página 850 leída como latin1). */
const es850 = (prog: string, perfiles: string, accion: 'Permitir' | 'Bloquear', o: { habilitada?: string; protocolo?: string } = {}) => [
  'Nombre de regla:                      sockseek.exe', '-'.repeat(70), 'Descripci¢n:                          ', `Habilitada:                           ${o.habilitada ?? 'S¡'}`,
  'Direcci¢n:                            Dentro', `Perfiles:                             ${perfiles}`, 'Agrupamiento:                         ', 'LocalIP:                              Cualquiera',
  `Protocolo:                            ${o.protocolo ?? 'TCP'}`, 'LocalPort:                            Cualquiera', `Programa:                             ${prog}`,
  'InterfaceTypes:                       Cualquiera', 'Origen de la regla:                   Configuraci¢n local', `Acci¢n:                               ${accion}`,
].join('\r\n')
const en = (prog: string, profiles: string, action: 'Allow' | 'Block', enabled = 'Yes', protocol = 'Any') => [
  'Rule Name:                            sockseek', '-'.repeat(70), `Enabled:                              ${enabled}`, 'Direction:                            In',
  `Profiles:                             ${profiles}`, `Protocol:                             ${protocol}`, `Program:                              ${prog}`, 'Edge traversal:                       No', `Action:                               ${action}`,
].join('\r\n')
const junto = (...b: string[]) => ['', ...b, 'Aceptar.', ''].join('\r\n\r\n')
const red = (perfil: EstadoRed['redes'][0]['perfil'], internet = true, nombre: string | null = 'Casa'): EstadoRed => ({ redes: [{ perfil, nombre, internet }], firewall: [] })
const diag = (texto: string, estado: EstadoRed | null) => diagnosticar(parseReglas(texto, EXE), estado, EXE)

afterEach(() => ponerIdioma('es'))

describe('leer las reglas y los tipos de red', () => {
  it('los perfiles en castellano (850 y bien escrito), inglés y otros idiomas', () => {
    expect(perfilesDe('P£blica')).toEqual(['publica'])
    expect(perfilesDe('Dominio,Privada,P£blica')).toEqual(['dominio', 'privada', 'publica'])
    expect(perfilesDe('Privada,Pública')).toEqual(['privada', 'publica'])
    expect(perfilesDe('Domain,Private')).toEqual(['dominio', 'privada'])
    expect(perfilesDe('Any')).toEqual(['dominio', 'privada', 'publica'])
    expect(perfilesDe('Cualquiera')).toEqual(['dominio', 'privada', 'publica'])
    expect(perfilesDe('Öffentlich')).toEqual(['publica'])
    expect(perfilesDe('Privé,Public')).toEqual(['privada', 'publica'])
    expect(perfilesDe('???')).toBeNull()
  })
  it('solo las reglas de ese programa, con habilitada, acción, perfiles y protocolo', () => {
    const r = parseReglas(junto(es850(OTRO, 'Privada', 'Permitir'), es850(EXE, 'P£blica', 'Bloquear', { protocolo: 'UDP' }), es850(EXE.toLowerCase(), 'Privada', 'Permitir', { habilitada: 'No' })), EXE)
    expect(r).toEqual([
      { habilitada: true, accion: 'bloquear', perfiles: ['publica'], tcp: false },
      { habilitada: false, accion: 'permitir', perfiles: ['privada'], tcp: true },
    ])
    expect(parseReglas('', EXE)).toBeNull()
    expect(parseReglas(junto(es850(OTRO, 'Privada', 'Permitir')), EXE)).toEqual([])
  })
  it('una ruta con variables (%USERPROFILE%) es el mismo programa; una descripción que termina en "Block" no confunde', () => {
    const conVar = en('%USERPROFILE%\\AppData\\Roaming\\NAPIA\\sockseek\\sockseek.exe', 'Private', 'Allow').replace('Enabled:', 'Description:                          Allow or Block\r\nEnabled:')
    expect(parseReglas(junto(conVar), EXE, { USERPROFILE: 'C:\\Users\\Ana María' })).toEqual([{ habilitada: true, accion: 'permitir', perfiles: ['privada'], tcp: true }])
  })
  it('el tipo de red y el firewall de cada perfil, con nombres o números, en lista o suelto', () => {
    expect(parseEstado('{"redes":{"nombre":"Casa","categoria":"Private","v4":"Internet","v6":"NoTraffic"},"firewall":[{"perfil":"Private","prendido":"True","reglas":"NotConfigured"},{"perfil":"Public","prendido":"False","reglas":"True"}]}')).toEqual({
      redes: [{ perfil: 'privada', nombre: 'Casa', internet: true }],
      firewall: [{ perfil: 'privada', prendido: true, dejaReglas: true }, { perfil: 'publica', prendido: false, dejaReglas: true }],
    })
    expect(parseEstado('{"redes":[{"nombre":"","categoria":0,"v4":4},{"nombre":"VirtualBox","categoria":0,"v4":1}],"firewall":[]}')?.redes).toEqual([
      { perfil: 'publica', nombre: null, internet: true }, { perfil: 'publica', nombre: 'VirtualBox', internet: false },
    ])
    expect(parseEstado('no es json')).toBeNull()
    expect(parseEstado(null)).toBeNull()
  })
})

describe('cruzar las reglas con la red de ahora', () => {
  it('nunca se contestó el cartel: sin regla', () => {
    const d = diag(junto(es850(OTRO, 'Privada', 'Permitir')), red('privada'))!
    expect(d.caso).toBe('sinRegla')
    expect(d.arreglo).toEqual({ perfiles: ['privada'], sacarBloqueos: false, permitir: ['privada'] })
    expect(d.aMano).toBe(`netsh advfirewall firewall add rule name="sockseek (NAPIA)" dir=in action=allow program="${EXE}" enable=yes profile=private`)
  })
  it('se le dijo que no (Cancelar): la regla que bloquea gana aunque otra permita', () => {
    const d = diag(junto(es850(EXE, 'Dominio,Privada,P£blica', 'Bloquear'), es850(EXE, 'Dominio,Privada,P£blica', 'Bloquear', { protocolo: 'UDP' }), en(EXE, 'Private', 'Allow')), red('privada'))!
    expect(d.caso).toBe('bloqueado')
    expect(d.arreglo).toEqual({ perfiles: ['privada'], sacarBloqueos: true, permitir: [] })
    expect(d.aMano?.split('\n')[0]).toBe(`netsh advfirewall firewall delete rule name=all dir=in program="${EXE}"`)
  })
  it('permitió solo en Públicas y su wifi es Privada (Windows bloquea el tipo que no se marcó)', () => {
    const d = diag(junto(es850(EXE, 'P£blica', 'Permitir'), es850(EXE, 'Privada', 'Bloquear')), red('privada'))!
    expect(d).toMatchObject({ caso: 'otroPerfil', activos: ['privada'], permitidos: ['publica'], bloqueados: ['privada'] })
    expect(d.arreglo).toEqual({ perfiles: ['privada'], sacarBloqueos: true, permitir: ['privada'] })
    const t = textoFirewall(d)
    expect(t.titulo).toBe('sockseek tiene permiso solo en redes Públicas, y la tuya es Privada')
    expect(t.arreglar).toBe('Arreglarlo')
    expect(t.redPublica).toBeNull()
  })
  it('al revés: permiso solo en Privadas y la red está marcada como Pública (marcarla como Privada ya alcanza)', () => {
    const d = diag(junto(es850(EXE, 'Privada', 'Permitir'), es850(EXE, 'P£blica', 'Bloquear')), red('publica'))!
    expect(d.caso).toBe('otroPerfil')
    expect(d.arreglo).toEqual({ perfiles: ['privada', 'publica'], sacarBloqueos: true, permitir: ['publica'] })
    const t = textoFirewall(d)
    expect(t.titulo).toBe('sockseek tiene permiso solo en redes Privadas, y la tuya es Pública')
    expect(t.redPublica).toContain('**Privada**')
    expect(t.abrir?.que).toBe('red')
    expect(t.arreglar).toBe('Darle permiso también en redes Públicas')
    expect(t.queHace).toBe('Saca ese «no» y le da permiso a sockseek en redes Públicas. Windows te pide permiso una vez.')
  })
  it('todo bien: permiso en la red de ahora (el bloqueo en el otro tipo de red no importa)', () => {
    const d = diag(junto(es850(EXE, 'Privada', 'Permitir'), es850(EXE, 'P£blica', 'Bloquear')), red('privada'))!
    expect(d.caso).toBe('bien')
    expect(d.arreglo).toBeNull()
    expect(firewallMal(d)).toBe(false)
    expect(textoFirewall(d).titulo).toBe('Windows deja que te manden los temas')
  })
  it('un adaptador virtual sin internet (Público) no cuenta: vale el wifi', () => {
    const estado: EstadoRed = { redes: [{ perfil: 'publica', nombre: 'VirtualBox Host-Only', internet: false }, { perfil: 'privada', nombre: 'Casa', internet: true }], firewall: [] }
    const d = diag(junto(en(EXE, 'Private', 'Allow')), estado)!
    expect(d).toMatchObject({ caso: 'bien', activos: ['privada'], red: 'Casa' })
  })
  it('el firewall apagado en esa red, o "bloquear todas las conexiones entrantes" prendido', () => {
    const apagado: EstadoRed = { ...red('privada'), firewall: [{ perfil: 'privada', prendido: false, dejaReglas: true }] }
    expect(diag(junto(en(OTRO, 'Private', 'Allow')), apagado)?.caso).toBe('apagado')
    const todo: EstadoRed = { ...red('privada'), firewall: [{ perfil: 'privada', prendido: true, dejaReglas: false }] }
    const d = diag(junto(en(EXE, 'Private', 'Allow')), todo)!
    expect(d.caso).toBe('todoBloqueado')
    expect(d.arreglo).toBeNull()
    expect(textoFirewall(d).abrir?.que).toBe('firewall')
  })
  it('sin saber el tipo de red: alcanza con un permiso; si no hay, el arreglo es para Privadas y de Dominio', () => {
    expect(diag(junto(en(EXE, 'Public', 'Allow')), null)?.caso).toBe('bien')
    const d = diag(junto(en(EXE, 'Domain,Private,Public', 'Block')), null)!
    expect(d.caso).toBe('bloqueado')
    expect(d.arreglo?.perfiles).toEqual(['dominio', 'privada'])
    expect(diag('', null)).toBeNull()
  })
  it('también entiende el castellano bien escrito y el inglés con "Any"', () => {
    const bien = ['Nombre de regla: sockseek', 'Habilitada: Sí', 'Perfiles: Privada,Pública', 'Protocolo: TCP', `Programa: ${EXE}`, 'Acción: Permitir'].join('\n')
    expect(diag(junto(bien), red('publica'))?.caso).toBe('bien')
    expect(diag(junto(en(EXE, 'Domain,Private,Public', 'Allow', 'No')), red('publica'))?.caso).toBe('sinRegla')
  })
  it('en inglés, los mismos casos con sus palabras', () => {
    ponerIdioma('en')
    const d = diag(junto(en(EXE, 'Private', 'Allow'), en(EXE, 'Public', 'Block')), red('publica'))!
    const t = textoFirewall(d)
    expect(t.titulo).toBe('sockseek only has permission on Private networks, and yours is Public')
    expect(t.arreglar).toBe('Allow it on Public networks too')
    expect(textoResultado('cancelado')).toBe('Nothing changed: Windows asked for permission and the answer was no.')
  })
})

describe('el arreglo (con el permiso de Windows)', () => {
  it('el script saca solo los bloqueos de ese programa en esos tipos de red y suma el permiso que falta', () => {
    const s = scriptArreglo("C:\\Users\\O'Neil\\sockseek.exe", { perfiles: ['privada', 'publica'], sacarBloqueos: true, permitir: ['publica'] })
    expect(s).toContain("$exe = 'C:\\Users\\O''Neil\\sockseek.exe'")
    expect(s).toContain('Get-NetFirewallRule -Direction Inbound -Action Block')
    expect(s).toContain('-band 6')
    expect(s).toContain("New-NetFirewallRule -DisplayName 'sockseek (NAPIA)' -Direction Inbound -Action Allow -Program $exe -Profile Public -Enabled True")
    const solo = scriptArreglo(EXE, { perfiles: ['privada'], sacarBloqueos: false, permitir: ['privada'] })
    expect(solo).not.toContain('Remove-NetFirewallRule')
    expect(comandoAMano(EXE, { perfiles: ['privada'], sacarBloqueos: true, permitir: [] }, ['publica'])).toContain('profile=private,public')
  })
  it('corre con -Verb RunAs, oculto, y todo cifrado (las rutas con acentos y espacios no se rompen)', () => {
    const args = argumentosElevado('Write-Output "Ana María"')
    expect(args.slice(0, 5)).toEqual(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand'])
    const afuera = Buffer.from(args[5], 'base64').toString('utf16le')
    expect(afuera).toContain("Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -Wait -PassThru")
    expect(afuera).toContain('exit 1223')
    const adentro = afuera.match(/'-EncodedCommand','([^']+)'/)![1]
    expect(Buffer.from(adentro, 'base64').toString('utf16le')).toBe('Write-Output "Ana María"')
  })
  it('"Arreglarlo" con el sistema inventado: listo, se dijo que no, o falló', async () => {
    const reglas = [{ perfiles: 'Privada', accion: 'Permitir' as const }, { perfiles: 'P£blica', accion: 'Bloquear' as const }]
    const redes = [{ nombre: 'Casa', categoria: 'Public', v4: 'Internet' }]
    const ok = sistemaFalso({ reglas, redes })
    expect((await leerFirewall(EXE, ok))?.caso).toBe('otroPerfil')
    const r = await arreglarFirewall(EXE, ok)
    expect(r.resultado).toBe('listo')
    expect(r.firewall?.caso).toBe('bien')
    expect(ok.ultimoScript).toContain('Remove-NetFirewallRule')
    expect((await arreglarFirewall(EXE, ok)).resultado).toBe('nada')

    const no = sistemaFalso({ reglas, redes, arreglo: 'cancelado' })
    expect(await arreglarFirewall(EXE, no)).toMatchObject({ resultado: 'cancelado', firewall: { caso: 'otroPerfil' } })
    const mal = sistemaFalso({ reglas: [], redes, arreglo: 'error' })
    const e = await arreglarFirewall(EXE, mal)
    expect(e.resultado).toBe('error')
    expect(e.firewall?.aMano).toContain('profile=private,public')
  })
  it('sin poder leer nada (otro sistema): no hay diagnóstico ni arreglo', async () => {
    expect(await leerFirewall(EXE, null)).toBeNull()
    expect((await arreglarFirewall(EXE, null)).resultado).toBe('nada')
  })
})
