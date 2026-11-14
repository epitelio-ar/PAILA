// Un texto traducido con partes que no son texto: **negrita** y huecos {nombre} donde va otra cosa (un ⓘ, un botón, un
// número resaltado). Así la frase entera queda en un solo par castellano/inglés y cada idioma pone las partes donde le toca.
import { Fragment, type ReactNode } from 'react'

/** Arma la frase: rico('Tenés **{n} temas** sin tapa {info}', { n: 3, info: <Info tip="…" /> }). */
export function rico(texto: string, partes: Record<string, ReactNode> = {}): ReactNode[] {
  const hueco = (s: string, clave: string) => s.split(/(\{\w+\})/).map((x, i) => {
    const m = /^\{(\w+)\}$/.exec(x)
    return m && m[1] in partes ? <Fragment key={`${clave}-${i}`}>{partes[m[1]]}</Fragment> : x
  })
  return texto.split(/(\*\*[^*]+\*\*)/).flatMap((x, i) => (/^\*\*[^*]+\*\*$/.test(x) ? [<b key={i}>{hueco(x.slice(2, -2), `b${i}`)}</b>] : hueco(x, `t${i}`))).filter((x) => x !== '')
}

/** Lo mismo como componente: <Rico texto={T.aviso(n)} partes={{ info: <Info tip={T.avisoTip} /> }} />. */
export function Rico({ texto, partes }: { texto: string; partes?: Record<string, ReactNode> }) {
  return <>{rico(texto, partes)}</>
}
