// Si otra sesión está midiendo velocidades, los tests esperan para no contaminar la medición (decodifican mucho audio).
// La sesión que mide crea %TEMP%\paila-medicion.lock (qué mide y hasta cuándo) y lo borra al terminar; su propio
// proceso corre con PAILA_MEDICION=1 para no esperarse a sí mismo. Ver AGENTS.es.md, "Trabajo pesado y sesiones en paralelo".
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const LOCK = path.join(os.tmpdir(), 'paila-medicion.lock')

export default async function esperarMedicion() {
  if (process.env.PAILA_MEDICION) return
  const start = Date.now()
  while (fs.existsSync(LOCK)) {
    let age = 0
    try { age = Date.now() - fs.statSync(LOCK).mtimeMs } catch { return } // se borró justo
    if (age > 2 * 3600_000) { console.warn(`[tests] ${LOCK} tiene más de 2 horas: se da por olvidado y se sigue.`); return }
    if (Date.now() - start > 45 * 60_000) { console.warn('[tests] Se esperó 45 minutos a que termine la medición: se sigue igual.'); return }
    let what = ''
    try { what = fs.readFileSync(LOCK, 'utf8').trim() } catch { /* se borró justo */ }
    console.log(`[tests] Hay una medición de velocidad en curso (${what || 'sin detalle'}): espero para no contaminarla…`)
    await new Promise((r) => setTimeout(r, 30_000))
  }
}
