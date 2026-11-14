// Pantalla Volumen parejo (ReplayGain): para todos los temas, sueltos o en disco. Antes era una pestaña de Discos; quien no
// guarda discos enteros no la encontraba (22/10). Lo que toca archivos va a Cambios pendientes.
import { Cabecera } from '@paila/diseno'
import { textos } from '@paila/shared/idioma'
import AlbumsGain from './AlbumsGain'

const T = textos({
  titulo: { es: 'Volumen parejo', en: 'Even volume' },
  sub: { es: 'Que todos tus temas suenen al mismo volumen, sueltos o en disco.', en: 'Make all your tracks play at the same loudness, loose or in albums.' },
})

export default function Volume({ onStaged }: { onStaged: () => void }) {
  return (
    <div className="page">
      <Cabecera nivel={2} titulo={T.titulo} sub={T.sub} />
      <AlbumsGain onStaged={onStaged} />
    </div>
  )
}
