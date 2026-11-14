// Elegir el idioma de PAILA (y de NAPIA, que lo hereda), en Configuración → Pantalla. La primera vez vino el de Windows.
// Al cambiarlo se guarda y la ventana se recarga (así todos los textos salen ya en el idioma nuevo), y vuelve a esta sección.
import { Casilla, Info } from '@paila/diseno'
import { IDIOMAS, idioma, textos, type Idioma } from '@paila/shared/idioma'
import { recargarEn } from './nav'

const T = textos({
  rotulo: { es: 'Idioma', en: 'Language' },
  tip: {
    es: 'En qué idioma te habla PAILA (y NAPIA). Lo que PAILA escribe en tus archivos, como los tags o los nombres de las carpetas, no cambia.',
    en: 'The language PAILA (and NAPIA) uses to talk to you. What PAILA writes into your files, like tags or folder names, stays the same.',
  },
})

export default function IdiomaChooser() {
  const elegir = async (i: Idioma) => {
    if (i === idioma()) return
    await window.paila.setIdioma(i)
    recargarEn('settings', 'cfg-pantalla')
  }
  return (
    <>
      <div className="rotulo" style={{ margin: '10px 0 6px' }}>{T.rotulo} <Info tip={T.tip} /></div>
      <div className="estilos">
        {IDIOMAS.map((x) => <Casilla key={x.key} tipo="radio" checked={idioma() === x.key} onChange={() => { void elegir(x.key) }} label={x.nombre} />)}
      </div>
    </>
  )
}
