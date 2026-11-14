// Aviso de versión nueva (Fase H): aparece abajo a la derecha cuando hay una versión nueva de PAILA. Se puede actualizar,
// dejarlo para después ("Ahora no", vuelve a avisar la próxima vez) o no avisar más de esa versión. Nunca se instala sola
// sin que la persona lo pida. La portable no se reemplaza: abre la página para bajarla.
import { useEffect, useState } from 'react'
import type { UpdateState } from '@paila/shared/types'
import { Barra, Boton, Info } from '@paila/diseno'
import { textos } from '@paila/shared/idioma'
import { Icon } from './icons'

const T = textos({
  hay: { es: (v: string) => `Hay una versión nueva de PAILA: ${v}`, en: (v: string) => `There's a new version of PAILA: ${v}` },
  info: {
    es: (actual: string) => `Tenés la ${actual}. Actualizar no toca tu música ni tus playlists: se reemplaza solo el programa y todo lo tuyo queda como está. Si preferís no actualizar, PAILA sigue andando igual.`,
    en: (actual: string) => `You have ${actual}. Updating doesn't touch your music or your playlists: only the program is replaced and everything of yours stays as it is. If you'd rather not update, PAILA keeps working the same.`,
  },
  portable: { es: 'Esta es la versión portable: se baja a mano de la página de PAILA y se reemplaza el archivo.', en: "This is the portable version: you download it by hand from PAILA's page and replace the file." },
  // en Mac (sin la firma de Apple) PAILA no se reemplaza sola: como la portable, se baja de la página
  mac: { es: 'En Mac se baja a mano de la página de PAILA: abrís el .dmg y la arrastrás a Aplicaciones (tu música y tus playlists quedan como están).', en: "On a Mac you download it from PAILA's page: open the .dmg and drag PAILA to Applications (your music and playlists stay as they are)." },
  segundoPlano: { es: 'Se baja en segundo plano y te pregunta antes de instalar.', en: 'It downloads in the background and asks you before installing.' },
  irPagina: { es: 'Ir a la página', en: 'Go to the page' },
  actualizar: { es: 'Actualizar', en: 'Update' },
  ahoraNo: { es: 'Ahora no', en: 'Not now' },
  ahoraNoTip: { es: 'Vuelve a avisar la próxima vez que abras PAILA', en: 'It will tell you again next time you open PAILA' },
  noAvisar: { es: 'No avisar de esta', en: "Don't tell me about this one" },
  noAvisarTip: { es: 'No avisa más de esta versión; sí de la siguiente', en: "It won't mention this version again, but it will tell you about the next one" },
  bajando: { es: (p: number) => `Bajando… ${p} %. Podés seguir usando PAILA.`, en: (p: number) => `Downloading… ${p}%. You can keep using PAILA.` },
  alCerrar: { es: 'Se instala sola cuando cierres PAILA.', en: 'It installs by itself when you close PAILA.' },
  lista: { es: 'Lista para instalar. PAILA se cierra, se instala y se vuelve a abrir (tarda menos de un minuto).', en: 'Ready to install. PAILA closes, installs and opens again (it takes less than a minute).' },
  instalarAhora: { es: 'Instalar ahora', en: 'Install now' },
  alCerrarBoton: { es: 'Al cerrar PAILA', en: 'When I close PAILA' },
  ocultar: { es: 'Ocultar', en: 'Hide' },
  reintentar: { es: 'Probar de nuevo', en: 'Try again' },
})

export function useUpdates() {
  const [st, setSt] = useState<UpdateState | null>(null)
  useEffect(() => { window.paila.updates().then(setSt); return window.paila.onUpdates(setSt) }, [])
  return [st, setSt] as const
}

export default function UpdateNotice() {
  const [st, setSt] = useUpdates()
  const [hidden, setHidden] = useState<string | null>(null)
  const v = st?.available?.version
  if (!st || !v || hidden === v || !['hay', 'bajando', 'lista', 'error'].includes(st.phase)) return null // idioma-ok
  const act = async (p: Promise<UpdateState>) => setSt(await p)
  return (
    <div className="update-notice" role="status">
      <div className="update-head">
        <Icon name="sparkle" size={16} />
        <b>{T.hay(v)}</b>
        <Info tip={T.info(st.current)} />
      </div>
      {st.phase === 'hay' && (<>
        <p className="small muted">{st.mac ? T.mac : st.portable ? T.portable : T.segundoPlano}</p>
        <div className="row">
          <Boton size="sm" onClick={() => act(window.paila.updatesDownload())}>{st.portable || st.mac ? T.irPagina : T.actualizar}</Boton>
          <Boton size="sm" variant="ghost" onClick={() => setHidden(v)} title={T.ahoraNoTip}>{T.ahoraNo}</Boton>
          <Boton size="sm" variant="ghost" onClick={() => act(window.paila.updatesSkip())} title={T.noAvisarTip}>{T.noAvisar}</Boton>
        </div>
      </>)}
      {st.phase === 'bajando' && (<><Barra value={st.progress ?? 0} /><p className="small muted">{T.bajando(Math.round((st.progress ?? 0) * 100))}</p></>)}
      {st.phase === 'lista' && (<>
        <p className="small muted">{st.onQuit ? T.alCerrar : T.lista}</p>
        {st.error && <p className="small hint hint-warn">{st.error}</p>}
        <div className="row">
          <Boton size="sm" onClick={() => act(window.paila.updatesInstall('ahora'))}>{T.instalarAhora}</Boton>
          {!st.onQuit && <Boton size="sm" variant="ghost" onClick={() => act(window.paila.updatesInstall('al-cerrar'))}>{T.alCerrarBoton}</Boton>}
          <Boton size="sm" variant="ghost" onClick={() => setHidden(v)}>{T.ocultar}</Boton>
        </div>
      </>)}
      {st.phase === 'error' && (<>
        <p className="small hint hint-warn">{st.error}</p>
        <div className="row">
          <Boton size="sm" variant="ghost" onClick={() => act(window.paila.updatesDownload())}>{T.reintentar}</Boton>
          <Boton size="sm" variant="ghost" onClick={() => setHidden(v)}>{T.ahoraNo}</Boton>
        </div>
      </>)}
    </div>
  )
}
