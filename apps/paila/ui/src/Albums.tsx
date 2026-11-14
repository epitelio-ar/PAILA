// Pantalla Discos y tapas: para quien colecciona discos enteros. Discos completos (qué temas faltan o están repetidos, según
// la lista oficial) y Tapas para todo. El volumen parejo tiene su pantalla (Volume.tsx). Lo que toca archivos va a Cambios pendientes.
import { Cabecera, Rico } from '@paila/diseno'
import { textos } from '@paila/shared/idioma'
import { useState } from 'react'
import type { PageKey } from './nav'
import AlbumsComplete from './AlbumsComplete'
import AlbumsCovers from './AlbumsCovers'

const T = textos({
  titulo: { es: 'Discos y tapas', en: 'Albums and covers' },
  sub: { es: 'Qué le falta a cada disco y sus tapas.', en: 'What each album is missing, and its covers.' },
  ayuda: {
    es: 'Para los que guardan discos enteros. PAILA reconoce un disco por los temas de una misma carpeta con el mismo álbum en el tag; las carpetas de sueltos, los sets y los sample packs no cuentan.',
    en: "For people who keep whole albums. PAILA spots an album by the tracks in one folder that share the same album tag; folders of loose tracks, sets and sample packs don't count.",
  },
  completos: { es: 'Discos completos', en: 'Complete albums' },
  completosAyuda: { es: 'Compara cada disco con su lista de temas oficial: qué te falta y qué tenés repetido', en: "Compares each album with its official track list: what you're missing and what you have twice" },
  tapas: { es: 'Tapas', en: 'Covers' },
  tapasAyuda: { es: 'Una tapa en buena resolución para cada disco, dentro de cada tema y como cover.jpg en la carpeta', en: 'A good-resolution cover for each album, inside each track and as cover.jpg in the folder' },
})

type Tab = 'completos' | 'tapas'
const TABS: { id: Tab; label: string; help: string }[] = [
  { id: 'completos', get label() { return T.completos }, get help() { return T.completosAyuda } },
  { id: 'tapas', get label() { return T.tapas }, get help() { return T.tapasAyuda } },
]

export default function Albums({ onGo, onStaged }: { onGo: (p: PageKey) => void; onStaged: () => void }) {
  const [tab, setTab] = useState<Tab>('completos')
  return (
    <div className="page">
      <Cabecera nivel={2} titulo={T.titulo} sub={T.sub} ayuda={<Rico texto={T.ayuda} />} />
      <div className="tabs">
        {TABS.map((t) => <button key={t.id} className={`tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)} title={t.help}>{t.label}</button>)}
      </div>
      {tab === 'completos' && <AlbumsComplete onGo={onGo} />}
      {tab === 'tapas' && <AlbumsCovers onStaged={onStaged} />}
    </div>
  )
}
