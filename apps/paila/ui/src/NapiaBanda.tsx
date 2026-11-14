// El estado de NAPIA, siempre arriba en Sonido (DECISIONES 02/11; MASTERPLAN-5, 2.4): qué está bajando, cuánto falta, qué llegó trucho y
// lo último que pasó, sin cambiar de ventana. Lo dice el enlace de NAPIA (ipc/sonido.ts, cada 3 s). Solo si a NAPIA le falta algo que se
// hace allá (la cuenta de Soulseek, la carpeta), ofrece abrirla: es la única ida, y una sola vez.
import { useEffect, useState } from 'react'
import type { EstadoNapia } from '@paila/shared/types'
import { Aviso, Barra, Boton, Info, Pildora } from '@paila/diseno'
import { cant, textos } from '@paila/shared/idioma'
import { n } from './format'

const T = textos({
  sinNada: { es: 'NAPIA no está bajando nada.', en: 'NAPIA is not downloading anything.' },
  napiaTip: {
    es: 'NAPIA es la compañera de PAILA que baja de Soulseek lo que le pedís. Desde acá le mandás lo que suena mal o te falta y la dejás bajando: no hace falta ir a su ventana. Lo que llega lo revisa la Bandeja.',
    en: "NAPIA is PAILA's companion that downloads from Soulseek what you ask for. From here you send it what sounds bad or is missing and leave it downloading: no need to go to its window. What arrives is checked by the Inbox.",
  },
  bajando: { es: (l: string) => `NAPIA está bajando «${l}»`, en: (l: string) => `NAPIA is downloading «${l}»` },
  avance: { es: (h: string, t: string) => `${h} de ${t}`, en: (h: string, t: string) => `${h} of ${t}` },
  llegaron: { es: (k: number) => cant(k, 'llegó', 'llegaron'), en: (k: number) => `${n(k)} arrived` },
  truchos: { es: (k: number) => `${cant(k, 'trucho', 'truchos')} (busca otra copia)`, en: (k: number) => `${cant(k, 'fake', 'fakes')} (looking for another copy)` },
  truchosTip: { es: 'Llegaron con una calidad que no es la que dicen (un MP3 inflado, un FLAC hecho de un MP3): NAPIA los aparta y busca otra copia, de otra persona.', en: "They arrived with a quality that isn't what they claim (an inflated MP3, a FLAC made from an MP3): NAPIA sets them aside and looks for another copy, from someone else." },
  noEstan: { es: (k: number) => cant(k, 'no está', 'no están'), en: (k: number) => `${n(k)} not found` },
  faltan: { es: (k: number) => `faltan ${n(k)}`, en: (k: number) => `${n(k)} to go` },
  enEspera: { es: (k: number) => `y ${cant(k, 'lista espera', 'listas esperan')} después`, en: (k: number) => `and ${cant(k, 'list waits', 'lists wait')} after` },
  termino: {
    es: (l: string, b: number, f: number) => `NAPIA terminó «${l}»: ${b ? cant(b, 'tema llegó', 'temas llegaron') : 'no llegó ninguno'}${f ? `, ${cant(f, 'no se consiguió', 'no se consiguieron')} (siguen en la lista)` : ''}.`,
    en: (l: string, b: number, f: number) => `NAPIA finished «${l}»: ${b ? `${n(b)} arrived` : 'nothing arrived'}${f ? `, ${n(f)} couldn't be found (still on the list)` : ''}.`,
  },
  cortada: { es: (l: string) => `NAPIA cortó «${l}»: lo que falta sigue esperando.`, en: (l: string) => `NAPIA stopped «${l}»: what's left keeps waiting.` },
  falta: {
    es: (q: string) => `Para bajar, NAPIA necesita ${q}. Se hace una sola vez, en NAPIA.`,
    en: (q: string) => `To download, NAPIA needs ${q}. It's done only once, in NAPIA.`,
  },
  fSockseek: { es: 'sockseek (el programa que baja de Soulseek)', en: 'sockseek (the program that downloads from Soulseek)' },
  fCuenta: { es: 'tu cuenta de Soulseek', en: 'your Soulseek account' },
  fCarpeta: { es: 'que confirmes dónde guardar lo que baja', en: 'you to confirm where to save what it downloads' },
  abrir: { es: 'Abrir NAPIA', en: 'Open NAPIA' },
  ver: { es: 'Ver en NAPIA', en: 'See in NAPIA' },
  verTip: { es: 'Trae NAPIA adelante, por si querés ver cada tema o cortar la bajada', en: 'Brings NAPIA to the front, in case you want to see each track or stop the download' },
})

const QUE: Record<NonNullable<EstadoNapia['falta']>, string> = { get sockseek() { return T.fSockseek }, get cuenta() { return T.fCuenta }, get carpeta() { return T.fCarpeta } }

/** El estado de NAPIA, al día (lo comparten la banda y la pantalla Sonido). */
export function useEstadoNapia() {
  const [e, setE] = useState<EstadoNapia | null>(null)
  useEffect(() => { void window.paila.napiaEstado().then(setE); return window.paila.onNapiaEstado(setE) }, [])
  return e
}

export default function NapiaBanda({ e }: { e: EstadoNapia | null }) {
  const ver = () => void window.paila.verNapia()
  if (e?.abierta && e.falta) {
    return <Aviso tone="atencion" className="son-banda">{T.falta(QUE[e.falta])} <Boton size="sm" onClick={ver}>{T.abrir}</Boton></Aviso>
  }
  if (e?.corriendo) {
    const pct = e.total ? Math.round((e.hechos / e.total) * 100) : null
    return (
      <div className="son-banda son-bajando" role="status">
        <div className="son-banda-fila">
          <b>{T.bajando(e.lista ?? 'NAPIA')}</b><Info tip={T.napiaTip} />
          <span className="muted small">{T.avance(n(e.hechos), n(e.total))} · {T.faltan(Math.max(0, e.total - e.hechos))}{e.enEspera ? ` · ${T.enEspera(e.enEspera)}` : ''}</span>
          <span className="push-right"><Boton size="sm" variant="ghost" onClick={ver} title={T.verTip}>{T.ver}</Boton></span>
        </div>
        <Barra value={pct} />
        <div className="son-banda-fila small">
          <Pildora tone="ok">{T.llegaron(e.bajados)}</Pildora>
          {e.truchos > 0 && <Pildora tone="atencion" title={T.truchosTip}>{T.truchos(e.truchos)}</Pildora>}
          {e.noEncontrados > 0 && <Pildora>{T.noEstan(e.noEncontrados)}</Pildora>}
        </div>
        {e.ultimos.length > 0 && (
          <ul className="son-ultimos small">
            {e.ultimos.slice(0, 3).map((u) => <li key={`${u.artist}|${u.title}`} className={`son-u-${u.estado}`}><b>{u.artist} — {u.title}</b> <span className="muted">{u.frase}</span></li>)}
          </ul>
        )}
      </div>
    )
  }
  if (e?.fin) return <div className="son-banda son-quieta small" role="status"><span>{e.fin.cortada ? T.cortada(e.fin.lista) : T.termino(e.fin.lista, e.fin.bajados, e.fin.noConseguidos)}<Info tip={T.napiaTip} /></span></div>
  return <div className="son-banda son-quieta small muted" role="status"><span>{T.sinNada}<Info tip={T.napiaTip} /></span></div>
}

/** La banda sola, con su estado (para Faltan o suenan mal y la Bandeja, que también son de Sonido). */
export function NapiaArriba() { return <NapiaBanda e={useEstadoNapia()} /> }
