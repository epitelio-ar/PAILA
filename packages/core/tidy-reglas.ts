// Las reglas de "Arreglar nombres" que eligió la persona (un perfil o "a medida"), guardadas en la base. Las usan la pantalla
// (ipc/tags.ts) y Ordenar, que propone los nombres sola (core/revision-armar.ts). Si nunca se eligió, el perfil de fábrica.
import { DEFAULT_PROFILE, rulesOf, type TidyRule } from '@paila/shared/tidy-profiles'

export const CLAVE_REGLAS_NOMBRES = 'tidy.reglas'

/** `leer` trae un ajuste de la base (o null). */
export function reglasGuardadas(leer: (clave: string) => string | null): TidyRule[] {
  try {
    const v = leer(CLAVE_REGLAS_NOMBRES)
    const r = v ? JSON.parse(v) as TidyRule[] : rulesOf(DEFAULT_PROFILE)
    // reglas guardadas antes de que existiera el diccionario (Fase C): Prolijo y los de arriba lo incluyen
    const out: TidyRule[] = r.includes('acentos') && !r.includes('diccionario') && !leer('tidy.reglas.dicc') ? [...r, 'diccionario'] : r
    // y antes de las palabras aprendidas: también van en Prolijo y los de arriba
    const out2: TidyRule[] = out.includes('acentos') && !out.includes('aprendidas') && !leer('tidy.reglas.aprendidas') ? [...out, 'aprendidas'] : out
    // y antes de la regla del vinilo (22/10): va en todos los perfiles, prendida
    return !out2.includes('vinilo') && !leer('tidy.reglas.vinilo') ? [...out2, 'vinilo'] : out2
  } catch { return rulesOf(DEFAULT_PROFILE) }
}
