// El firewall de Windows y sockseek en palabras simples: qué pasa en cada caso, qué consecuencia tiene y cómo se arregla.
// Lo usan NAPIA (la conexión) y PAILA (el Chequeo): el mismo texto en los dos lados. Las frases llevan {info} y {perfil}
// donde va un ⓘ (con `Rico`), y **negrita**. El diagnóstico sale de core/sockseek/firewall.ts.
import type { FirewallDiag, PerfilRed, ResultadoArreglo } from './napia'
import { lista, textos } from './idioma'

const T = textos({
  privada: { es: 'Privada', en: 'Private' },
  publica: { es: 'Pública', en: 'Public' },
  dominio: { es: 'de Dominio', en: 'Domain' },
  privadas: { es: 'Privadas', en: 'Private' },
  publicas: { es: 'Públicas', en: 'Public' },
  dominios: { es: 'de Dominio', en: 'Domain' },
  bien: { es: 'Windows deja que te manden los temas', en: 'Windows lets people send you tracks' },
  bienTexto: {
    es: (red: string) => `sockseek tiene permiso para recibir conexiones {info} en tu red${red}.`,
    en: (red: string) => `sockseek has permission to receive connections {info} on your network${red}.`,
  },
  apagado: { es: 'El firewall de Windows está apagado en esta red', en: 'The Windows firewall is off on this network' },
  apagadoTexto: {
    es: 'No frena a sockseek {info}. Si tenés un antivirus con su propio firewall, ese sí puede frenarlo: NAPIA no lo ve.',
    en: "It doesn't block sockseek {info}. If you have an antivirus with its own firewall, that one can block it: NAPIA can't see it.",
  },
  sinRegla: { es: 'Windows todavía no le dio permiso a sockseek', en: "Windows hasn't given sockseek permission yet" },
  sinReglaTexto: {
    es: 'La primera vez que sockseek baja, Windows pregunta si lo deja recibir conexiones {info}. Ese cartel se cerró sin contestar, o nunca apareció.',
    en: 'The first time sockseek downloads, Windows asks whether to let it receive connections {info}. That message was closed without an answer, or never showed up.',
  },
  bloqueado: { es: 'Windows le negó el permiso a sockseek', en: 'Windows denied sockseek permission' },
  bloqueadoTexto: {
    es: 'Cuando Windows preguntó si dejaba a sockseek recibir conexiones {info}, se eligió que no (o se apretó Cancelar). Ese «no» gana aunque después se le haya dado permiso.',
    en: 'When Windows asked whether to let sockseek receive connections {info}, the answer was no (or Cancel was pressed). That "no" wins even if permission was given later.',
  },
  otroPerfil: {
    es: (perm: string, act: string) => `sockseek tiene permiso solo en redes ${perm}, y la tuya es ${act}`,
    en: (perm: string, act: string) => `sockseek only has permission on ${perm} networks, and yours is ${act}`,
  },
  otroPerfilTexto: {
    es: (perm: string) => `Windows separa las redes en Privadas (tu casa) y Públicas (un bar, un aeropuerto) {perfil}. Cuando preguntó si dejaba a sockseek recibir conexiones {info}, se marcó solo «${perm}».`,
    en: (perm: string) => `Windows splits networks into Private (your home) and Public (a café, an airport) {perfil}. When it asked whether to let sockseek receive connections {info}, only "${perm}" was ticked.`,
  },
  todoBloqueado: { es: 'Windows está frenando todas las conexiones que entran', en: 'Windows is blocking every incoming connection' },
  todoBloqueadoTexto: {
    es: 'En la configuración del firewall {info} está prendido «Bloquear todas las conexiones entrantes» {bloquearTodo}, que frena hasta a los programas con permiso.',
    en: 'In the firewall settings {info}, "Block all incoming connections" {bloquearTodo} is turned on, which blocks even programs that have permission.',
  },
  consecuencia: {
    es: 'Así, los demás no te pueden mandar temas por su cuenta: solo bajás de quienes atienden tu llamada. Se baja más lento y algunos temas no arrancan nunca.',
    en: "So others can't send you tracks on their own: you only download from people who answer your call. It's slower and some tracks never start.",
  },
  redPublica: {
    es: 'Tu red está marcada como **Pública** {perfil}. Si es la de tu casa, lo que corresponde es marcarla como **Privada** (una red de confianza). Esa decisión es tuya: acá solo se abre la pantalla de Windows.',
    en: 'Your network is marked as **Public** {perfil}. If it is your home network, the right thing is to mark it as **Private** (a trusted network). That is your decision: this only opens the Windows screen.',
  },
  abrirRed: { es: 'Abrir la configuración de red', en: 'Open network settings' },
  abrirRedNota: { es: 'Ahí: las propiedades de tu wifi o cable → «Privada».', en: 'There: your Wi-Fi or cable properties → "Private".' },
  abrirFirewall: { es: 'Abrir la configuración del firewall', en: 'Open firewall settings' },
  abrirFirewallNota: { es: 'Ahí, en tu red, apagá «Bloquear todas las conexiones entrantes».', en: 'There, on your network, turn off "Block all incoming connections".' },
  arreglar: { es: 'Arreglarlo', en: 'Fix it' },
  arreglarPublicas: { es: 'Darle permiso también en redes Públicas', en: 'Allow it on Public networks too' },
  sacaYDa: { es: (p: string) => `Saca ese «no» y le da permiso a sockseek en redes ${p}. Windows te pide permiso una vez.`, en: (p: string) => `Removes that "no" and gives sockseek permission on ${p} networks. Windows asks you for permission once.` },
  saca: { es: 'Saca ese «no». Windows te pide permiso una vez.', en: 'Removes that "no". Windows asks you for permission once.' },
  da: { es: (p: string) => `Le da permiso a sockseek en redes ${p}. Windows te pide permiso una vez.`, en: (p: string) => `Gives sockseek permission on ${p} networks. Windows asks you for permission once.` },
  arreglando: { es: 'Esperando el permiso de Windows…', en: 'Waiting for Windows permission…' },
  listo: { es: 'Listo: sockseek ya tiene permiso.', en: 'Done: sockseek now has permission.' },
  cancelado: { es: 'No se cambió nada: Windows pidió permiso y se eligió que no.', en: 'Nothing changed: Windows asked for permission and the answer was no.' },
  error: {
    es: 'No se pudo cambiar. Podés hacerlo a mano: clic derecho en el botón de Inicio → Terminal (administrador), pegá esto y apretá Enter:',
    en: "It couldn't be changed. You can do it by hand: right-click the Start button → Terminal (Admin), paste this and press Enter:",
  },
  nada: { es: 'Ya estaba bien: no hizo falta cambiar nada.', en: 'It was already fine: nothing needed changing.' },
  tipFirewall: {
    es: 'Windows decide qué programas pueden recibir conexiones de afuera (se llama firewall). sockseek necesita ese permiso para que los demás usuarios le manden los temas.',
    en: 'Windows decides which programs can receive connections from outside (it is called a firewall). sockseek needs that permission so other users can send it the tracks.',
  },
  tipPerfil: {
    es: 'Windows trata cada red según cómo la marcaste: Privada (tu casa, una red de confianza) o Pública (un bar, un aeropuerto: se cuida más). Los permisos del firewall valen para una, la otra o las dos.',
    en: 'Windows treats each network the way you marked it: Private (your home, a trusted network) or Public (a café, an airport: it is more careful). Firewall permissions apply to one, the other or both.',
  },
  tipBloquearTodo: {
    es: 'Una opción del firewall de Windows para redes en las que no confiás: no deja entrar ninguna conexión, ni siquiera a los programas que tienen permiso.',
    en: "A Windows firewall option for networks you don't trust: it lets no connection in, not even to programs that have permission.",
  },
})

const UNA: Record<PerfilRed, () => string> = { privada: () => T.privada, publica: () => T.publica, dominio: () => T.dominio }
const VARIAS: Record<PerfilRed, () => string> = { privada: () => T.privadas, publica: () => T.publicas, dominio: () => T.dominios }

/** "Privada", "Privada y Pública"… */
export const nombrePerfiles = (ps: PerfilRed[]) => lista(ps.map((p) => UNA[p]()))
/** "Privadas y Públicas" (para "en redes …"). */
export const nombreRedes = (ps: PerfilRed[]) => lista(ps.map((p) => VARIAS[p]()))

export interface TextoFirewall {
  tono: 'ok' | 'atencion'
  titulo: string
  /** Con {info} (qué es el firewall), {perfil} (qué son Privada y Pública) y {bloquearTodo}, para `Rico`. */
  texto: string
  consecuencia: string | null
  /** Si la red de ahora es Pública: que la marque como Privada si es la de su casa (con su botón). */
  redPublica: string | null
  /** El botón "Arreglarlo" (null: no se arregla con un botón) y qué hace, en una línea. */
  arreglar: string | null
  queHace: string | null
  /** Abrir una pantalla de Windows (el tipo de red o el firewall) y qué tocar ahí. */
  abrir: null | { que: 'red' | 'firewall'; etiqueta: string; nota: string }
  /** Lo que conviene primero es abrir la pantalla de Windows (marcar la red como Privada ya alcanza): ese botón va adelante. */
  primeroAbrir: boolean
}

/** Cada caso del firewall, en palabras simples, con su consecuencia y sus arreglos. */
export function textoFirewall(d: FirewallDiag): TextoFirewall {
  const vacio = { consecuencia: null, redPublica: null, arreglar: null, queHace: null, abrir: null, primeroAbrir: false }
  if (d.caso === 'bien') return { ...vacio, tono: 'ok', titulo: T.bien, texto: T.bienTexto(d.red ? ` «${d.red}»` : d.activos.length ? ` (${nombrePerfiles(d.activos)})` : '') }
  if (d.caso === 'apagado') return { ...vacio, tono: 'ok', titulo: T.apagado, texto: T.apagadoTexto }
  if (d.caso === 'todoBloqueado') {
    return { ...vacio, tono: 'atencion', titulo: T.todoBloqueado, texto: T.todoBloqueadoTexto, consecuencia: T.consecuencia, abrir: { que: 'firewall', etiqueta: T.abrirFirewall, nota: T.abrirFirewallNota }, primeroAbrir: true }
  }
  const publica = d.activos.includes('publica')
  const a = d.arreglo
  const queHace = !a ? null : a.sacarBloqueos && a.permitir.length ? T.sacaYDa(nombreRedes(a.permitir)) : a.sacarBloqueos ? T.saca : T.da(nombreRedes(a.permitir))
  const titulo = d.caso === 'sinRegla' ? T.sinRegla : d.caso === 'bloqueado' ? T.bloqueado : T.otroPerfil(nombreRedes(d.permitidos), nombrePerfiles(d.activos))
  const texto = d.caso === 'sinRegla' ? T.sinReglaTexto : d.caso === 'bloqueado' ? T.bloqueadoTexto : T.otroPerfilTexto(nombrePerfiles(d.permitidos))
  // tiene permiso en las Privadas y la red es Pública: marcándola como Privada ya anda; el botón le da permiso también en las Públicas
  const alcanzaConMarcar = d.caso === 'otroPerfil' && publica && d.permitidos.includes('privada')
  return {
    tono: 'atencion', titulo, texto, consecuencia: T.consecuencia,
    redPublica: publica ? T.redPublica : null,
    arreglar: a ? (alcanzaConMarcar ? T.arreglarPublicas : T.arreglar) : null,
    queHace,
    abrir: publica ? { que: 'red', etiqueta: T.abrirRed, nota: T.abrirRedNota } : null,
    primeroAbrir: alcanzaConMarcar,
  }
}

/** Las explicaciones de los ⓘ de las frases. */
export const TIP_FIREWALL = { get info() { return T.tipFirewall }, get perfil() { return T.tipPerfil }, get bloquearTodo() { return T.tipBloquearTodo } }

/** Cómo salió "Arreglarlo", en una frase (con 'error', después va el comando para hacerlo a mano). */
export function textoResultado(r: ResultadoArreglo): string {
  return r === 'listo' ? T.listo : r === 'cancelado' ? T.cancelado : r === 'error' ? T.error : T.nada
}
export const arreglandoTexto = () => T.arreglando

/** ¿Hay que avisar? (lo que no es "bien" ni "apagado"). */
export const firewallMal = (d: FirewallDiag | null | undefined): d is FirewallDiag => !!d && d.caso !== 'bien' && d.caso !== 'apagado'
