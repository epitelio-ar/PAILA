// La calidad real en la pantalla de NAPIA (la revisión está en packages/core/sockseek/control.ts): cómo se ve cada tema revisado
// (su nota, o por qué era trucho y si llegó otra copia) y el resumen de la lista: cuántos llegaron truchos, cuántos se
// reemplazaron por otra fuente y cuántos solo se encontraron en calidad falsa, con una ⓘ que lo explica. También lo usa el Historial.
// Lo que viene a reemplazar una copia tuya (la lista «Faltan o suenan mal» de PAILA) además tiene que ser mejor que esa: si una copia
// está bien pero no es mejor, se dice así ("No es mejor"), y si no aparece ninguna, "No se encontró una copia mejor que la tuya".
import { Info, type TonoPildora } from '@paila/diseno'
import type { CuentaCalidad, MotivoTrucho, RevisionCalidad, TrackProgress } from '@paila/shared/napia'
import { textos } from '@paila/shared/idioma'
import { n } from './textos'

export const TC = textos({
  revisando: { es: 'Revisando', en: 'Checking' },
  trucho: { es: 'Trucho', en: 'Bogus' },
  noEsMejor: { es: 'No es mejor', en: 'Not better' },
  lenta: { es: 'Lenta', en: 'Slow' },
  otraFuente: { es: 'Otra fuente', en: 'Other source' },
  reemplazado: { es: 'Reemplazado', en: 'Replaced' },
  soloFalsa: { es: 'Solo trucho', en: 'Only bogus' },
  sinMejor: { es: 'Sin mejora', en: 'No upgrade' },
  revisandoSub: { es: 'Revisando la calidad real…', en: 'Checking the real quality…' },
  nota: { es: (nota: string, es: string) => `Nota ${nota} · ${es}`, en: (nota: string, es: string) => `Grade ${nota} · ${es}` },
  mejorQueTuya: { es: (nota: string) => `mejor que la tuya (nota ${nota})`, en: (nota: string) => `better than yours (grade ${nota})` },
  descartadoPorque: { es: (m: string) => `Descartado: ${m}`, en: (m: string) => `Discarded: ${m}` },
  llegoTrucho: { es: 'Llegó trucho', en: 'It arrived bogus' },
  ibaLenta: { es: 'La fuente iba muy lenta', en: 'The source was very slow' },
  otraVersion: { es: 'Otra versión', en: 'Another version' },
  eraOtra: { es: (v: string) => `Llegó otra versión (${v}), no la que pediste`, en: (v: string) => `Another version arrived (${v}), not the one you asked for` },
  lentaSub: { es: 'La fuente iba muy lenta (le faltaban más de 5 minutos): se cortó y en seguida se prueba otra.', en: 'The source was very slow (over 5 minutes to go): it was cut and another one is tried right away.' },
  noMejorQueTuya: { es: (nota: string) => `No era mejor que la tuya (nota ${nota})`, en: (nota: string) => `It wasn't better than yours (grade ${nota})` },
  // i: cuántas veces se buscó otra fuente (la 1.ª vuelta trae la 2.ª fuente); avance: cuánto bajó de esa
  buscandoOtra: {
    es: (por: string, i: number, avance?: number | null) => `${por}: probando la ${i + 1}.ª fuente${avance != null ? ` · ${Math.round(avance)} %` : '…'}`,
    en: (por: string, i: number, avance?: number | null) => `${por}: trying source no. ${i + 1}${avance != null ? ` · ${Math.round(avance)}%` : '…'}`,
  },
  revisandoOtra: { es: (i: number) => `Revisando la calidad real de la ${i + 1}.ª fuente…`, en: (i: number) => `Checking the real quality of source no. ${i + 1}…` },
  esperaOtra: { es: (por: string) => `${por}: apenas termine este tramo de la lista, se busca otra fuente.`, en: (por: string) => `${por}: as soon as this part of the list ends, another source is tried.` },
  enLaMuestra: { es: (m: string) => `Mientras bajaba, un pedazo ya sonaba trucho (${m}): se cortó`, en: (m: string) => `While downloading, a piece already sounded bogus (${m}): it was cut` },
  sonabaTrucho: { es: 'Sonaba trucho', en: 'Sounded bogus' },
  reemplazadoSub: { es: (d: number) => `Llegó trucho ${d === 1 ? 'una vez' : `${d} veces`}; esta copia de otra fuente está bien`, en: (d: number) => `It arrived bogus ${d === 1 ? 'once' : `${d} times`}; this copy from another source is fine` },
  reemplazadoOtraSub: { es: (v: string) => `Primero llegó otra versión (${v}); esta copia de otra fuente es la que pediste`, en: (v: string) => `Another version arrived first (${v}); this copy from another source is the one you asked for` },
  reemplazadoTuyaSub: { es: (nota: string) => `Esta copia de otra fuente es mejor que la tuya (nota ${nota})`, en: (nota: string) => `This copy from another source is better than yours (grade ${nota})` },
  soloFalsaSub: { es: 'Solo se encontró en calidad falsa: quedó en «descartados»', en: 'Only found in fake quality: it was left in “descartados”' },
  sinMejorSub: { es: (tuya: string) => `No se encontró una copia mejor que la tuya (${tuya})`, en: (tuya: string) => `Couldn't find a copy better than yours (${tuya})` },
  motivo: {
    es: (m: MotivoTrucho) => ({ inflado: 'MP3 inflado', sinPerdidaFalso: 'sin pérdida falso', danado: 'archivo dañado', peorQuePedido: 'mucho peor que lo pedido', noEsMejor: 'no es mejor que la tuya', lenta: 'fuente muy lenta', otraVersion: 'otra versión' })[m],
    en: (m: MotivoTrucho) => ({ inflado: 'inflated MP3', sinPerdidaFalso: 'fake lossless', danado: 'damaged file', peorQuePedido: 'much worse than requested', noEsMejor: 'not better than yours', lenta: 'very slow source', otraVersion: 'another version' })[m],
  },
  cifra: { es: 'descartados por calidad falsa', en: 'discarded for fake quality' },
  cifraConTuyas: { es: 'descartados (truchos o no mejores que los tuyos)', en: 'discarded (bogus or not better than yours)' },
  resumen: {
    es: (d: number, r: number, f: number, m: number) => {
      const partes = [r && (r === 1 ? '1 se reemplazó por otra fuente' : `${n(r)} se reemplazaron por otra fuente`), f && (f === 1 ? '1 solo se encontró trucho' : `${n(f)} solo se encontraron truchos`),
        m && (m === 1 ? '1 sin una copia mejor que la tuya' : `${n(m)} sin una copia mejor que la tuya`)].filter(Boolean)
      const llegaron = d === 1 ? '1 tema llegó' : `${n(d)} temas llegaron`
      return `${llegaron} ${m ? 'en una copia que no servía (trucha o no mejor que la tuya)' : 'con calidad falsa'}${partes.length ? `: ${partes.join(', ').replace(/, ([^,]*)$/, ' y $1')}` : ''}.`
    },
    en: (d: number, r: number, f: number, m: number) => {
      const parts = [r && `${n(r)} replaced from another source`, f && `${n(f)} only found bogus`, m && `${n(m)} without a copy better than yours`].filter(Boolean)
      return `${d === 1 ? '1 track' : `${n(d)} tracks`} arrived ${m ? 'in a copy that was no good (bogus or not better than yours)' : 'with fake quality'}${parts.length ? `: ${parts.join(', ').replace(/, ([^,]*)$/, ' and $1')}` : ''}.`
    },
  },
  buscandoAhora: { es: 'Buscando otras fuentes para lo que no sirvió…', en: "Looking for other sources for what was no good…" },
  sinFfmpeg: { es: 'No se puede revisar la calidad real: falta ffmpeg (viene con PAILA).', en: "The real quality can't be checked: ffmpeg is missing (it comes with PAILA)." },
  tip: {
    es: 'NAPIA no se fía de lo que dice cada archivo: apenas baja un tema, le pasa el análisis de calidad de PAILA (mira el espectro, sin tocar el archivo). Si es trucho —un MP3 inflado que dice 320 pero suena a 128, un FLAC que por dentro es un MP3, un archivo dañado o algo mucho peor que lo pedido— lo aparta a la carpeta «descartados» de la lista (no lo borra) y lo busca de nuevo en otro usuario de Soulseek, hasta 3 veces, apenas termina su tramo (la lista baja de a 25 temas: lo trucho no espera al final). Mientras baja, también revisa un pedazo: si ya suena trucho y es lo único que queda bajando, lo corta sin esperar a que termine. Lo mismo con una fuente muy lenta: si al ritmo que va le faltan más de 5 minutos y es lo único que queda bajando, la corta y prueba otro usuario (cuenta como una de esas 3 veces); mientras haya otros temas en marcha, la deja seguir sin frenar a nadie. Si el tema viene a reemplazar uno que ya tenés (desde la lista «Faltan o suenan mal» de PAILA), además tiene que ser claramente mejor que el tuyo, con la misma vara que la Bandeja de PAILA: mejor nota, o la misma nota con más calidad real y entero; sin huecos si el tuyo no los tiene, sin saturar más y con la misma duración. A la Bandeja de PAILA solo llega lo que pasó la revisión.',
    en: "NAPIA doesn't trust what each file says: as soon as a track downloads, it runs PAILA's quality analysis on it (it looks at the spectrum without touching the file). If it's bogus —an inflated MP3 that says 320 but sounds like 128, a FLAC that's really an MP3 inside, a damaged file, or something much worse than requested— it moves it to the list's “descartados” folder (it doesn't delete it) and looks for it again from another Soulseek user, up to 3 times, as soon as its part of the list ends (the list downloads 25 tracks at a time: bogus files don't wait until the end). While downloading, it also checks a piece: if it already sounds bogus and it's the only thing left downloading, it's cut without waiting for it to finish. The same goes for a very slow source: if at its current pace it still needs more than 5 minutes and it's the only thing left downloading, it's cut and another user is tried (it counts as one of those 3 times); while other tracks are still going, it keeps going without holding anyone up. If the track comes to replace one you already have (from PAILA's \"Missing or low quality\" list), it also has to be clearly better than yours, with the same yardstick as PAILA's Inbox: a better grade, or the same grade with more real quality and nothing missing; no gaps if yours has none, no more clipping, and the same length. Only what passed the check reaches PAILA's Inbox.",
  },
})

/** Por qué se descartó la última copia: trucha, o (viene a reemplazar la tuya) no era mejor que esa. */
const porQue = (c: RevisionCalidad) => (c.motivo === 'noEsMejor' && c.tuya ? TC.noMejorQueTuya(c.tuya.nota) : c.motivo === 'lenta' ? TC.ibaLenta : c.motivo === 'otraVersion' ? TC.eraOtra(c.otra ?? '') : TC.llegoTrucho)

/** Cómo se ve un tema con su revisión: tono, palabra y renglón de abajo. null: como cualquier tema (sin revisión que mostrar). */
export function filaCalidad(t: TrackProgress): { tone?: TonoPildora; label?: string; sub: string; activo: boolean } | null {
  const c = t.calidad
  if (!c || c.estado === 'sinRevisar') return null
  const nota = c.nota && c.es ? TC.nota(c.nota, c.es) : ''
  switch (c.estado) {
    case 'revisando': return { tone: 'acento', label: TC.revisando, sub: c.intentos ? TC.revisandoOtra(c.intentos) : TC.revisandoSub, activo: true }
    // la palabra y el tono de siempre (Bajado, Ya estaba); si viene a reemplazar la tuya, que es mejor
    case 'buena': return { sub: c.tuya ? `${nota} · ${TC.mejorQueTuya(c.tuya.nota)}` : nota, activo: false }
    case 'trucho': return c.motivo === 'lenta' ? { tone: 'atencion', label: TC.lenta, sub: TC.lentaSub, activo: true }
      : c.muestra && c.motivo ? { tone: 'atencion', label: TC.sonabaTrucho, sub: TC.esperaOtra(TC.enLaMuestra(TC.motivo(c.motivo))), activo: true }
      : { tone: 'atencion', label: c.motivo === 'noEsMejor' ? TC.noEsMejor : c.motivo === 'otraVersion' ? TC.otraVersion : TC.trucho, sub: `${c.motivo && c.motivo !== 'otraVersion' ? `${TC.descartadoPorque(TC.motivo(c.motivo))} · ` : ''}${TC.esperaOtra(porQue(c))}`, activo: false }
    case 'otraFuente': return { tone: 'atencion', label: TC.otraFuente, sub: TC.buscandoOtra(porQue(c), c.intentos, c.avance), activo: true }
    case 'reemplazado': return { tone: 'ok', label: TC.reemplazado, sub: `${c.tuya ? TC.reemplazadoTuyaSub(c.tuya.nota) : c.motivo === 'otraVersion' ? TC.reemplazadoOtraSub(c.otra ?? '') : TC.reemplazadoSub(c.descartadas + (c.enMuestra ?? 0))}${nota ? ` · ${nota}` : ''}`, activo: false }
    case 'soloFalsa': return { tone: 'error', label: TC.soloFalsa, sub: `${TC.soloFalsaSub}${c.motivo ? ` (${TC.motivo(c.motivo)})` : ''}`, activo: false }
    case 'sinMejor': return { tone: 'atencion', label: TC.sinMejor, sub: TC.sinMejorSub(c.tuya?.que ?? c.tuya?.nota ?? ''), activo: false }
  }
}

/** El renglón del resumen: cuántos llegaron sin servir y qué pasó con ellos (nada si no llegó ninguno). */
export function ResumenCalidad({ cuenta, small }: { cuenta: Pick<CuentaCalidad, 'descartados' | 'reemplazados' | 'soloFalsa'> & Partial<CuentaCalidad>; small?: boolean }) {
  if (cuenta.activa === false) return <p className="muted small">{TC.sinFfmpeg}</p>
  if (!cuenta.descartados && !cuenta.buscandoOtra) return null
  return (
    <p className={small ? 'small' : 'muted small'} style={{ margin: 'var(--sp-1) 0 0' }}>
      {cuenta.descartados > 0 && TC.resumen(cuenta.descartados, cuenta.reemplazados, cuenta.soloFalsa, cuenta.sinMejor ?? 0)}
      {cuenta.buscandoOtra && <> <b>{TC.buscandoAhora}</b></>}
      <Info tip={TC.tip} />
    </p>
  )
}
