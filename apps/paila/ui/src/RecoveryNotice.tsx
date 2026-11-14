// Aviso en Inicio cuando PAILA se cortó la vez anterior en medio de una operación (luz, cuelgue, cierre forzado):
// qué encontró a medias al abrir y qué hizo con cada cosa (ver core/recovery.ts).
import { useEffect, useState } from 'react'
import type { RecoveryItem, RecoveryReport } from '@paila/shared/types'
import { Boton } from '@paila/diseno'
import { textos, tr } from '@paila/shared/idioma'

const T = textos({
  titulo: { es: 'La última vez PAILA se cerró de golpe', en: 'PAILA closed suddenly last time' },
  explica: { es: 'Puede haber sido un corte de luz, un cuelgue o un cierre forzado. PAILA anota cada paso antes de tocar un archivo, así que al abrir revisó lo que había quedado a medias', en: 'It may have been a power cut, a crash or a forced close. PAILA writes down every step before touching a file, so when it opened it checked what had been left half done' },
  enOrden: { es: ' y lo dejó en orden: no se perdió nada', en: " and put it back in order: nothing was lost" },
  entendido: { es: 'Entendido', en: 'Got it' },
})

const RESULT: Record<RecoveryItem['result'], { label: string; pill: string; help: string }> = {
  completado: { label: tr({ es: 'Terminado', en: 'Finished' }), pill: 'pill-green', help: tr({ es: 'Ya se había hecho: faltaba anotarlo en PAILA y se anotó.', en: 'It was already done: PAILA just had to note it down, and it did.' }) },
  'no-hecho': { label: tr({ es: 'No se hizo', en: 'Not done' }), pill: 'pill-blue', help: tr({ es: 'No se llegó a tocar: quedó como estaba.', en: "It was never touched: it's as it was." }) },
  'vuelto-atras': { label: tr({ es: 'Vuelto atrás', en: 'Rolled back' }), pill: 'pill-blue', help: tr({ es: 'Había quedado a medias: volvió a como estaba antes.', en: 'It was left half done: it went back to how it was before.' }) },
  revisar: { label: tr({ es: 'Para revisar', en: 'To review' }), pill: 'pill-amber', help: tr({ es: 'PAILA no lo pudo resolver solo: leé qué mirar.', en: "PAILA couldn't sort it out by itself: read what to look at." }) },
  pendiente: { label: tr({ es: 'Falta el disco', en: 'Disk missing' }), pill: 'pill-amber', help: tr({ es: 'Está en un disco que no está conectado: cuando lo conectes, PAILA lo revisa sola (no hace falta cerrarla).', en: "It's on a disk that isn't connected: when you connect it, PAILA checks it on its own (no need to close it)." }) },
}

export default function RecoveryNotice() {
  const [rep, setRep] = useState<RecoveryReport | null>(null)
  useEffect(() => { window.paila.recovery().then(setRep).catch(() => {}) }, [])
  useEffect(() => window.paila.onRecovery((r) => setRep(r)), []) // volvió un disco con la app abierta
  if (!rep?.items.length) return null
  const solved = rep.items.length - rep.pending
  return (
    <section className="callout recovery">
      <h3>{T.titulo}</h3>
      <p className="muted">
        {T.explica}{solved ? T.enOrden : ''}.
      </p>
      <ul className="recovery-list">
        {rep.items.map((i) => (
          <li key={i.id}>
            <span className={`pill ${RESULT[i.result].pill}`} title={RESULT[i.result].help}>{RESULT[i.result].label} ⓘ</span>
            <b>{i.op}:</b> {i.message}
          </li>
        ))}
      </ul>
      {solved > 0 && <Boton variant="ghost" size="sm" onClick={() => window.paila.recoverySeen().then(setRep)}>{T.entendido}</Boton>}
    </section>
  )
}
