// La tarjeta "Para hacer" del Inicio: lo que conviene hacer para que PAILA no junte cosas de más (qué renglones van: ParaHacer.lista.ts).
// Cada renglón con su botón de un clic y, arriba, cuánto lugar se liberaría. Si no hay nada, no se muestra.
import { useEffect, useState } from 'react'
import type { BackupInfo, ScanStatus, UpdateState } from '@paila/shared/types'
import { Boton, Caja, Pildora, Rico } from '@paila/diseno'
import { textos } from '@paila/shared/idioma'
import { Icon } from './icons'
import { bytes } from './format'
import { irASeccion, type PageKey } from './nav'
import { pedirVaciar, usePapelera } from './papelera'
import { verCambios } from './ChangesBar'
import { paraHacer, type Accion } from './ParaHacer.lista'

const T = textos({
  titulo: { es: 'Para hacer', en: 'To do' },
  sub: {
    es: 'Lo que conviene hacer para que PAILA no junte cosas de más. Lo de tu música está en el Centro de problemas.',
    en: "What's worth doing so PAILA doesn't pile up extra stuff. Your music's issues are in the Problem center.",
  },
  libera: { es: (b: string) => `Podés liberar ${b}`, en: (b: string) => `You can free up ${b}` },
  revisarCambios: { es: 'Revisar', en: 'Review' },
  verAnalisis: { es: 'Ver', en: 'See' },
  verPapelera: { es: 'Ver la papelera', en: 'See the trash' },
  vaciar: { es: 'Vaciar…', en: 'Empty…' },
  verRespaldos: { es: 'Ver los respaldos', en: 'See the backups' },
  verVersion: { es: 'Ver qué trae', en: "See what's new" },
  elegirCarpeta: { es: 'Elegir otra…', en: 'Choose another…' },
  carpetaOk: { es: 'Así está bien', en: "That's fine" },
})

const CARPETA_OK = 'paila.paraHacer.carpetaOk'
const leerCarpetaOk = () => { try { return localStorage.getItem(CARPETA_OK) === '1' } catch { return false } }

export default function ParaHacer({ pendientes, scan, onGo }: { pendientes: number; scan: ScanStatus; onGo: (p: PageKey) => void }) {
  const papelera = usePapelera()
  const [respaldos, setRespaldos] = useState<BackupInfo[] | null>(null)
  const [carpeta, setCarpeta] = useState<string | null | undefined>(undefined)
  const [version, setVersion] = useState<UpdateState | null>(null)
  const [carpetaOk, setCarpetaOk] = useState(leerCarpetaOk)
  // los respaldos cambian cuando algo va a la papelera o vuelve (papeleraCambio): se piden junto con ella
  useEffect(() => {
    void window.paila.backups().then(setRespaldos, () => setRespaldos([]))
    void window.paila.backupDir().then(setCarpeta, () => setCarpeta(undefined))
  }, [papelera?.bytes, papelera?.files])
  useEffect(() => {
    void window.paila.updates().then(setVersion, () => setVersion(null))
    return window.paila.onUpdates(setVersion)
  }, [])

  const filas = paraHacer({ papelera, respaldos, carpetaRespaldos: carpeta, carpetaOk, pendientes, scan, version })
  if (!filas.length) return null
  const libera = filas.reduce((a, f) => a + f.libera, 0)

  const hacer: Record<Accion, () => void> = {
    revisarCambios: verCambios,
    verAnalisis: () => onGo('progress'),
    verPapelera: () => onGo('trash'),
    vaciar: () => { pedirVaciar(); onGo('trash') }, // la Papelera abre el panel de vaciar, que pide confirmar como siempre
    verRespaldos: () => irASeccion('cfg-respaldos', () => onGo('settings')),
    verVersion: () => irASeccion('cfg-actualizaciones', () => onGo('settings')),
    elegirCarpeta: () => irASeccion('cfg-respaldos', () => onGo('settings')),
    carpetaOk: () => { setCarpetaOk(true); try { localStorage.setItem(CARPETA_OK, '1') } catch { /* sin almacenamiento: vuelve a aparecer al abrir */ } },
  }

  return (
    <Caja className="para-hacer" head={<><span className="rotulo">{T.titulo}</span>{libera > 0 && <Pildora tone="atencion">{T.libera(bytes(libera))}</Pildora>}</>}>
      <p className="muted small para-hacer-sub">{T.sub}</p>
      <ul className="para-hacer-lista">
        {filas.map((f) => (
          <li key={f.key} className={f.atencion ? 'atencion' : undefined}>
            <Icon name={f.icono} className="ph-ico" />
            <span className="ph-texto"><Rico texto={f.texto} /></span>
            <span className="ph-botones">
              {f.acciones.map((a) => <Boton key={a} size="sm" variant={a === 'vaciar' ? 'danger' : 'ghost'} onClick={hacer[a]}>{T[a]}</Boton>)}
            </span>
          </li>
        ))}
      </ul>
    </Caja>
  )
}
