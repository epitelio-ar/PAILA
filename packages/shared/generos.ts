// Varios géneros por tema, uno solo a la vista (decisión del autor, 13/11, docs/DECISIONES.md: "que no spamee en todo lugar"). El
// tag puede traer varios ("Reggaeton; Latin Music", "Electronic, Latin, Pop", "Pop Rock/Electronic Rock/Alternative Rock"); la lista
// de temas, su orden, Estadísticas, la planilla y las carpetas "Por género" usan el PRINCIPAL, el primero. Todos se ven solo en la
// ficha del tema. Una sola función para que el principal sea siempre el mismo en todos lados.
//
// Cómo se separan: PAILA los escribe con "; " (core/tagio.ts) y otros programas con ";" o ",". La barra es ambigua: "Rap/Hip Hop" y
// "Pop/Rock" son UN género (Deezer, AllMusic) y "Minimal / Deep Tech" también (Beatport): solo se corta con tres o más, sin espacios
// ("Rock/Pop/Glam Rock/Hard Rock"). Una página ("http://vk.com/…", "WwW.ZonaCumbieros.NeT") o puros signos ("____") no son géneros.

const PAGINA = /^\s*(?:https?[:_]|www\.)|\.(?:com|net|org|ru|me|info|ar|es)\b/i

export function generos(tag: string | null | undefined): string[] {
  if (!tag?.trim()) return []
  const out: string[] = [], vistos = new Set<string>()
  for (const parte of tag.split(/[;,]/)) {
    if (PAGINA.test(parte)) continue // una dirección entera, antes de cortarla por sus barras
    const barras = parte.split(/(?<!\s)\/(?!\s)/)
    for (const g of barras.length >= 3 ? barras : [parte]) {
      const v = g.trim()
      if (!v || /^[\W_]+$/.test(v) || PAGINA.test(v) || vistos.has(v.toLowerCase())) continue
      vistos.add(v.toLowerCase()); out.push(v)
    }
  }
  return out
}

/** El género que se ve en todos lados (menos en la ficha): el primero que sirve, o null. */
export const generoPrincipal = (tag: string | null | undefined): string | null => generos(tag)[0] ?? null
