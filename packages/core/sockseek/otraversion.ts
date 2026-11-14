// NAPIA: ¿lo que bajó sockseek es otra versión del tema que no pediste? Pasó el 24/10 con una lista pegada a mano: "Salgo Pa'
// la Calle" llegó como la acapella. Sin la duración (texto pegado), sockseek no tiene cómo distinguirlas y no deja excluir
// palabras al buscar. Así que NAPIA mira el nombre del archivo que llegó: si dice acapella, instrumental, remix, en vivo…
// y lo pedido no lo dice, no sirve (control.ts lo aparta a "descartados" y busca en otro usuario, como lo trucho).
// Las palabras salen de core/versionwords.ts (las mismas de Duplicados, dupnames.ts: otherRecording). No cuentan las que
// cambian poco o que en Soulseek están en casi todo ("Original Mix", "Extended", "Radio Edit", "Remaster").
// Puro, con tests en tests/napia-calidad.test.ts.
import path from 'node:path'
import { fold } from '../names'
import { versionRe } from '../versionwords'

/** Otra grabación (acapella, instrumental, en vivo, acústico…) u otra mezcla hecha por otro (remix, bootleg, mashup…). */
const PALABRAS = versionRe(['grabacion', 'vivo'], {
  extra: ['remix', 'rmx', 'remezcla', 'bootleg', 'mashup', 'rework', 'reworx', 'refix', 'flip', 'vip', 'dub', 'stem', 'stems', 'no vocals', 'vocals only'],
  flags: 'g',
})

/** Las formas de escribir lo mismo cuentan una vez ("Acappella" = "Acapella", "en vivo" = "live"). */
const MISMA: [RegExp, string][] = [
  [/^(?:a ?c+ap+el+a|cap+el+a)$/, 'acapella'],
  [/^(?:live|en vivo|vivo|en directo|directo)$/, 'en vivo'],
  [/^(?:acoustic|acustico|acustica)$/, 'acustico'],
  [/^(?:remix|rmx|remezcla)$/, 'remix'],
  [/^(?:stems?)$/, 'stem'],
]
const forma = (w: string) => { const f = fold(w).replace(/\s+/g, ' ').trim(); return MISMA.find(([re]) => re.test(f))?.[1] ?? f }
const palabras = (s: string) => new Set((s.replace(/[_.]/g, ' ').match(PALABRAS) ?? []).map(forma))

/**
 * Si el archivo es otra versión que lo pedido no dice, cuál ("acapella", "remix"); null si es lo pedido (o pediste esa
 * versión: "Tema (Acapella)" pide la acapella). Se mira solo el nombre del archivo, no la carpeta (un disco de remixes trae
 * también el original).
 */
export function otraVersion(pedido: { artist: string; title: string }, archivo: string): string | null {
  const quiere = palabras(`${pedido.artist} ${pedido.title}`)
  const nombre = path.basename(archivo.replace(/\\/g, '/')).replace(/\.[^.]+$/, '')
  for (const w of palabras(nombre)) if (!quiere.has(w)) return w
  return null
}
