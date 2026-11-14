// Los textos del proceso principal de NAPIA (ipc.ts), en castellano y en inglés (ver @paila/shared/idioma): avisos que se
// ven en la pantalla y las líneas que NAPIA suma al registro de "Ver el detalle". Los nombres de archivos y carpetas no.
import { textos } from '@paila/shared/idioma'

export const T = textos({
  sinFreno: {
    es: 'Este sockseek no es el que trae NAPIA: al buscar satura el router (por un rato no anda ni internet). Hace falta el sockseek de NAPIA.',
    en: 'This sockseek isn\'t the one that comes with NAPIA: when it searches, it overloads the router (for a while not even the internet works). You need NAPIA\'s sockseek.',
  },
  seCorto: { es: 'Tu internet se cortó un rato mientras sockseek buscaba.', en: 'Your internet dropped for a while as sockseek was searching.' },
  siSeRepite: { es: 'Si se repite, probá de nuevo más tarde.', en: 'If it happens again, try again later.' },
  noConecta: {
    es: 'sockseek encontró los temas, pero tu internet no deja que los que los tienen te los manden.',
    en: 'sockseek found the tracks, but your internet won\'t let the people who have them send them to you.',
  },
  comoArreglarlo: { es: ' Abajo está cómo arreglarlo (una sola vez).', en: ' Below is how to fix it (just once).' },
  sinSockseek: { es: 'No encontramos sockseek en esta compu.', en: 'Couldn\'t find sockseek on this computer.' },
  confirmaCarpeta: { es: 'Primero confirmá dónde guardar lo que baje (paso 2).', en: 'First confirm where to save what you download (step 2).' },
  seCerro: { es: 'Se cerró NAPIA.', en: 'NAPIA was closed.' },
  guardarFaltan: { es: 'Guardar lo que no se encontró', en: 'Save what wasn\'t found' },
  texto: { es: 'Texto', en: 'Text' },
  puertoAbierto: {
    es: (port: number, via: string, confirmado: boolean) => `[napia] Puerto ${port} abierto en el router (${via}${confirmado ? ', confirmado' : ''}).`,
    en: (port: number, via: string, confirmado: boolean) => `[napia] Port ${port} opened on the router (${via}${confirmado ? ', confirmed' : ''}).`,
  },
  puertoNo: {
    es: (port: number, detalle: string) => `[napia] No se pudo abrir el puerto ${port} en el router: ${detalle}`,
    en: (port: number, detalle: string) => `[napia] Couldn't open port ${port} on the router: ${detalle}`,
  },
  pruebaAfuera: {
    es: (port: number, r: 'abierto' | 'cerrado') => `[napia] Prueba de Soulseek desde internet: puerto ${port} ${r}.`,
    en: (port: number, r: 'abierto' | 'cerrado') => `[napia] Soulseek's test from the internet: port ${port} ${r === 'abierto' ? 'open' : 'closed'}.`,
  },
  trabado: { es: '[napia] Sin conexión al servidor de Soulseek: el router se trabó.', en: '[napia] No connection to the Soulseek server: the router got stuck.' },
  otraFuente: {
    es: (ronda: number, temas: number, vetados: number) => `[napia] Buscando otra fuente (vuelta ${ronda}) para ${temas === 1 ? '1 tema' : `${temas} temas`}${!vetados ? '' : vetados === 1 ? ', sin el usuario que lo compartía trucho o lento' : `, sin los ${vetados} usuarios que los compartían truchos o lentos`}.`,
    en: (ronda: number, temas: number, vetados: number) => `[napia] Looking for another source (round ${ronda}) for ${temas === 1 ? '1 track' : `${temas} tracks`}${!vetados ? '' : vetados === 1 ? ', without the user who shared it bogus or slow' : `, without the ${vetados} users who shared them bogus or slow`}.`,
  },
  lentas: {
    es: (temas: string[]) => `[napia] Solo quedaban fuentes muy lentas: se cortan y se busca otra para ${temas.join(', ')}.`,
    en: (temas: string[]) => `[napia] Only very slow sources were left: they're cut and another source is tried for ${temas.join(', ')}.`,
  },
  truchasMuestra: {
    es: (temas: string[]) => `[napia] Mientras bajaba, un pedazo ya sonaba trucho: se corta y se busca otra fuente para ${temas.join(', ')}.`,
    en: (temas: string[]) => `[napia] While downloading, a piece already sounded bogus: it's cut and another source is tried for ${temas.join(', ')}.`,
  },
})

/** El problema de una corrida que NAPIA ve por su cuenta (el router trabado, nadie se conecta), con o sin el sockseek con freno. */
export const problemas = {
  routerTrabado: (freno: boolean) => `${T.seCorto} ${freno ? T.siSeRepite : T.sinFreno}`,
  noConecta: (freno: boolean) => `${T.noConecta}${freno ? T.comoArreglarlo : ` ${T.sinFreno}`}`,
}
