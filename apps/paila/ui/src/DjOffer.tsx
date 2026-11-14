// La oferta de una sola vez: si PAILA ve que pinchás (muchos temas con BPM o tono, una carpeta "Sets" o "Rekordbox", un
// rekordbox.xml traído), pregunta si querés las herramientas para DJ y producción. Aparece abajo a la derecha, no tapa nada;
// "Ahora no" no vuelve a preguntar (el interruptor de la barra lateral sigue ahí).
import { Boton, Info } from '@paila/diseno'
import { DJ_TOOLS_HELP } from '@paila/shared/profile'
import { textos, lista } from '@paila/shared/idioma'
import { Icon } from './icons'
import { useProfile } from './profile'

const T = textos({
  titulo: { es: '¿Pinchás o producís?', en: 'Do you DJ or produce?' },
  texto: {
    es: (cosas: string[]) => `Parece que sí: ${cosas.join(' y ')}. ¿Prendo las herramientas para DJ y producción (BPM y tono en la tabla, Rekordbox, armar un set)? Se apagan cuando quieras desde la barra lateral.`,
    en: (cosas: string[]) => `It looks like it: ${lista(cosas)}. Want me to turn on the DJ and production tools (BPM and key in the table, Rekordbox, building a set)? You can turn them off any time from the sidebar.`,
  },
  prender: { es: 'Prender', en: 'Turn on' },
  ahoraNo: { es: 'Ahora no', en: 'Not now' },
  ahoraNoTip: { es: 'No te lo vuelvo a preguntar. El interruptor sigue abajo en la barra lateral.', en: "I won't ask again. The switch is still at the bottom of the sidebar." },
})

export default function DjOffer() {
  const { offer, setDjTools, dismissOffer, djTools } = useProfile()
  if (!offer || djTools) return null
  return (
    <div className="update-notice dj-oferta" role="status">
      <div className="update-head">
        <Icon name="headphones" size={16} />
        <b>{T.titulo}</b>
        <Info tip={DJ_TOOLS_HELP} />
      </div>
      <p className="small muted">{T.texto(offer)}</p>
      <div className="row">
        <Boton size="sm" onClick={() => { void setDjTools(true) }}>{T.prender}</Boton>
        <Boton size="sm" variant="ghost" onClick={dismissOffer} title={T.ahoraNoTip}>{T.ahoraNo}</Boton>
      </div>
    </div>
  )
}
