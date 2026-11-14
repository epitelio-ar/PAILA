// La conexión con los demás usuarios de Soulseek, en palabras simples. Lo normal es no ver nada: NAPIA le pide al router
// que abra el puerto sola mientras sockseek baja (UPnP o NAT-PMP) y lo cierra al terminar, y con el puerto cerrado igual se
// baja. Este cuadro aparece abierto solo si una bajada no pudo conectarse con nadie (de verdad no hubo forma), con cómo
// arreglarlo; y, para quien quiera mirar, dentro de "Ver el detalle". Los términos técnicos van solo en la guía, con su ⓘ.
// El permiso de Windows (el firewall) va con su propio cuadro (Firewall.tsx): acá aparece como un paso más de la guía.
import { useState, type ReactNode } from 'react'
import { Aviso, Boton, Caja, Info, Pildora } from '@paila/diseno'
import type { FirewallDiag, PuertoInfo } from '@paila/shared/napia'
import { firewallMal as malFirewall } from '@paila/shared/firewall'
import Firewall from './Firewall'
import { textos } from '@paila/shared/idioma'
import { TIP } from './textos'

const T = textos({
  mirando: { es: 'Mirando la conexión…', en: 'Checking the connection…' },
  teMandan: { es: 'Te pueden mandar los temas', en: 'People can send you tracks' },
  arreglaSola: { es: 'NAPIA lo arregla sola con tu router mientras bajás.', en: 'NAPIA sorts it out with your router on its own while you download.' },
  noDeja: { es: 'Tu internet no deja que otros te manden los temas', en: "Your internet doesn't let others send you tracks" },
  llamasVos: { es: 'Bajás llamando vos a los demás', en: "You download by calling the others yourself" },
  andaIgual: { es: 'Anda igual. ', en: 'It works anyway. ' },
  cabecera: { es: 'Conexión con los demás', en: 'Connection with others' },
  ocultar: { es: 'Ocultar', en: 'Hide' },
  comoMejorar: { es: 'Cómo mejorarlo (opcional)', en: 'How to improve it (optional)' },
  probar: { es: 'Probar de nuevo', en: 'Try again' },
  urgente: {
    es: 'sockseek encontró los temas, pero ninguno de los que los tienen pudo mandártelos. NAPIA le pidió a tu router que los deje pasar y el router no contestó. Se arregla una sola vez, así:',
    en: "sockseek found the tracks, but none of the people who have them could send them to you. NAPIA asked your router to let them through and the router didn't answer. You fix it just once, like this:",
  },
  noHaceFalta: {
    es: 'No hace falta: igual se baja. Si lo arreglás, también te pueden llamar ellos y se baja de más gente.',
    en: "You don't have to: it downloads anyway. If you fix it, they can also call you and you download from more people.",
  },
  dobleNat1: {
    es: 'Entre tu compu e internet hay otro aparato (otro router, o el de tu empresa de internet). Si tenés dos routers, hacé los pasos en los dos. Si no, pedile a tu proveedor una ',
    en: "There's another device between your computer and the internet (another router, or your internet provider's). If you have two routers, do the steps on both. If not, ask your provider for a ",
  },
  ipPublica: { es: 'IP pública', en: 'public IP' },
  paso1a: { es: 'Abrí la página de tu router', en: 'Open your router\'s page' },
  paso1b: { es: '. El usuario y la contraseña suelen estar en una etiqueta abajo del aparato.', en: '. The username and password are usually on a label under the device.' },
  paso2a: { es: 'Lo más fácil: buscá la opción ', en: 'The easiest: look for the ' },
  paso2b: { es: ' (suele estar en Avanzado, Aplicaciones o NAT) y prendela. Con eso NAPIA se arregla sola de ahí en adelante. Después tocá ', en: ' option (it is usually under Advanced, Applications or NAT) and turn it on. With that NAPIA sorts itself out from then on. Then click ' },
  paso2c: { es: 'Probar de nuevo', en: 'Try again' },
  paso3a: { es: 'Si no tiene UPnP: buscá ', en: "If it doesn't have UPnP: look for " },
  paso3b: { es: 'Asignación de puertos', en: 'Port assignment' },
  paso3c: { es: ', "Port forwarding", "Redirección de puertos" o "Servidor virtual" y agregá una regla: protocolo ', en: ', "Port forwarding", "Port redirection" or "Virtual server" and add a rule: protocol ' },
  paso3d: { es: ', puerto', en: ', port' },
  paso3e: { es: ' (afuera y adentro), hacia ', en: ' (outside and inside), to ' },
  estaCompu: { es: 'esta compu', en: 'this computer' },
  paso4: {
    es: (ip: string | null) => `Para que no deje de andar, reservá esa dirección${ip ? ` (${ip})` : ''} para esta compu: "Reserva DHCP" o "IP fija", en el mismo router.`,
    en: (ip: string | null) => `So it doesn't stop working, reserve that address${ip ? ` (${ip})` : ''} for this computer: "DHCP reservation" or "static IP", in the same router.`,
  },
  routerDice: {
    es: 'Tu router dice que deja pasar, pero desde internet no se llega. Puede haber otro aparato delante, o un antivirus que lo frena.',
    en: 'Your router says it lets traffic through, but it can\'t be reached from the internet. There may be another device in front, or an antivirus blocking it.',
  },
  m1: { es: 'Tu router dice que deja pasar, pero desde internet no se llega.', en: "Your router says it lets traffic through, but it can't be reached from the internet." },
  m2: { es: 'Si lo arreglás, también te pueden llamar ellos.', en: 'If you fix it, they can also call you.' },
  m3: { es: 'Hay otro aparato entre tu router e internet.', en: "There's another device between your router and the internet." },
  m4: { es: 'Falta un permiso de Windows para sockseek.', en: 'sockseek is missing a Windows permission.' },
  m5: { es: 'Tu router no deja que NAPIA lo arregle sola.', en: "Your router won't let NAPIA sort it out on its own." },
})

interface Props {
  puerto: PuertoInfo | null
  /** Volver a pedirle al router que lo abra (no mientras sockseek baja). */
  onProbar?: () => void
  /** Una bajada no pudo conectarse con nadie: la guía se muestra abierta. */
  urgente?: boolean
  /** Cambió el firewall (después de Arreglarlo). */
  onFirewall?: (f: FirewallDiag | null) => void
}

export default function Puerto({ puerto: p, onProbar, urgente, onFirewall }: Props) {
  const [guia, setGuia] = useState(false)
  if (!p) return null
  const r = p.router
  const okRouter = !!r && r.ok && !r.dobleNat
  const cerradoAfuera = p.afuera === 'cerrado'
  // el firewall frena aunque el router deje entrar; con el router cerrado es un paso más (nadie llega hasta la compu igual)
  const firewallMal = malFirewall(p.firewall)
  // abierto a mano (sin UPnP) también vale: lo confirma la prueba de Soulseek desde afuera
  const bien = p.afuera === 'abierto' || (okRouter && !cerradoAfuera && !firewallMal)
  const abierta = urgente || guia

  let estado: ReactNode
  if (p.probando) estado = <span className="muted">{T.mirando}</span>
  else if (bien) estado = <><Pildora tone="ok">{T.teMandan}</Pildora><span className="muted small">{T.arreglaSola}</span></>
  else if (urgente) estado = <><Pildora tone="atencion">{T.noDeja}</Pildora></>
  else estado = <><Pildora tone="neutro">{T.llamasVos}</Pildora><span className="muted small">{T.andaIgual}{motivo(p)}</span></>

  return (
    <Caja pad className="puerto" head={<b>{T.cabecera}<Info tip={TIP.puerto} /></b>}>
      <div className="row">
        {estado}
        <div className="push-right row">
          {!bien && !p.probando && !urgente && <button className="link" onClick={() => setGuia(!guia)}>{guia ? T.ocultar : T.comoMejorar}</button>}
          {onProbar && !p.probando && <Boton variant="ghost" size="sm" onClick={onProbar}>{T.probar}</Boton>}
        </div>
      </div>

      {!bien && !p.probando && abierta && (
        <div className="guia">
          {urgente
            ? <p className="small">{T.urgente}</p>
            : <p className="muted small">{T.noHaceFalta}</p>}
          {r?.ok && r.dobleNat
            ? <Aviso tone="atencion">{T.dobleNat1}<b>{T.ipPublica}</b><Info tip={TIP.ipPublica} />.</Aviso>
            : !okRouter && (
              <ol className="pasos-cortos">
                <li>{T.paso1a}{p.gateway && <>: <button className="link" onClick={() => window.napia.openRouter()}>{p.gateway}</button></>}{T.paso1b}</li>
                <li>{T.paso2a}<b>UPnP</b><Info tip={TIP.upnp} />{T.paso2b}<b>{T.paso2c}</b>.{/* idioma-ok */}</li>
                <li>{T.paso3a}<b>{T.paso3b}</b>{T.paso3c}<b>TCP</b>{T.paso3d}<Info tip={TIP.numeroPuerto} /> <b>{p.port}</b>{T.paso3e}<b>{p.ipLocal ?? T.estaCompu}</b>.{/* idioma-ok */}</li>
                <li>{T.paso4(p.ipLocal ?? null)}</li>
              </ol>
            )}
          {okRouter && cerradoAfuera && !firewallMal && <Aviso tone="atencion">{T.routerDice}</Aviso>}
          {firewallMal && <Firewall firewall={p.firewall!} onCambio={(f) => onFirewall?.(f)} suelto />}
        </div>
      )}
    </Caja>
  )
}

function motivo(p: PuertoInfo): string {
  const r = p.router
  if (p.afuera === 'cerrado') return r?.ok ? T.m1 : T.m2
  if (!r) return ''
  if (r.ok && r.dobleNat) return T.m3
  if (r.ok && malFirewall(p.firewall)) return T.m4
  if (r.ok) return ''
  return T.m5
}
