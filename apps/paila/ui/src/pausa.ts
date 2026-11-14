// Qué dice la pausa del análisis, igual arriba (barra) y en la pantalla Análisis: si la pausó PAILA para otra cosa (separar voz,
// grillas, cambiar archivos), lo dice y aclara en qué pasada iba. En la prueba de la persona 1 (31/10) solo decía "En pausa" y la
// pantalla mostraba "300 de 300" y "148 de 299" sin explicar que eran dos pasadas distintas.
import type { ScanStatus } from '@paila/shared/types'
import { T } from './App.textos'

const QUE: Record<string, () => string> = { separar: () => T.pausaSeparar, grilla: () => T.pausaGrilla }

/** "En pausa mientras se separa la voz", "En pausa: se desconectó F:", "En pausa (a batería)" o "En pausa". */
export function textoPausa(s: ScanStatus): string {
  if (s.waitingDisk) return /^[A-Z]:$/.test(s.waitingDisk) ? T.enPausaDisco(s.waitingDisk) : T.enPausaNoEsta(s.waitingDisk.split(/[\/]/).pop() ?? '')
  if (s.heldBy) return T.enPausaPor(QUE[s.heldBy]?.() ?? s.heldBy)
  return s.pauseReason ? T.enPausaBateria : T.enPausa
}

/** La pasada en la que iba ("Pasada precisa: confirmando BPM y tono…"), sin los puntos suspensivos del final. */
export const pasada = (s: ScanStatus) => s.phase.replace(/…$/, '')
