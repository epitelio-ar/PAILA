// Ventanas de la Bandeja. "Apartar los que no sirven": primero la vista previa de lo que va a no-sirvió, y recién al confirmar se mueve.
// Las copias mejores ya no se reemplazan desde acá: se proponen solo en Sonido de un vistazo y en la barra de arriba (el autor, 13/11).
import { Icon } from './icons'
import { useEffect, useState } from 'react'
import type { InboxAddPlan, InboxPlan } from '@paila/shared/types'
import { n } from './format'
import { toast } from './toast'
import { Ventana, Boton, Pildora, Rico } from '@paila/diseno'
import { textos } from '@paila/shared/idioma'
import { ConfirmarBoton, type ResultadoTanda } from './Confirmar'

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
const T = textos({
  titulo: { es: 'Apartar los que no sirven', en: "Set aside the ones that don't qualify" },
  desc: {
    es: 'Esto es una **vista previa**: todavía no se tocó nada. Son el mismo tema que uno tuyo pero no son mejores: al confirmar pasan a la carpeta **no-sirvió** de la Bandeja, con el motivo en {motivos}. No se borra nada, y queda en el Historial. Las copias mejores no están acá: se aplican desde **Sonido de un vistazo** o la barra de arriba.',
    en: "This is a **preview**: nothing has been touched yet. They're the same track as one of yours but they aren't better: when you confirm they move to the Inbox's **no-sirvió** folder, with the reason in {motivos}. Nothing is deleted, and it goes into History. Better copies aren't here: they're applied from **Sound at a glance** or the bar at the top.",
  },
  armando: { es: 'Armando la vista previa…', en: 'Building the preview…' },
  nadaApartar: { es: 'No hay nada para apartar.', en: 'There is nothing to set aside.' },
  vanNoSirvio: { es: (c: string) => `Van a «no-sirvió» (${c})`, en: (c: string) => `Going to «no-sirvió» (${c})` },
  aplicando: { es: 'Apartando…', en: 'Setting aside…' },
  apartar: { es: (c: string, k: number) => `Apartar ${c} ${k === 1 ? 'archivo' : 'archivos'}`, en: (c: string, k: number) => `Set aside ${c} ${k === 1 ? 'file' : 'files'}` },
  apartarPreg: { es: (c: string, k: number) => `¿Apartar ${c} ${k === 1 ? 'archivo' : 'archivos'} en «no-sirvió»?`, en: (c: string, k: number) => `Set aside ${c} ${k === 1 ? 'file' : 'files'} in «no-sirvió»?` },
  cerrar: { es: 'Cerrar', en: 'Close' },
  hecho: { es: (rej: string) => `${rej} apartados en «no-sirvió».`, en: (rej: string) => `${rej} set aside in «no-sirvió».` },
  // Pasar a tu Música
  tituloPasar: { es: 'Pasar a tu Música', en: 'Move to your Music' },
  descPasar: {
    es: 'Esto es una **vista previa**: todavía no se tocó nada. Los temas que llegaron y no tenías pasan a la carpeta **Recibidos** de tu Música, con el mismo nombre (si ya hay uno igual, le suma un número). Después PAILA los escanea y los analiza; con **Organizar carpetas** los acomodás como al resto. Queda en el Historial y se puede deshacer: vuelven a la Bandeja.',
    en: "This is a **preview**: nothing has been touched yet. The tracks that arrived and you didn't have move to the **Recibidos** folder in your Music, with the same name (if one already exists, it adds a number). After that PAILA scans and analyzes them; with **Organize folders** you put them away like the rest. It goes into History and you can undo it: they go back to the Inbox.",
  },
  armandoVista: { es: 'Armando la vista previa…', en: 'Building the preview…' },
  noConectada: { es: 'La carpeta de tu Música no está conectada.', en: "Your Music folder isn't connected." },
  van: { es: 'Van a {carpeta}', en: 'They go to {carpeta}' },
  sinNuevos: { es: 'No hay temas nuevos para pasar.', en: 'There are no new tracks to move.' },
  teFaltaba: { es: 'te faltaba', en: 'you were missing it' },
  nuevo: { es: 'nuevo', en: 'new' },
  pasando: { es: 'Pasando…', en: 'Moving…' },
  pasar: { es: (c: string, k: number) => `Pasar ${c} ${k === 1 ? 'tema' : 'temas'} a tu Música`, en: (c: string, k: number) => `Move ${c} ${k === 1 ? 'track' : 'tracks'} to your Music` },
  pasarPreg: { es: (c: string, k: number) => `¿Pasar ${c} ${k === 1 ? 'tema' : 'temas'} a tu Música?`, en: (c: string, k: number) => `Move ${c} ${k === 1 ? 'track' : 'tracks'} to your Music?` },
  pasaron: {
    es: (c: string, k: number, folder: string) => `${c} ${k === 1 ? 'tema pasó' : 'temas pasaron'} a tu Música (${folder}).`,
    en: (c: string, k: number, folder: string) => `${c} ${k === 1 ? 'track' : 'tracks'} moved to your Music (${folder}).`,
  },
})

/** Lo que se aparta desde la Bandeja: solo lo que no sirve. Las copias mejores se proponen en Sonido y en la barra de arriba (13/11). */
export const soloApartar = (p: InboxPlan): InboxPlan => ({ ...p, replace: [], rekordbox: 0 })

export function InboxPlanModal({ onClose, onDone }: { onClose: () => void; onDone: (r: ResultadoTanda) => void }) {
  const [plan, setPlan] = useState<InboxPlan | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { window.paila.inboxPlan().then((p) => setPlan(soloApartar(p))).catch((e) => { toast(clean(e), 'error'); onClose() }) }, [onClose])

  const apply = async () => {
    if (!plan) return
    setBusy(true)
    try {
      const r = await window.paila.inboxApply(plan)
      onDone({ hechos: T.hecho(n(r.rejected)), fallados: r.failed, deshacer: 'historial' })
    } catch (e) { toast(clean(e), 'error'); setBusy(false) }
  }

  return (
    <Ventana onClose={onClose} busy={busy} className="rep-modal">
        <h2>{T.titulo}</h2>
        <p className="muted small">
          <Rico texto={T.desc} partes={{ motivos: <i>motivos.txt</i> }} />
        </p>
        {!plan ? <p className="muted">{T.armando}</p> : (
          <>
            <h4>{T.vanNoSirvio(n(plan.reject.length))}</h4>
            {plan.reject.length === 0 && <p className="muted small">{T.nadaApartar}</p>}
            <div className="box-list">
              {plan.reject.map((r) => <div key={r.path} className="box-row muted small" style={{ gridTemplateColumns: '1fr', cursor: 'default' }}><span><b>{r.name}</b>: {r.reason}</span></div>)}
            </div>
            <div className="modal-pie">
              <ConfirmarBoton disabled={busy || !plan.reject.length} onSi={apply} deshacer="historial" pregunta={T.apartarPreg(n(plan.reject.length), plan.reject.length)}>
                {busy ? T.aplicando : T.apartar(n(plan.reject.length), plan.reject.length)}</ConfirmarBoton>
              <Boton variant="ghost" disabled={busy} onClick={onClose}>{T.cerrar}</Boton>
            </div>
          </>
        )}
    </Ventana>
  )
}

/**
 * "Pasar a tu Música" (decidido el 22/10): los temas de la Bandeja que no tenías, con casillas. Primero la
 * vista previa (adónde va cada uno, en la carpeta Recibidos de tu Música); al confirmar se mueven, quedan en el Historial
 * y se pueden deshacer (vuelven a la Bandeja). Después PAILA los escanea y los analiza como a cualquier tema.
 */
export function InboxAddModal({ onClose, onDone }: { onClose: () => void; onDone: (r: ResultadoTanda) => void }) {
  const [plan, setPlan] = useState<InboxAddPlan | null>(null)
  const [off, setOff] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  useEffect(() => { window.paila.inboxAddPlan().then(setPlan).catch((e) => { toast(clean(e), 'error'); onClose() }) }, [onClose])
  const chosen = plan ? plan.items.filter((x) => !off.has(x.path)) : []
  const flip = (p: string) => setOff((s) => { const o = new Set(s); if (o.has(p)) o.delete(p); else o.add(p); return o })

  const apply = async () => {
    if (!plan) return
    setBusy(true)
    try {
      const r = await window.paila.inboxAddApply(plan, chosen.map((x) => x.path))
      onDone({ hechos: T.pasaron(n(r.added), r.added, r.folder), fallados: r.failed, deshacer: 'historial' })
    } catch (e) { toast(clean(e), 'error'); setBusy(false) }
  }

  return (
    <Ventana onClose={onClose} busy={busy} className="rep-modal">
      <h2>{T.tituloPasar}</h2>
      <p className="muted small">
        <Rico texto={T.descPasar} />
      </p>
      {!plan ? <p className="muted">{T.armandoVista}</p> : !plan.root ? <p className="warn-inline"><Icon name="alert" size={13} className="ic-inline" /> {T.noConectada}</p> : (
        <>
          <p className="small"><Rico texto={T.van} partes={{ carpeta: <b>{plan.folder}</b> }} /></p>
          {plan.items.length === 0 && <p className="muted small">{T.sinNuevos}</p>}
          <div className="box-list">
            {plan.items.map((x) => (
              <label key={x.path} className="box-row" style={{ gridTemplateColumns: 'auto 1fr auto', cursor: 'pointer' }} title={x.why}>
                <input type="checkbox" checked={!off.has(x.path)} disabled={busy} onChange={() => flip(x.path)} />
                <span className="small"><b>{x.artist && x.title ? `${x.artist} - ${x.title}` : x.name}</b> <span className="muted">→ {x.rel}</span></span>
                <Pildora tone={x.decision === 'falta' ? 'ok' : 'neutro'}>{x.decision === 'falta' ? T.teFaltaba : T.nuevo}</Pildora>
              </label>
            ))}
          </div>
          <div className="modal-pie">
            <ConfirmarBoton disabled={busy || !chosen.length} onSi={apply} deshacer="historial" pregunta={T.pasarPreg(n(chosen.length), chosen.length)}>{busy ? T.pasando : T.pasar(n(chosen.length), chosen.length)}</ConfirmarBoton>
            <Boton variant="ghost" disabled={busy} onClick={onClose}>{T.cerrar}</Boton>
          </div>
        </>
      )}
    </Ventana>
  )
}
