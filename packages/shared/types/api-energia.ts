// Los pedidos de la interfaz para la energía a tu oído (marcar y calibrar, core/energiamarcas.ts) y el modelo de estilos que
// se baja aparte (core/analysis/effnetrun.ts). Aparte de api.ts para que no crezca: PailaApi los extiende.
import type { EnergyCalibrateResult, EnergyMarksState, EnergyMarkTrack, SoundStyleInfo } from './dj'

export interface EnergiaApi {
  /** Temas para marcar su energía, repartidos entre lo tranqui y lo más arriba (los de tus playlists primero). */
  energyCandidates(n?: number): Promise<EnergyMarkTrack[]>
  energyMarks(): Promise<EnergyMarksState>
  /** Marca (1–10) o desmarca (null) la energía de un tema. */
  energyMark(fileId: number, value: number | null): Promise<EnergyMarksState>
  /** Ajusta la energía de toda la Música a tus marcas (hacen falta al menos `min`). */
  energyCalibrate(): Promise<EnergyCalibrateResult>
  /** Vuelve a la energía de fábrica (las marcas quedan). Devuelve cuántos temas cambiaron. */
  energyReset(): Promise<number>
  /** El modelo de estilos: si está, cuánto pesa y cuánto falta escuchar. */
  soundStyleInfo(): Promise<SoundStyleInfo>
  /** Lo baja de la UPF (proceso en segundo plano 'estilo-modelo') y verifica cada archivo. */
  soundStyleDownload(): Promise<SoundStyleInfo>
  /** Borra el modelo (lo ya escuchado queda). */
  soundStyleRemove(): Promise<SoundStyleInfo>
}
