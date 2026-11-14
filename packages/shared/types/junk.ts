// Tipos de "Palabras que sobran, aprendidas de la biblioteca" (core/junkwords.ts, MASTERPLAN-2 4.5).

/** on = se saca (va a Cambios pendientes) · off = apagada por ahora · no_es = "No es basura": no se propone nunca más. */
export type LearnedState = 'on' | 'off' | 'no_es'
/** Dónde aparece: entre corchetes, entre paréntesis, al final del nombre o con forma de página web. */
export type LearnedWhere = 'corchetes' | 'parentesis' | 'final' | 'web'

export interface LearnedWord {
  /** La clave (en minúscula, sin signos). */
  key: string
  /** Cómo aparece más seguido en los nombres ("[www.slider.kz]", "(Prod. DJ X)"). */
  shown: string
  where: LearnedWhere
  /** En cuántos temas identificados con seguridad sobra, de cuántos artistas y de cuántas carpetas. */
  tracks: number
  artists: number
  folders: number
  /** De los temas identificados que la llevan, qué parte no la tiene en el nombre oficial (0,9 = 90 %). */
  ratio: number
  /** A cuántos temas de tu biblioteca se la sacaría (los que internet no encontró incluidos). */
  applies: number
  examples: { from: string; to: string }[]
  state: LearnedState
}
export interface LearnedReport {
  words: LearnedWord[]
  /** Cuántos temas están identificados con seguridad (huella acústica y duración coinciden): de ahí se aprende. */
  identified: number
  /** Las que casi entran y por qué no (para revisar que las barandas anden). */
  rejected: { shown: string; why: string }[]
}
