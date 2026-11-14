// Busca textos escritos sueltos en las pantallas (en vez de ir en un par castellano/inglés con `textos()` de
// @paila/shared/idioma): texto entre etiquetas y toda cadena que se lea como frase (en atributos, variables, `label:`,
// `toast()`…), salvo claves del código (comparaciones, localStorage, clases, rutas); también 'es-AR' a mano.
// Lo usan tests/estilo.test.ts (la regla) y scripts/textos.ts (`npm run textos`, para ver qué falta en una pantalla).
import fs from 'node:fs'
import path from 'node:path'
import { parse } from '@babel/parser' // viene con @vitejs/plugin-react; solo se usa al revisar, nunca viaja en la app

export interface Suelto { linea: number; texto: string }

/** Nombres que se dicen igual en los dos idiomas: solos no cuentan como texto para traducir. */
const IGUALES = /\b(PAILA|NAPIA|Rekordbox|Traktor|Serato|VirtualDJ|Engine DJ|Soulseek|sockseek|Ableton|Spotify|YouTube|Bandcamp|Beatport|Discogs|MusicBrainz|AcoustID|AudD|Deezer|Last\.fm|iTunes|Windows|macOS|Android|iPhone|Excel|GitHub|Exportify|Chosic|TuneMyMusic|Camelot|BPM|LUFS|FLAC|MP3|WAV|AIFF|AAC|ALAC|OGG|Opus|M4A|ZIP|RAR|CSV|USB|CDJ|XML|kbps|kHz|Hz|dB|ms|GB|MB|KB|TB|ID3|ReplayGain|DJ|LU|dBTP|Ctrl|Alt|Esc|Tab|Enter|ⓘ)\b/g
/** Atributos que no son texto que se lee. */
const TECNICOS = /^(className|class|style|key|id|href|src|d|viewBox|transform|points|fill|stroke|role|htmlFor|name|type|accept|autoComplete|inputMode|pattern|target|rel|lang|dir|tone|variant|size|tipo|icon|nivel|width|height|x|y|data-.*|aria-hidden)$/
/** Propiedades de un objeto que siempre son texto para leer (aunque sea una palabra). */
const DE_TEXTO = /^(label|titulo|title|sub|detalle|detail|tip|texto|text|placeholder|hint|ayuda|descripcion|description|mensaje|message|nombre|vacio|help|why|motivo|resumen|boton|pregunta|aviso|explicacion|leyenda|etiqueta|accion)$/
const LLAMADAS = /^(toast|confirm|alert)$/

/** ¿Es una frase o palabra para leer? (no una clase, una ruta, una clave ni un nombre de los IGUALES) */
export function esFrase(s: string, deTexto = false): boolean {
  const t = s.replace(IGUALES, ' ').replace(/…/g, ' ').replace(/\s+/g, ' ').trim()
  if (!/\p{L}{2}/u.test(t)) return false
  if (/^[MmLlHhVvCcAaZz][\d\s.,-]/.test(t)) return false // el dibujo de un ícono (SVG)
  if (/^(#|\/|\.\/|https?:|var\(|paila:|[\w.-]+\.(png|svg|css|json|exe|db|ts|tsx)$)/.test(t)) return false
  if (deTexto) return true
  // en minúscula y sin tildes puede ser una clase ('row small muted') o una frase ('menos de 1 min'): la delatan las palabras chicas
  if (/(^| )(de|del|la|el|los|las|que|con|sin|para|por|en|un|una|y|o|no|se|al|lo|es|hay|ya|tu|tus|te|mi|si)( |$)/.test(t)) return true
  return /^[\p{Lu}¿¡]/u.test(t) || /\p{L}\s+\p{L}/u.test(t) && !/^[a-z0-9-]+( [a-z0-9-]+)*$/.test(t) || /[áéíóúñ]/.test(t)
}

type Nodo = { type: string; loc?: { start: { line: number } }; [k: string]: unknown }
const esNodo = (x: unknown): x is Nodo => !!x && typeof x === 'object' && typeof (x as Nodo).type === 'string'
const hijos = (n: Nodo) => Object.entries(n).filter(([k]) => k !== 'loc' && k !== 'leadingComments' && k !== 'trailingComments' && k !== 'innerComments' && k !== 'extra')
  .flatMap(([, v]) => (Array.isArray(v) ? v : [v])).filter(esNodo)

/** Propiedades cuyo valor es una clave del código, no un texto (y es/en: los pares ya traducidos). */
const CLAVES = /^(es|en|key|page|id|icon|tone|tipo|kind|type|field|campo|clave|value|variant|size|className|class|style|ruta|path|href|src|ext|formato|format|accept|role|name|grupoId|detalle|tecla|teclas|color|fondo|ancho|alto|width|height|cursor|display|position|align|justify)$/
/** Funciones que reciben claves, rutas, clases o expresiones, no textos para leer. */
const NO_TEXTO = /^(cls|clsx|classNames|getItem|setItem|removeItem|querySelector|querySelectorAll|closest|matches|getElementById|createElement|addEventListener|removeEventListener|dispatchEvent|CustomEvent|Event|invoke|send|sendSync|on|off|once|emit|startsWith|endsWith|includes|indexOf|lastIndexOf|split|replace|replaceAll|join|padStart|padEnd|test|exec|match|matchAll|RegExp|require|insertAdjacentHTML|setAttribute|getAttribute|removeAttribute|setProperty|getPropertyValue|toggle|contains|add|remove|log|warn|error|info|debug|toLocaleString|toLocaleDateString|toLocaleTimeString|NumberFormat|DateTimeFormat|Collator|localeCompare|useRef|lazy|import|dataset|has|get|set|delete|Symbol|key|ponerIdioma|esIdioma|rico)$/
const nombreLlamada = (c: unknown): string => !esNodo(c) ? '' : c.type === 'Identifier' ? String(c.name) : c.type === 'MemberExpression' && esNodo(c.property) ? String(c.property.name ?? c.property.value ?? '') : ''
const nombreClave = (k: unknown): string => !esNodo(k) ? '' : String(k.name ?? k.value ?? '')

/** Los textos sueltos de un archivo de pantalla: toda cadena que se lea como frase, salvo claves del código y los pares es/en. */
export function textosSueltos(codigo: string, archivo = 'x.tsx'): Suelto[] {
  const ast = parse(codigo, { sourceType: 'module', plugins: archivo.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript'] })
  const lineas = codigo.split('\n')
  const permitido = (l: number) => /idioma-ok/.test(lineas[l - 1] ?? '') || /idioma-ok/.test(lineas[l - 2] ?? '')
  const out: Suelto[] = []
  const anotar = (linea: number, texto: string, deTexto = false) => {
    if (esFrase(texto, deTexto) && !permitido(linea)) out.push({ linea, texto: texto.replace(/\s+/g, ' ').trim().slice(0, 80) })
  }
  /** saltar: las cadenas de acá son claves; texto: son texto aunque sea una palabra (label, title, toast…). */
  const visitar = (n: Nodo, saltar = false, texto = false): void => {
    const t = n.type
    if (t === 'ImportDeclaration' || t === 'ExportAllDeclaration' || t === 'Directive') return
    if (t.startsWith('TS') && !/^TS(As|NonNull|Satisfies|TypeAssertion|Instantiation)Expression$/.test(t)) return // tipos
    if (t === 'StringLiteral') {
      if (n.value === 'es-AR' && !permitido(n.loc!.start.line)) out.push({ linea: n.loc!.start.line, texto: "'es-AR' a mano (va num() o fecha() de @paila/shared/idioma)" })
      else if (!saltar) anotar(n.loc!.start.line, String(n.value), texto)
      return
    }
    if (t === 'TemplateLiteral') {
      if (!saltar) anotar(n.loc!.start.line, (n.quasis as Nodo[]).map((q) => (q.value as { cooked: string }).cooked).join(' … '), texto)
      for (const e of n.expressions as Nodo[]) visitar(e, saltar)
      return
    }
    // el renglón donde empieza a leerse (no el del > de antes)
    if (t === 'JSXText') { anotar(n.loc!.start.line + (/^\s*/.exec(String(n.value))![0].match(/\n/g) ?? []).length, String(n.value)); return }
    if (t === 'JSXElement' || t === 'JSXFragment') { for (const h of hijos(n)) visitar(h); return }
    if (t === 'JSXAttribute') {
      const nombre = esNodo(n.name) ? String(n.name.name) : ''
      if (esNodo(n.value)) visitar(n.value, TECNICOS.test(nombre), DE_TEXTO.test(nombre))
      return
    }
    if (t === 'ObjectProperty' || t === 'ObjectMethod') {
      const k = nombreClave(n.key)
      if (n.computed && esNodo(n.key)) visitar(n.key, true)
      if (esNodo(n.value)) visitar(n.value, saltar || CLAVES.test(k), DE_TEXTO.test(k))
      if (esNodo(n.body)) visitar(n.body)
      return
    }
    if (t === 'MemberExpression' || t === 'OptionalMemberExpression') { visitar(n.object as Nodo, saltar); if (n.computed) visitar(n.property as Nodo, true); return }
    // comparar con una clave (e.key === 'ArrowRight', tipo === 'Otro') o un case: no es texto que se lee
    if (t === 'BinaryExpression' && /^[!=]==?$/.test(String(n.operator))) { visitar(n.left as Nodo, true); visitar(n.right as Nodo, true); return }
    if (t === 'SwitchCase') { if (esNodo(n.test)) visitar(n.test, true); for (const h of n.consequent as Nodo[]) visitar(h); return }
    if (t === 'CallExpression' || t === 'OptionalCallExpression' || t === 'NewExpression') {
      const f = nombreLlamada(n.callee)
      visitar(n.callee as Nodo, saltar)
      const args = n.arguments as Nodo[]
      args.forEach((a, i) => visitar(a, saltar || NO_TEXTO.test(f), LLAMADAS.test(f) && i === 0))
      return
    }
    for (const h of hijos(n)) visitar(h, saltar, texto)
  }
  visitar(ast.program as unknown as Nodo)
  const vistos = new Set<string>()
  return out.filter((x) => { const k = `${x.linea}|${x.texto}`; if (vistos.has(k)) return false; vistos.add(k); return true }).sort((a, b) => a.linea - b.linea)
}

/** Carpetas de pantallas que revisa la regla (las dos apps y el diseño compartido). */
export const PANTALLAS = ['apps/paila/ui/src', 'apps/napia/ui/src', 'packages/diseno/src']

/** Todos los archivos de pantalla, con ruta relativa con "/". */
export function archivosDePantalla(raiz: string): string[] {
  return PANTALLAS.flatMap((d) => fs.readdirSync(path.join(raiz, d), { recursive: true }).map(String)
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.d\.ts$/.test(f)).map((f) => path.join(d, f).split(path.sep).join('/'))).sort()
}
