// Los pedidos de la interfaz para llevar la música a otros programas de DJ (Traktor, Serato, VirtualDJ, Engine DJ: core/djexport.ts)
// y para la salida "bit perfect" con mpv (core/mpv.ts, electron/bitperfect.ts). Aparte de api.ts para que no crezca.
import type { DjExportOptions, DjExportResult, DjApp } from './dj'

export interface BitPerfectInfo {
  /** ¿Está mpv? (viaja con el instalador; en una copia de desarrollo, `npm run mpv:bajar`). */
  available: boolean
  /** Las salidas que se pueden tomar en exclusiva (WASAPI). */
  devices: { id: string; label: string }[]
}

/** Lo que avisa mpv mientras suena. `out` y `in`: cómo sale y cómo está grabado (frecuencia y formato). */
export type BitPerfectEvent =
  | { type: 'time'; time: number }
  | { type: 'duration'; duration: number }
  | { type: 'pause'; paused: boolean }
  | { type: 'playing' }
  | { type: 'ended' }
  | { type: 'error'; message: string }
  | { type: 'format'; in: { samplerate: number; format: string } | null; out: { samplerate: number; format: string } | null; same: boolean | null }
  /** mpv se cerró o el aparato ya no está: PAILA vuelve al reproductor de siempre. */
  | { type: 'lost'; message: string }

export interface LlevarApi {
  bitPerfectInfo(): Promise<BitPerfectInfo>
  /** Toca un tema por la salida exclusiva `device` (arranca mpv si hace falta). */
  bitPerfectLoad(fileId: number, device: string, at?: number): Promise<void>
  bitPerfectPause(paused: boolean): Promise<void>
  bitPerfectSeek(seconds: number): Promise<void>
  /** Suelta el aparato (cierra mpv): los demás programas vuelven a sonar por ahí. */
  bitPerfectStop(): Promise<void>
  onBitPerfect(cb: (e: BitPerfectEvent) => void): () => void
  /** Exportar a Traktor, Serato, VirtualDJ o Engine DJ. null = se canceló al elegir dónde. */
  djExport(app: DjApp, scope: 'todo' | 'playlists', playlistIds: number[], opts: DjExportOptions): Promise<DjExportResult | null>
  /** Dónde va a escribir cada programa (para mostrarlo antes), si el programa está abierto (hay que cerrarlo) y, en Engine DJ, si falta su biblioteca. */
  djExportPlace(app: DjApp): Promise<{ folder: string | null; running: boolean; missing?: boolean }>
}
