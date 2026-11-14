// Las pantallas que todavía tienen textos sueltos (sin su par en inglés): la regla de tests/estilo.test.ts no las revisa
// mientras estén acá. Al pasar una pantalla a `textos()` (ver `npm run textos -- <archivo>`), se saca de la lista; si una
// queda sin textos sueltos y sigue anotada, el test avisa. Una pantalla NUEVA no entra acá: nace con sus textos en pares.
export const SIN_PASAR_TODAVIA = [
]

/** Las que no se traducen nunca, con el porqué. */
export const NO_SE_TRADUCEN: Record<string, string> = {
  'packages/diseno/src/Muestrario.tsx': 'pantalla oculta para quien programa (Ctrl+Mayús+M): muestra los componentes con textos de ejemplo',
}
