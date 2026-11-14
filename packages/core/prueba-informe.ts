// Informe de una prueba con personas (modo prueba): de las líneas del registro (core/prueba.ts) saca tiempo por tarea, tiempo
// por pantalla y dónde se trabó la persona, y lo escribe en Markdown. Puro: las fotos del video las saca scripts/prueba-informe.ts.
import { NOMBRE_TAREA, NO_SOLA, TAREAS, type LineaPrueba, type TareaPrueba } from './prueba'

export interface TramoTarea { tarea: TareaPrueba; desde: number; hasta: number | null; hecha: boolean; detalle: string }
export interface Traba { seg: number; pantalla: string; motivo: string }
export interface ResumenPrueba {
  duracion: number
  tareas: TramoTarea[]
  pantallas: { pantalla: string; visitas: number; seg: number }[]
  trabas: Traba[]
  avisos: LineaPrueba[]
  /** Lo que decían los trabajos en marcha (cada 15 s, solo cuando cambia el tiempo restante o el ritmo). */
  trabajos: LineaPrueba[]
  errores: LineaPrueba[]
  busquedas: LineaPrueba[]
  clics: number
}

/** Cuánto sin avanzar en una pantalla ya cuenta como "se trabó", y cuántas vueltas a la misma pantalla. */
export const LIMITES = { quieto: 90, clicsSinAvanzar: 15, vueltas: 3, ventanaVueltas: 180, clicsEnNada: 3 }

/**
 * Los tramos de cada tarea. Si el autor marcó el comienzo de las tareas (Ctrl+Mayús+F1…F5), mandan las marcas; si no, cada
 * tarea empieza cuando terminó la anterior que se cumplió ("mirar" termina cuando empieza la primera que se cumple).
 */
function tramos(lineas: LineaPrueba[]): TramoTarea[] {
  const hechas = new Map<TareaPrueba, LineaPrueba & { tipo: 'tarea' }>()
  for (const l of lineas) if (l.tipo === 'tarea' && !hechas.has(l.tarea)) hechas.set(l.tarea, l)
  const marcas = new Map<number, number>()
  for (const l of lineas) if (l.tipo === 'marca' && !marcas.has(l.tarea)) marcas.set(l.tarea, l.seg)
  const tramosConMarcas = () => TAREAS.map((t, i) => {
    const desde = marcas.get(i + 1) ?? null
    const h = hechas.get(t)
    const siguiente = [...marcas.entries()].filter(([n, s]) => n > i + 1 && desde != null && s > desde).map(([, s]) => s).sort((a, b) => a - b)[0]
    return { tarea: t, desde: desde ?? -1, hasta: h ? h.seg : siguiente ?? null, hecha: !!h, detalle: h?.detalle ?? '' }
  }).filter((x) => x.desde >= 0)
  if (marcas.size) return tramosConMarcas()
  const orden = [...hechas.values()].sort((a, b) => a.seg - b.seg)
  const r: TramoTarea[] = [{ tarea: TAREAS[0], desde: 0, hasta: orden[0]?.seg ?? null, hecha: false, detalle: '' }]
  let desde = 0
  for (const h of orden) { r.push({ tarea: h.tarea, desde, hasta: h.seg, hecha: true, detalle: h.detalle }); desde = h.seg }
  for (const t of TAREAS) if (!NO_SOLA.has(t) && !hechas.has(t)) r.push({ tarea: t, desde, hasta: null, hecha: false, detalle: '' })
  return r
}

export function resumir(lineas: LineaPrueba[]): ResumenPrueba {
  const fin = lineas.length ? lineas[lineas.length - 1].seg : 0
  const visitas = lineas.filter((l): l is LineaPrueba & { tipo: 'pantalla' } => l.tipo === 'pantalla')
  const porPantalla = new Map<string, { visitas: number; seg: number }>()
  const trabas: Traba[] = []
  const tareasEn = lineas.filter((l) => l.tipo === 'tarea').map((l) => l.seg)
  visitas.forEach((v, i) => {
    const hasta = visitas[i + 1]?.seg ?? fin
    const p = porPantalla.get(v.pantalla) ?? { visitas: 0, seg: 0 }
    p.visitas++; p.seg += hasta - v.seg
    porPantalla.set(v.pantalla, p)
    const dentro = lineas.filter((l) => l.seg >= v.seg && l.seg < hasta)
    const clics = dentro.filter((l) => l.tipo === 'clic')
    const avanzo = tareasEn.some((s) => s >= v.seg && s <= hasta)
    if (avanzo) return
    if (hasta - v.seg >= LIMITES.quieto && clics.length <= 2) trabas.push({ seg: v.seg, pantalla: v.pantalla, motivo: `${Math.round(hasta - v.seg)} s casi sin tocar nada (${clics.length} clics)` })
    else if (clics.length >= LIMITES.clicsSinAvanzar) trabas.push({ seg: v.seg, pantalla: v.pantalla, motivo: `${clics.length} clics en ${Math.round(hasta - v.seg)} s sin cumplir ninguna tarea` })
    const enNada = clics.filter((l) => l.tipo === 'clic' && !l.boton)
    if (enNada.length >= LIMITES.clicsEnNada) trabas.push({ seg: enNada[0].seg, pantalla: v.pantalla, motivo: `${enNada.length} clics en cosas que no son botones (${[...new Set(enNada.map((l) => (l as { texto: string }).texto || '¿?'))].slice(0, 3).join(' · ')})` })
  })
  // ir y venir: la misma pantalla varias veces en poco tiempo
  const avisadas = new Set<string>()
  for (const v of visitas) {
    const cerca = visitas.filter((w) => w.pantalla === v.pantalla && w.seg >= v.seg && w.seg - v.seg <= LIMITES.ventanaVueltas)
    if (cerca.length < LIMITES.vueltas || avisadas.has(v.pantalla)) continue
    avisadas.add(v.pantalla) // una vez por pantalla alcanza
    trabas.push({ seg: v.seg, pantalla: v.pantalla, motivo: `entró ${cerca.length} veces en ${LIMITES.ventanaVueltas / 60} min (va y viene)` })
  }
  const errores = lineas.filter((l) => l.tipo === 'error' || (l.tipo === 'aviso' && l.clase === 'error'))
  for (const e of errores) trabas.push({ seg: e.seg, pantalla: (e as { pantalla?: string }).pantalla ?? '', motivo: `error: ${(e as { texto: string }).texto}` })
  trabas.sort((a, b) => a.seg - b.seg)
  return {
    duracion: fin,
    tareas: tramos(lineas),
    pantallas: [...porPantalla.entries()].map(([pantalla, x]) => ({ pantalla, visitas: x.visitas, seg: Math.round(x.seg) })).sort((a, b) => b.seg - a.seg),
    trabas,
    avisos: lineas.filter((l) => l.tipo === 'aviso' || l.tipo === 'ventana'),
    trabajos: lineas.filter((l, i, a) => l.tipo === 'trabajo' && a.slice(0, i).reverse().find((x) => x.tipo === 'trabajo')?.['texto' as never] !== l.texto),
    errores,
    busquedas: lineas.filter((l) => l.tipo === 'escribe'),
    clics: lineas.filter((l) => l.tipo === 'clic').length,
  }
}

/** 75 → "1:15"; 3700 → "1:01:40". */
export function reloj(seg: number) {
  const s = Math.max(0, Math.round(seg)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  const dos = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${dos(m)}:${dos(r)}` : `${m}:${dos(r)}`
}

/** El informe en Markdown. `foto(seg)` da la foto del video más cercana a ese segundo (ruta relativa al informe) o null. */
export function informeMarkdown(persona: string, fecha: string, lineas: LineaPrueba[], foto: (seg: number) => string | null = () => null) {
  const r = resumir(lineas)
  const conFoto = (seg: number) => { const f = foto(seg); return f ? ` · [foto](${f})` : '' }
  const out: string[] = [
    `# Prueba con personas: ${persona} (${fecha})`, '',
    `Duración: **${reloj(r.duracion)}** · ${r.clics} clics · ${r.pantallas.length} pantallas distintas · ${r.errores.length} errores.`, '',
    '## Tiempo por tarea', '', '| Tarea | Desde | Hasta | Tiempo | Resultado |', '|---|---|---|---|---|',
    ...r.tareas.map((t) => `| ${NOMBRE_TAREA[t.tarea]} | ${reloj(t.desde)} | ${t.hasta == null ? '—' : reloj(t.hasta)} | ${t.hasta == null ? '—' : reloj(t.hasta - t.desde)} | ${t.hecha ? 'cumplida' : NO_SOLA.has(t.tarea) ? 'no se detecta sola: hasta la primera tarea cumplida' : 'sin cumplir'}${t.detalle ? `: ${t.detalle}` : ''} |`),
    '', '## Dónde se trabó', '',
    ...(r.trabas.length ? r.trabas.map((t) => `- **${reloj(t.seg)}** en *${t.pantalla || '¿?'}*: ${t.motivo}${conFoto(t.seg)}`) : ['- No hubo trabas que se noten en el registro.']),
    '', '## Pantallas visitadas', '', '| Pantalla | Veces | Tiempo |', '|---|---|---|',
    ...r.pantallas.map((p) => `| ${p.pantalla} | ${p.visitas} | ${reloj(p.seg)} |`),
  ]
  if (r.busquedas.length) out.push('', '## Lo que escribió', '', ...r.busquedas.map((b) => `- ${reloj(b.seg)} en *${(b as { donde: string }).donde}*: "${(b as { texto: string }).texto}"`))
  if (r.trabajos.length) out.push('', '## Lo que decían los trabajos en marcha', '', ...r.trabajos.map((t) => `- ${reloj(t.seg)} ${t.tipo === 'trabajo' ? t.texto : ''}`))
  if (r.avisos.length) out.push('', '## Avisos y ventanas que vio', '', ...r.avisos.map((a) => `- ${reloj(a.seg)} ${a.tipo === 'ventana' ? `ventana: ${a.titulo}` : a.tipo === 'aviso' ? `aviso (${a.clase}): ${a.texto}` : ''}`))
  out.push('', '## Recorrido', '', ...lineas.filter((l) => l.tipo === 'pantalla' || l.tipo === 'tarea' || l.tipo === 'marca').map((l) =>
    l.tipo === 'pantalla' ? `- ${reloj(l.seg)} → ${l.pantalla}${conFoto(l.seg)}` : l.tipo === 'tarea' ? `- ${reloj(l.seg)} **tarea cumplida: ${NOMBRE_TAREA[l.tarea]}** (${l.detalle})${conFoto(l.seg)}` : l.tipo === 'marca' ? `- ${reloj(l.seg)} *empieza la tarea ${l.tarea}*` : ''))
  return out.join('\n') + '\n'
}
