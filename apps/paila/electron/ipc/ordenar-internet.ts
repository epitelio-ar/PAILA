// Ordenar e internet, una sola vez (MASTERPLAN-5, etapa 3; core/revision-internet.ts): con el OK, corren solos los trabajos de
// internet de siempre, uno detrás del otro (nombres oficiales, MusicBrainz, tapas), y después de cada uno lo seguro se suma a la
// lista tildado y lo dudoso sin tildar. Cada trabajo se ve en su panel como siempre y se puede cancelar; la pantalla Ordenar
// muestra "Internet: X de Y buscados". Lo usa ipc/ordenar.ts.
import { anotarBusqueda, deMusicBrainz, limpiarDescartados, sumarSinTildar, tocaBuscar } from '@paila/core/revision-internet'
import type { Ctx } from '../context'

export function internetDeOrdenar(c: Ctx, rearmar: () => Promise<unknown>, avisar: () => void) {
  let corriendo: Promise<void> | null = null
  /** Corre un trabajo; si falla (sin internet, cancelado) o ya estaba corriendo desde otra pantalla, sigue con el próximo. */
  const paso = async (f?: () => Promise<unknown>) => { try { await f?.() } catch { /* lo dice su panel */ } }

  const vuelta = async () => {
    const t = c.internet ?? {}
    // 1. nombres oficiales: los de confianza alta los suma armar (la regla 'oficial', core/tidy-official.ts)
    await paso(t.nombres)
    await rearmar(); avisar()
    // 2. MusicBrainz: el disco, el año y el n.º que faltan
    await paso(t.mb)
    const { seguros, dudosos } = deMusicBrainz(c.musicbrainz.proposals())
    if (seguros.length) c.changes.stageMany(seguros, 'internet')
    sumarSinTildar(c.lib.db, c.changes, dudosos)
    // lo que la versión anterior sumó sin tildar y hoy no se propone (discos y años de recopilaciones) sale de la lista
    limpiarDescartados(c.lib.db, c.changes, (id) => c.musicbrainz.cached(id)?.result ?? null)
    await rearmar(); avisar()
    // 3. tapas: al final, así la tapa va a la carpeta nueva (Aplicar pone las tapas después de mover)
    await paso(t.tapas)
    await rearmar()
    anotarBusqueda(c.lib.db)
  }

  return {
    corriendo: () => corriendo != null,
    /** Una vuelta, si no hay otra en marcha. `siToca`: solo si pasó un día desde la última (al entrar a Ordenar). */
    correr(siToca = false) {
      if (corriendo || (siToca && !tocaBuscar(c.lib.db))) return
      corriendo = vuelta().catch(() => { /* cada paso ya avisó */ }).finally(() => { corriendo = null; avisar() })
      avisar()
    },
  }
}
