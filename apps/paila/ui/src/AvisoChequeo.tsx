// El aviso que aparece solo cuando algo falla al usar PAILA (un disco lleno, una clave que el servicio no aceptó, la base
// dañada): el mismo control del Chequeo, con su arreglo, abajo a la derecha. Lo manda el proceso principal (electron/chequeo.ts).
import { useEffect, useState } from 'react'
import type { Control } from '@paila/shared/types'
import { Boton } from '@paila/diseno'
import { textos } from '@paila/shared/idioma'
import { Icon } from './icons'
import { ControlFila, irAl } from './Chequeo'
import type { PageKey } from './nav'

const T = textos({
  titulo: { es: 'PAILA se dio cuenta de algo', en: 'PAILA noticed something' },
  verChequeo: { es: 'Ver el Chequeo', en: 'See the health check' },
  cerrar: { es: 'Cerrar', en: 'Close' },
})

export default function AvisoChequeo({ onGo }: { onGo: (p: PageKey) => void }) {
  const [c, setC] = useState<Control | null>(null)
  useEffect(() => window.paila.onChequeoAviso(setC), [])
  if (!c) return null
  return (
    <div className="update-notice chequeo-aviso" role="status">
      <div className="update-head"><Icon name="alert" size={16} /><b>{T.titulo}</b></div>
      <ControlFila key={c.id} c={c} onCambio={setC} onGo={onGo} abierto />
      <div className="row">
        <Boton size="sm" variant="ghost" onClick={() => { irAl(onGo, 'settings', 'cfg-chequeo'); setC(null) }}>{T.verChequeo}</Boton>
        <Boton size="sm" variant="ghost" onClick={() => setC(null)}>{T.cerrar}</Boton>
      </div>
    </div>
  )
}
