// Ordenar e internet, una sola vez (MASTERPLAN-5, etapa 3; ipc/ordenar-internet.ts): la pregunta, después de las carpetas, y con
// el sí la barra "Internet: X de Y buscados", que sigue los trabajos de siempre (nombres oficiales, MusicBrainz, tapas). Cada uno
// se ve en su panel y se cancela desde ahí; lo que encuentran se suma solo a la lista.
import { Boton, Info, Rico } from '@paila/diseno'
import { num, textos } from '@paila/shared/idioma'
import { useJob } from './jobs'

const T = textos({
  titulo: { es: '¿Busco en internet lo que falta?', en: 'Shall I look up what’s missing on the internet?' },
  sub: {
    es: 'También una sola vez. PAILA busca el nombre oficial, el disco y la tapa de tus temas, y te los propone. No baja música ni manda tus archivos: solo manda el nombre y la huella del sonido.',
    en: 'Also just once. PAILA looks up the official name, the album and the cover of your tracks, and suggests them. It doesn’t download music or send your files: it only sends the name and the sound fingerprint.',
  },
  huella: { es: 'La huella del sonido es un resumen corto del audio (unos números) para reconocer el tema aunque el nombre esté mal. Con ella no se puede volver a armar la música.', en: 'The sound fingerprint is a short summary of the audio (some numbers) to recognize the track even if its name is wrong. The music can’t be rebuilt from it.' },
  seguro: { es: 'Lo seguro se suma tildado; lo dudoso, sin tildar. Podés seguir ordenando mientras busca.', en: 'The sure things are added ticked; the doubtful ones, unticked. You can keep organizing while it searches.' },
  si: { es: 'Sí, buscá', en: 'Yes, look it up' },
  no: { es: 'Ahora no', en: 'Not now' },
  buscando: { es: (x: string, y: string, que: string) => `Internet: **${x} de ${y}** buscados · ${que}`, en: (x: string, y: string, que: string) => `Internet: **${x} of ${y}** looked up · ${que}` },
  empezando: { es: 'Internet: buscando…', en: 'Internet: looking up…' },
  enFila: { es: (que: string) => `Internet: ${que} espera su turno`, en: (que: string) => `Internet: ${que} is waiting its turn` },
  nombres: { es: 'nombres oficiales', en: 'official names' },
  mb: { es: 'discos y años', en: 'albums and years' },
  tapas: { es: 'tapas', en: 'covers' },
  apagado: { es: 'No busco en internet.', en: 'I’m not looking anything up on the internet.' },
  prender: { es: 'Buscar el nombre oficial, el disco y la tapa', en: 'Look up the official name, album and cover' },
})

export function PreguntaInternet({ onElegir }: { onElegir: (si: boolean) => void }) {
  return (
    <div className="ord-ancho">
      <h2 className="ord-titulo">{T.titulo}</h2>
      <p className="muted">{T.sub} <Info tip={T.huella} /></p>
      <p className="muted small">{T.seguro}</p>
      <div className="actionrow">
        <Boton size="lg" onClick={() => onElegir(true)}>{T.si}</Boton>
        <Boton variant="ghost" onClick={() => onElegir(false)}>{T.no}</Boton>
      </div>
    </div>
  )
}

/** Cuánto lleva: el trabajo que está corriendo ahora (uno por vez: los tres usan MusicBrainz). */
export function BarraInternet({ elegido, buscando, onPrender }: { elegido: 'si' | 'no' | null; buscando: boolean; onPrender: () => void }) {
  const jobs = [[useJob('names'), T.nombres], [useJob('mb'), T.mb], [useJob('covers'), T.tapas]] as const
  if (elegido === 'no') return <p className="muted small ord-internet">{T.apagado} <button className="link" onClick={onPrender}>{T.prender}</button></p>
  if (!buscando) return null
  const ahora = jobs.find(([j]) => j?.running && !j.waiting) ?? jobs.find(([j]) => j?.running)
  const [j, que] = ahora ?? [null, '']
  const pct = j && j.total ? Math.round((j.done / j.total) * 100) : null
  return (
    <div className="ord-buscando" role="status">
      <span>{!j ? T.empezando : j.waiting ? T.enFila(que) : j.total ? <Rico texto={T.buscando(num(j.done), num(j.total), que)} /> : `${T.empezando} ${que}`}</span>
      {pct != null && <span className="ord-linea"><i style={{ width: `${pct}%` }} /></span>}
    </div>
  )
}
