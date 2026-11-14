// "Para hacer" del Inicio (pedido del autor, 24/10): lo que conviene hacer para que PAILA no junte cosas de más ni parezca
// pesada (la papelera, los respaldos viejos, los cambios sin aplicar, el análisis, una versión nueva, la carpeta de respaldos),
// cada cosa con su botón y cuánto lugar libera. Es del mantenimiento de PAILA: lo de la música está en el Centro de problemas.
// Acá solo se decide qué renglones van y qué dicen (se prueba sin pantalla: tests/para-hacer.test.ts); los dibuja ParaHacer.tsx.
import type { BackupInfo, ScanStatus, TrashSummary, UpdateState } from '@paila/shared/types'
import { cant, num, plural, textos } from '@paila/shared/idioma'
import type { IconName } from './icons'
import { bytes } from './format'

const T = textos({
  pendientes: {
    es: (n: number) => `Tenés **${cant(n, 'cambio pendiente', 'cambios pendientes')}** sin aplicar: no se escriben en los archivos hasta que los aplicás.`,
    en: (n: number) => `You have **${cant(n, 'pending change', 'pending changes')}** not applied yet: nothing is written to the files until you apply them.`,
  },
  analizando: {
    es: (h: number, t: number) => `PAILA está escuchando tus temas: **${num(h)} de ${num(t)}**. Podés seguir usándola mientras tanto.`,
    en: (h: number, t: number) => `PAILA is listening to your tracks: **${num(h)} of ${num(t)}**. You can keep using it meanwhile.`,
  },
  analizandoSolo: { es: 'PAILA está escuchando tus temas. Podés seguir usándola mientras tanto.', en: 'PAILA is listening to your tracks. You can keep using it meanwhile.' },
  pausa: { es: 'El análisis está **en pausa**: lo seguís cuando quieras.', en: 'The analysis is **paused**: pick it up whenever you like.' },
  papelera: {
    es: (b: string, n: number) => `La papelera ocupa **${b}** (${cant(n, 'archivo', 'archivos')}). Lo que mandás ahí no se borra hasta que la vaciás.`,
    en: (b: string, n: number) => `The trash takes up **${b}** (${cant(n, 'file', 'files')}). Whatever you send there isn't deleted until you empty it.`,
  },
  papeleraMucho: { es: ' Ya es bastante: conviene revisarla y vaciarla.', en: " That's quite a lot: it's worth checking and emptying it." },
  respaldos: {
    es: (n: number, b: string) => `**${cant(n, 'respaldo', 'respaldos')}** de hace más de un mes ${plural(n, 'ocupa', 'ocupan')} **${b}**. Si todo quedó bien, ya ${plural(n, 'lo', 'los')} podés mandar a la papelera.`,
    en: (n: number, b: string) => `**${cant(n, 'backup', 'backups')}** older than a month ${plural(n, 'takes', 'take')} up **${b}**. If everything turned out fine, you can send ${plural(n, 'it', 'them')} to the trash.`,
  },
  version: { es: (v: string) => `Hay una versión nueva de PAILA: **${v}**.`, en: (v: string) => `There's a new version of PAILA: **${v}**.` },
  versionLista: { es: (v: string) => `La versión **${v}** ya está bajada: se instala cuando quieras.`, en: (v: string) => `Version **${v}** is already downloaded: install it whenever you like.` },
  carpeta: {
    es: 'Los respaldos se guardan al lado de tu música, en la carpeta _PAILA de cada disco. Si ese disco está justo de lugar, elegí otra carpeta.',
    en: 'Backups are kept next to your music, in the _PAILA folder on each disk. If that disk is short on space, choose another folder.',
  },
})

/** Lo que hace cada botón (ParaHacer.tsx los conecta). */
export type Accion = 'revisarCambios' | 'verAnalisis' | 'verPapelera' | 'vaciar' | 'verRespaldos' | 'verVersion' | 'elegirCarpeta' | 'carpetaOk'
export interface Renglon { key: string; icono: IconName; texto: string; libera: number; atencion: boolean; acciones: Accion[] }
export interface DatosParaHacer {
  papelera: TrashSummary | null
  respaldos: BackupInfo[] | null
  /** null = la de fábrica (al lado de la música); undefined = todavía no se sabe */
  carpetaRespaldos: string | null | undefined
  /** la persona dijo "Así está bien" a la carpeta de fábrica */
  carpetaOk: boolean
  pendientes: number
  scan: ScanStatus
  version: UpdateState | null
  ahora?: number
}

/** Un respaldo "viejo": de hace más de un mes, entero y todavía en su lugar (no en la papelera). */
export const VIEJO_MS = 30 * 24 * 3600_000
export const respaldosViejos = (r: BackupInfo[], ahora = Date.now()) =>
  r.filter((b) => b.complete && b.exists && !b.trashDir && ahora - Date.parse(b.createdAt) > VIEJO_MS)

/** Los renglones, en el orden en que conviene hacerlos (lo que está a medias primero). Vacío: la tarjeta no se muestra. */
export function paraHacer(d: DatosParaHacer): Renglon[] {
  const out: Renglon[] = []
  if (d.pendientes > 0) out.push({ key: 'cambios', icono: 'wand', texto: T.pendientes(d.pendientes), libera: 0, atencion: false, acciones: ['revisarCambios'] })
  const s = d.scan
  if (s.job === 'analysis' && (s.running || s.paused)) {
    const texto = s.paused ? T.pausa : s.toProbe > 0 ? T.analizando(Math.min(s.probed, s.toProbe), s.toProbe) : T.analizandoSolo
    out.push({ key: 'analisis', icono: 'activity', texto, libera: 0, atencion: false, acciones: ['verAnalisis'] })
  }
  const p = d.papelera
  if (p && (p.bytes > 0 || p.files > 0)) {
    out.push({ key: 'papelera', icono: 'trash', texto: T.papelera(bytes(p.bytes), p.files) + (p.warn ? T.papeleraMucho : ''), libera: p.bytes, atencion: p.warn, acciones: ['verPapelera', 'vaciar'] })
  }
  const viejos = d.respaldos ? respaldosViejos(d.respaldos, d.ahora) : []
  if (viejos.length) {
    const b = viejos.reduce((a, x) => a + x.bytes, 0)
    out.push({ key: 'respaldos', icono: 'history', texto: T.respaldos(viejos.length, bytes(b)), libera: b, atencion: false, acciones: ['verRespaldos'] })
  }
  const v = d.version
  if (v?.available && (v.phase === 'hay' || v.phase === 'lista')) {
    out.push({ key: 'version', icono: 'sparkle', texto: v.phase === 'lista' ? T.versionLista(v.available.version) : T.version(v.available.version), libera: 0, atencion: false, acciones: ['verVersion'] })
  }
  // la carpeta de fábrica solo se menciona si ya hay respaldos ocupando lugar al lado de la música
  if (d.carpetaRespaldos === null && !d.carpetaOk && (d.respaldos ?? []).some((b) => b.exists && !b.trashDir)) {
    out.push({ key: 'carpeta', icono: 'folder', texto: T.carpeta, libera: 0, atencion: false, acciones: ['elegirCarpeta', 'carpetaOk'] })
  }
  return out
}
