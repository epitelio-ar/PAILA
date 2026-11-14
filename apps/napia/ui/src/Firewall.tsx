// El permiso de Windows para sockseek (el firewall), en palabras simples: qué pasa, qué consecuencia tiene y "Arreglarlo",
// que lo cambia con el permiso de Windows una vez. Si la red está marcada como Pública, ofrece abrir la pantalla de Windows
// para marcarla como Privada (lo decide la persona). Aparece arriba solo si algo está mal, y dentro de la guía de la conexión.
// Los textos son los mismos que muestra el Chequeo de PAILA (@paila/shared/firewall).
import { useState } from 'react'
import { Aviso, Boton, Caja, Info, Rico } from '@paila/diseno'
import type { FirewallDiag, ResultadoArreglo } from '@paila/shared/napia'
import { TIP_FIREWALL, arreglandoTexto, textoFirewall, textoResultado } from '@paila/shared/firewall'

interface Props {
  firewall: FirewallDiag
  onCambio: (f: FirewallDiag | null) => void
  /** Dentro de otra caja (la guía de la conexión): sin su propio marco. */
  suelto?: boolean
}

export const partesFirewall = () => ({ info: <Info tip={TIP_FIREWALL.info} />, perfil: <Info tip={TIP_FIREWALL.perfil} />, bloquearTodo: <Info tip={TIP_FIREWALL.bloquearTodo} /> })

export default function Firewall({ firewall: f, onCambio, suelto }: Props) {
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<{ r: ResultadoArreglo; aMano: string | null } | null>(null)
  const t = textoFirewall(f)
  const partes = partesFirewall()
  const arreglar = async () => {
    setBusy(true); setRes(null)
    try {
      const r = await window.napia.arreglarFirewall()
      setRes({ r: r.resultado, aMano: r.firewall?.aMano ?? f.aMano })
      onCambio(r.firewall)
    } finally { setBusy(false) }
  }
  const abrir = t.abrir && <Boton size="sm" variant={t.primeroAbrir ? 'primary' : 'ghost'} onClick={() => window.napia.abrirWindows(t.abrir!.que)}>{t.abrir.etiqueta}</Boton>
  const cuerpo = (<>
    <p><Rico texto={t.texto} partes={partes} /></p>
    {t.consecuencia && <p className="muted small">{t.consecuencia}</p>}
    {t.redPublica && <p className="small"><Rico texto={t.redPublica} partes={partes} /></p>}
    <div className="row">
      {t.abrir && t.primeroAbrir && abrir}
      {t.arreglar && <Boton size="sm" variant={t.primeroAbrir ? 'ghost' : 'primary'} loading={busy} disabled={busy} onClick={arreglar}>{busy ? arreglandoTexto() : t.arreglar}</Boton>}
      {t.abrir && !t.primeroAbrir && abrir}
    </div>
    {(t.queHace || t.abrir) && <p className="muted small" style={{ marginTop: 'var(--sp-2)' }}>{(t.primeroAbrir ? [t.abrir?.nota, t.queHace] : [t.queHace, t.abrir?.nota]).filter(Boolean).join(' ')}</p>}
    {res && (
      <Aviso tone={res.r === 'listo' || res.r === 'nada' ? 'ok' : res.r === 'cancelado' ? 'info' : 'error'} style={{ marginTop: 'var(--sp-2)' }}>
        {textoResultado(res.r)}
        {res.r === 'error' && res.aMano && <pre className="comando" style={{ marginTop: 'var(--sp-2)' }}>{res.aMano}</pre>}
      </Aviso>
    )}
  </>)
  if (suelto) return <div className="firewall"><p><b>{t.titulo}</b></p>{cuerpo}</div>
  return <Caja pad className="preparar firewall" head={<b>{t.titulo}</b>}>{cuerpo}</Caja>
}
