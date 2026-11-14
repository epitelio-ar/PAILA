// Elegir el estilo de la ventana (Sobrio o Historieta): en la primera vez y en Configuración → Pantalla. NAPIA lo hereda.
import { Casilla, ESTILOS, useEstilo, type Estilo } from '@paila/diseno'

/** Lo que pasa al cambiar: se guarda en esta PC y se le avisa a NAPIA. */
export const compartirEstilo = (e: Estilo) => { void window.paila.setEstilo(e) }
export const useEstiloPaila = () => useEstilo(compartirEstilo)

export default function EstiloChooser() {
  const [estilo, setEstilo] = useEstiloPaila()
  return (
    <div className="estilos">
      {ESTILOS.map((x) => (
        <Casilla key={x.key} tipo="radio" checked={estilo === x.key} onChange={() => setEstilo(x.key)} label={x.label} detail={x.detalle} />
      ))}
    </div>
  )
}
