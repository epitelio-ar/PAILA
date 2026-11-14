// Los textos de la Bandeja vigilada (core/inboxflow.ts), en castellano y en inglés (ver @paila/shared/idioma).
// `P`: los motivos de la verificación, en par, porque se muestran en el idioma de la pantalla y además se anotan en
// `no-sirvió/motivos.txt`, que queda siempre en castellano (lo que PAILA escribe en tus carpetas no cambia de idioma).
import { num, textos } from '@paila/shared/idioma'

type Par = { es: string; en: string }
const kHz = (hz: number) => num(hz / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const dB = (x: number) => num(x, { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export const P = {
  noAnalizado: (): Par => ({
    es: 'El tema de tu biblioteca todavía no se analizó: no se puede saber si el nuevo es mejor.',
    en: "The track in your library hasn't been analyzed yet: there's no way to know if the new one is better.",
  }),
  danado: (): Par => ({
    es: 'El archivo nuevo está dañado: tiene partes que no se pueden leer.',
    en: "The new file is damaged: some parts of it can't be read.",
  }),
  conHuecos: (): Par => ({
    es: 'El archivo nuevo tiene cortes (pedazos que no se pueden leer) y el que tenés no.',
    en: "The new file has gaps (bits that can't be read) and yours doesn't.",
  }),
  noEsLoQueDice: (label: string): Par => ({ es: `No es lo que dice ser: ${label}.`, en: `It isn't what it claims to be: ${label}.` }),
  noEsMejor: (grade: string, label: string, old: string): Par => ({
    es: `No es mejor: el nuevo tiene nota ${grade} (${label}) y el que tenés, ${old}.`,
    en: `It isn't better: the new one has grade ${grade} (${label}) and yours, ${old}.`,
  }),
  /** La misma nota que el tuyo: sería mejor solo si suena con más calidad real y se lee entero (core/better.ts). */
  mismaNota: (grade: string, kbps: number | null, old: number | null): Par => {
    const more = kbps != null && old != null && kbps > old, both = kbps != null && old != null
    return {
      es: `No es mejor: tiene la misma nota que el tuyo (${grade})${more ? ' y, aunque suena con más calidad, tiene partes que no se pueden leer' : both ? ` y no suena con más calidad (${kbps} kbps reales contra ${old})` : ''}.`,
      en: `It isn't better: it has the same grade as yours (${grade})${more ? " and, though it sounds better, some parts of it can't be read" : both ? ` and doesn't sound better (${kbps} real kbps versus ${old})` : ''}.`,
    }
  },
  duraDistinto: (old: number, nuevo: number): Par => ({
    es: `Dura distinto: ${old} s el tuyo y ${nuevo} s el nuevo (puede ser otra versión o estar cortado).`,
    en: `Different length: ${old} s yours and ${nuevo} s the new one (it may be another version or cut short).`,
  }),
  hechoDelTuyo: (cut: number): Par => ({
    es: `Parece hecho a partir de un archivo como el tuyo: arriba de ${(cut / 1000).toFixed(1).replace('.', ',')} kHz, donde el tuyo se corta, casi no suma sonido. No es mejor de verdad.`,
    en: `It looks like it was made from a file like yours: above ${kHz(cut)} kHz, where yours cuts off, it adds almost no sound. It isn't really better.`,
  }),
  masFuerte: (nc: number, oc: number): Par => ({
    es: `Es un master más fuerte y con más recortes de volumen (clipping) que el tuyo: ${nc} contra ${oc}.`,
    en: `It's a louder master with more volume clipping than yours: ${nc} versus ${oc}.`,
  }),
}

export const T = textos({
  otroMaster: {
    es: (x: number) => `Es otro master: el volumen cambia ${x.toFixed(1).replace('.', ',')} dB. Suena igual de tema, pero no idéntico.`,
    en: (x: number) => `It's another master: the volume changes by ${dB(x)} dB. It's the same track, but it doesn't sound identical.`,
  },
  sinPareja: {
    es: 'No se parece a ningún tema de tu biblioteca: si es nuevo, sumalo a tu Música a mano.',
    en: "It doesn't look like any track in your library: if it's new, add it to your Music by hand.",
  },
  faltaba: {
    es: (a: string, t: string, ref: string | null) => `Es «${a} - ${t}», un tema que te faltaba. No reemplaza a nada: copialo a tu Música${ref ? ` (por ejemplo junto a «${ref}», que tiene ese título pero suena como otro tema)` : ''}.`,
    en: (a: string, t: string, ref: string | null) => `It's «${a} - ${t}», a track you were missing. It doesn't replace anything: copy it to your Music${ref ? ` (for example next to «${ref}», which has that title but sounds like another track)` : ''}.`,
  },
  noLeer: { es: (m: string) => `No se pudo leer: ${m}`, en: (m: string) => `Couldn't read it: ${m}` },
  reemplazar: {
    es: (name: string, old: string | null, nuevo: string, avisos: string) => `Es el mismo audio que «${name}» y es mejor de verdad (nota ${old} → ${nuevo}).${avisos ? ` ${avisos}` : ''}`,
    en: (name: string, old: string | null, nuevo: string, avisos: string) => `It's the same audio as «${name}» and it's really better (grade ${old} → ${nuevo}).${avisos ? ` ${avisos}` : ''}`,
  },
  noSirve: {
    es: (name: string, problemas: string) => `Es el mismo audio que «${name}», pero no sirve: ${problemas}`,
    en: (name: string, problemas: string) => `It's the same audio as «${name}», but it doesn't qualify: ${problemas}`,
  },
  probable: {
    es: (porTag: boolean, name: string, ojo: string) => `Por el ${porTag ? 'tag' : 'nombre del archivo'} y la duración parece «${name}», pero no se pudo comparar cómo suena: comparalo escuchando antes de reemplazar.${ojo ? ` Ojo: ${ojo}` : ''}`,
    en: (porTag: boolean, name: string, ojo: string) => `From the ${porTag ? 'tag' : 'file name'} and the length it looks like «${name}», but there was no way to compare how it sounds: listen and compare before you replace it.${ojo ? ` Careful: ${ojo}` : ''}`,
  },
  mismo: { es: (name: string, problemas: string) => `Es el mismo audio que «${name}». ${problemas}`, en: (name: string, problemas: string) => `It's the same audio as «${name}». ${problemas}` },
  seParece: { es: (name: string) => `Se parece a «${name}»: escuchalo antes de hacer nada.`, en: (name: string) => `It looks like «${name}»: listen to it before you do anything.` },
  cambio: { es: 'Cambió desde la simulación: revisalo de nuevo', en: 'It changed since the simulation: check it again' },
})
