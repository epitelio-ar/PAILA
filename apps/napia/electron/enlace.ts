// El enlace con PAILA (core/sockseek/enlace.ts): cada 2 s NAPIA deja en sus datos en qué anda (lo arma core/sockseek/enlace-armar.ts):
// la lista que baja, cuánto falta, qué llegó trucho, lo último que pasó y qué le falta para poder bajar. PAILA lo muestra arriba en
// Sonido, sin cambiar de ventana (MASTERPLAN-5, etapa 5). Lo que le falta a NAPIA (sockseek, la cuenta, la carpeta) se mira cada
// 30 s: mirarlo cada 2 s abriría procesos de más (buscar SoulseekQt).
import { app } from 'electron'
import { escribirEnlace, type FaltaNapia, type FinLista } from '@paila/core/sockseek/enlace'
import { armarEnlace, ultimoDe } from '@paila/core/sockseek/enlace-armar'
import type { RunStatus, TrackProgress } from '@paila/shared/napia'

export interface DatosEnlace { st: RunStatus; fin: FinLista | null; enEspera: number; carpeta: string | null }

/** Empieza a escribir el enlace. `falta`: qué le falta para bajar (se llama cada 30 s). */
export function enlazarConPaila(datos: () => DatosEnlace, falta: () => FaltaNapia | null) {
  let lista: string | null = null, orden: TrackProgress[] = [], vistos = new Set<string>()
  let faltaHoy: FaltaNapia | null = null, mirado = 0
  const t = setInterval(() => {
    try {
      const d = datos()
      if (Date.now() - mirado > 30_000) { faltaHoy = falta(); mirado = Date.now() }
      // lo que termina, en el orden en que termina (lo último va primero en PAILA)
      if (d.st.listName !== lista) { lista = d.st.listName; orden = []; vistos = new Set() }
      for (const tr of d.st.tracks) {
        const k = `${tr.artist}|${tr.title}`, u = ultimoDe(tr)
        if (u && !vistos.has(k)) { vistos.add(k); orden.push(tr) }
      }
      const vivos = new Map(d.st.tracks.map((tr) => [`${tr.artist}|${tr.title}`, tr]))
      escribirEnlace(app.getPath('userData'), armarEnlace(d.st, { carpeta: d.carpeta, fin: d.fin, enEspera: d.enEspera, falta: faltaHoy }, orden.map((tr) => vivos.get(`${tr.artist}|${tr.title}`) ?? tr)))
    } catch { /* sin permiso: PAILA no se entera, NAPIA sigue */ }
  }, 2000)
  app.once('will-quit', () => clearInterval(t))
  /** Que lo próximo mire de nuevo qué falta (al confirmar la carpeta o poner la cuenta). */
  return { mirarDeNuevo: () => { mirado = 0 } }
}
