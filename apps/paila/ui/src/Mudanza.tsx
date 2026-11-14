// "Pasar a otra compu" (Configuración, y la bienvenida de una PAILA vacía): Exportar todo y Traer de otra compu, que
// muestra cuántos temas encuentra en cada carpeta antes de confirmar. Los textos, en castellano e inglés, en T.
import { useEffect, useRef, useState } from 'react'
import type { MudanzaAbierto, MudanzaConteos, MudanzaEmparejado } from '@paila/shared/types'
import { Aviso, Boton, Cabecera, Casilla, Info, Ventana } from '@paila/diseno'
import { bytes } from './format'
import { cant, fecha, num, textos } from '@paila/shared/idioma'
import { toast } from './toast'

/** Cómo se llama cada servicio (el archivo guarda su nombre interno). */
const SERVICIO: Record<string, string> = { discogs: 'Discogs', acoustid: 'AcoustID', audd: 'AudD', lastfm: 'Last.fm' }
const servicios = (s: string[]) => s.map((x) => SERVICIO[x] ?? x).join(', ')

const T = textos({
  titulo: { es: 'Pasar a otra compu', en: 'Move to another computer' },
  info: {
    es: 'Para llevarte PAILA a otra compu, o de Windows a Mac, sin dejarla horas analizando de nuevo. El archivo lleva tus playlists, el Historial, el análisis, las huellas, los cambios pendientes, las vistas guardadas, el diccionario de artistas y la configuración. Tu música no va adentro: la copiás vos (en un disco, por la red) y PAILA la vuelve a encontrar.',
    en: 'To take PAILA to another computer, or from Windows to Mac, without spending hours analyzing again. The file carries your playlists, the History, the analysis, the fingerprints, pending changes, saved views, the artist dictionary and your settings. Your music is not inside: you copy it yourself (on a drive, over the network) and PAILA finds it again.',
  },
  intro: { es: 'Llevate tus playlists, el Historial y todo el análisis a otra compu, sin volver a analizar.', en: 'Take your playlists, the History and all the analysis to another computer, without analyzing again.' },
  exportar: { es: 'Exportar todo…', en: 'Export everything…' },
  exportarTip: { es: 'Arma un solo archivo .paila con todo lo de PAILA (no con tu música).', en: 'Makes a single .paila file with everything in PAILA (not your music).' },
  traer: { es: 'Traer de otra compu…', en: 'Bring from another computer…' },
  traerTitulo: { es: 'Traer de otra compu', en: 'Bring from another computer' },
  traerTip: { es: 'Abre el archivo .paila que armaste en la otra compu.', en: 'Opens the .paila file you made on the other computer.' },
  claves: { es: 'Las claves de los servicios (Discogs, AcoustID, Last.fm…) nunca van en el archivo: en la otra compu se pegan de nuevo.', en: 'Service keys (Discogs, AcoustID, Last.fm…) never go in the file: paste them again on the other computer.' },
  exportado: {
    es: (archivo: string, tam: string, claves: string[]) => `Listo: ${archivo} (${tam}).${claves.length ? ` No lleva tus claves de ${servicios(claves)}: en la otra compu pegalas de nuevo en Configuración.` : ''}`,
    en: (archivo: string, tam: string, claves: string[]) => `Done: ${archivo} (${tam}).${claves.length ? ` Your ${servicios(claves)} keys are not included: paste them again in Settings on the other computer.` : ''}`,
  },
  sub: {
    es: (f: string, sistema: string, version: string) => `Armado el ${f} en ${sistema}, con PAILA ${version}.`,
    en: (f: string, sistema: string, version: string) => `Made on ${f} on ${sistema}, with PAILA ${version}.`,
  },
  trae: {
    es: (c: MudanzaConteos) => [`${cant(c.temas, 'tema', 'temas')} (${num(c.analizados)} analizados)`, cant(c.playlists, 'playlist', 'playlists'), `${cant(c.historial, 'renglón', 'renglones')} del Historial`,
      c.pendientes ? cant(c.pendientes, 'cambio pendiente', 'cambios pendientes') : '', c.vistas ? cant(c.vistas, 'vista guardada', 'vistas guardadas') : '', c.diccionario ? `${cant(c.diccionario, 'nombre', 'nombres')} del diccionario` : ''].filter(Boolean).join(' · '),
    en: (c: MudanzaConteos) => [`${cant(c.temas, 'track', 'tracks')} (${num(c.analizados)} analyzed)`, cant(c.playlists, 'playlist', 'playlists'), `${cant(c.historial, 'History entry', 'History entries')}`,
      c.pendientes ? cant(c.pendientes, 'pending change', 'pending changes') : '', c.vistas ? cant(c.vistas, 'saved view', 'saved views') : '', c.diccionario ? `${cant(c.diccionario, 'dictionary name', 'dictionary names')}` : ''].filter(Boolean).join(' · '),
  },
  sinClaves: {
    es: (s: string[]) => `No trae tus claves de ${servicios(s)}: pegalas de nuevo en Configuración → Servicios de internet.`,
    en: (s: string[]) => `Your ${servicios(s)} keys are not included: paste them again in Settings → Internet services.`,
  },
  estaba: { es: 'En la otra compu estaba en', en: 'On the other computer it was in' },
  elegir: { es: 'Elegir dónde está ahora…', en: 'Choose where it is now…' },
  otra: { es: 'Elegir otra carpeta…', en: 'Choose another folder…' },
  buscando: { es: 'Buscando los temas en esa carpeta…', en: 'Looking for the tracks in that folder…' },
  encontre: { es: (a: number, b: number) => `Encontré ${num(a)} de ${cant(b, 'tema', 'temas')}`, en: (a: number, b: number) => `Found ${num(a)} of ${cant(b, 'track', 'tracks')}` },
  en: { es: 'en', en: 'in' },
  temas: { es: (x: number) => cant(x, 'tema', 'temas'), en: (x: number) => cant(x, 'track', 'tracks') },
  como: {
    es: 'Mismo lugar: la misma carpeta y el mismo nombre. Escritos distinto: el mismo nombre con otras mayúsculas o acentos (pasa de Windows a Mac). Movidos: mismo tamaño y nombre, en otra carpeta. Renombrados: mismo tamaño y fecha, con otro nombre.',
    en: 'Same place: same folder and same name. Written differently: same name with other capitals or accents (happens from Windows to Mac). Moved: same size and name, in another folder. Renamed: same size and date, with another name.',
  },
  detalle: {
    es: (e: MudanzaEmparejado) => [`${num(e.porRuta)} en el mismo lugar`, e.porMayusculas ? `${num(e.porMayusculas)} escritos distinto` : '', e.porNombre ? `${num(e.porNombre)} movidos` : '', e.porFecha ? `${num(e.porFecha)} renombrados` : ''].filter(Boolean).join(', '),
    en: (e: MudanzaEmparejado) => [`${num(e.porRuta)} in the same place`, e.porMayusculas ? `${num(e.porMayusculas)} written differently` : '', e.porNombre ? `${num(e.porNombre)} moved` : '', e.porFecha ? `${num(e.porFecha)} renamed` : ''].filter(Boolean).join(', '),
  },
  /** Los que no aparecen: si ya faltaban en la otra compu, no se perdieron al traer; si no, el primer escaneo los busca por la huella. */
  faltan: {
    es: (x: number, ya: number) => {
      const uno = x === 1
      const quedan = uno ? 'queda como desaparecido, con sus playlists y su análisis' : 'quedan como desaparecidos, con sus playlists y su análisis'
      if (ya === x) return `${uno ? '1 no aparece, pero ya faltaba' : `${num(x)} no aparecen, pero ya faltaban`} en la otra compu: ${quedan}.`
      return `${uno ? '1 no aparece' : `${num(x)} no aparecen`}${ya ? ` (${num(ya)} ya faltaban en la otra compu)` : ''}: ${quedan}. Si ${uno ? 'lo' : 'los'} copiaste con otro nombre, el primer escaneo ${uno ? 'lo' : 'los'} busca por la huella del sonido.`
    },
    en: (x: number, ya: number) => {
      const uno = x === 1
      const quedan = uno ? 'it stays as missing, with its playlists and its analysis' : 'they stay as missing, with their playlists and their analysis'
      if (ya === x) return `${uno ? '1 is not there, but it was already missing' : `${num(x)} are not there, but they were already missing`} on the other computer: ${quedan}.`
      return `${uno ? '1 is not there' : `${num(x)} are not there`}${ya ? ` (${num(ya)} were already missing on the other computer)` : ''}: ${quedan}. If you copied ${uno ? 'it' : 'them'} with another name, the first scan looks for ${uno ? 'it' : 'them'} by the sound fingerprint.`
    },
  },
  huella: { es: 'La huella del sonido es una marca del audio en sí, que no cambia si el archivo se llama distinto o le cambiaron los tags.', en: 'The sound fingerprint is a mark of the audio itself: it does not change if the file has another name or its tags changed.' },
  nuevos: {
    es: (x: number) => `${cant(x, 'archivo', 'archivos')} que la otra compu no tenía: ${x === 1 ? 'se suma' : 'se suman'} en el primer escaneo.`,
    en: (x: number) => `${cant(x, 'file', 'files')} the other computer did not have: added on the first scan.`,
  },
  cambiados: {
    es: (x: number) => (x === 1 ? '1 cambió en el camino (otro tamaño): se vuelve a leer y analizar.' : `${num(x)} cambiaron en el camino (otro tamaño): se vuelven a leer y analizar.`),
    en: (x: number) => `${num(x)} changed on the way (different size): ${x === 1 ? 'it is' : 'they are'} read and analyzed again.`,
  },
  traerCarpeta: { es: 'Traer esta carpeta', en: 'Bring this folder' },
  sinCarpeta: { es: 'Si no la tenés en esta compu, no la elijas: sus temas quedan como en un disco desconectado, con sus playlists y su análisis.', en: 'If you do not have it on this computer, leave it unchecked: its tracks stay as on a disconnected drive, with their playlists and analysis.' },
  yaTiene: {
    es: (d: MudanzaAbierto['destino']) => `Esta PAILA ya tiene ${cant(d.temas, 'tema', 'temas')}, ${cant(d.playlists, 'playlist', 'playlists')} y ${cant(d.historial, 'renglón', 'renglones')} en el Historial. Traer los reemplaza por los de la otra compu. Antes se guarda una copia completa en la carpeta de respaldos de PAILA, por si querés volver.`,
    en: (d: MudanzaAbierto['destino']) => `This PAILA already has ${cant(d.temas, 'track', 'tracks')}, ${cant(d.playlists, 'playlist', 'playlists')} and ${cant(d.historial, 'History entry', 'History entries')}. Bringing replaces them with the other computer's. First a full copy is saved in PAILA's backups folder, in case you want to go back.`,
  },
  reemplazar: { es: 'Sí, reemplazar lo de esta PAILA', en: 'Yes, replace what this PAILA has' },
  seguro: { es: 'No se toca ningún archivo de tu música: solo se arma la base de PAILA. Al terminar, PAILA se cierra y se vuelve a abrir sola.', en: 'None of your music files is touched: only PAILA\'s database is built. When done, PAILA closes and opens again by itself.' },
  confirmar: { es: 'Traer y volver a abrir PAILA', en: 'Bring and reopen PAILA' },
  armando: { es: 'Armando…', en: 'Working…' },
  cancelar: { es: 'Cancelar', en: 'Cancel' },
  bienvenida: { es: '¿Venís de otra compu? Traer todo…', en: 'Coming from another computer? Bring everything…' },
  sinFecha: { es: '¿?', en: '?' },
})

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
const dia = (iso: string) => (iso ? fecha(iso, { day: 'numeric', month: 'long', year: 'numeric' }) : T.sinFecha)

/** La ventana de "Traer de otra compu", con el archivo ya elegido. */
function Traer({ abierto, onClose }: { abierto: MudanzaAbierto; onClose: () => void }) {
  const { resumen: r, destino } = abierto
  const [planes, setPlanes] = useState<Record<number, MudanzaEmparejado | 'buscando' | string>>({})
  const [elegidas, setElegidas] = useState<Set<number>>(new Set())
  const [ok, setOk] = useState(false)
  const [busy, setBusy] = useState(false)
  const buscar = async (rootId: number, carpeta?: string) => {
    setPlanes((p) => ({ ...p, [rootId]: 'buscando' }))
    try {
      const e = await window.paila.mudanzaCarpeta(rootId, carpeta)
      setPlanes((p) => { const x = { ...p }; if (e) x[rootId] = e; else delete x[rootId]; return x })
      if (e) setElegidas((s) => new Set(s).add(rootId))
    } catch (err) { setPlanes((p) => ({ ...p, [rootId]: clean(err) })) }
  }
  // la carpeta sugerida (misma ruta en esta compu) se busca sola, una vez
  const sugeridas = useRef(false)
  useEffect(() => { if (sugeridas.current) return; sugeridas.current = true; for (const c of r.carpetas) if (c.sugerida) void buscar(c.rootId, c.sugerida) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const ocupada = destino.temas > 0 || destino.playlists > 0 || destino.historial > 0
  const listas = [...elegidas].filter((id) => typeof planes[id] === 'object')
  const traer = async () => {
    setBusy(true)
    try { await window.paila.mudanzaTraer(listas) } catch (e) { toast(clean(e), 'error'); setBusy(false) }
  }
  return (
    <Ventana onClose={onClose} busy={busy} className="mudanza-ventana">
      <Cabecera nivel={3} titulo={T.traerTitulo} sub={T.sub(dia(r.fecha), r.sistema, r.version)} />
      <p>{T.trae(r.conteos)}</p>
      {r.clavesQuitadas.length > 0 && <Aviso>{T.sinClaves(r.clavesQuitadas)}</Aviso>}
      {r.carpetas.map((c) => {
        const p = planes[c.rootId]
        const e = typeof p === 'object' ? p : null
        return (
          <div key={c.rootId} className="box">
            <div className="box-head"><span className="muted small">{T.estaba}</span> <b>{c.origen}</b>{c.disco && <span className="muted small"> ({c.disco})</span>} <span className="muted small">· {T.temas(c.temas)}</span></div>
            <div className="keybox">
              {p === 'buscando' && <p className="muted small">{T.buscando}</p>}
              {typeof p === 'string' && p !== 'buscando' && <Aviso tone="error">{p}</Aviso>}
              {e && (<>
                <p><b>{T.encontre(c.temas - e.faltan, c.temas)}</b> {T.en} <b>{e.carpeta}</b> <Info tip={T.como} /></p>
                <p className="small muted">{T.detalle(e)}.</p>
                {e.faltan > 0 && <details className="small"><summary>{T.faltan(e.faltan, e.yaFaltaban)} <Info tip={T.huella} /></summary><ul>{e.ejemplosFaltan.map((x) => <li key={x}>{x}</li>)}{e.faltan > e.ejemplosFaltan.length && <li>…</li>}</ul></details>}
                {e.cambiados > 0 && <p className="small">{T.cambiados(e.cambiados)}</p>}
                {e.nuevos > 0 && <p className="small muted">{T.nuevos(e.nuevos)}</p>}
                <Casilla checked={elegidas.has(c.rootId)} onChange={(on) => setElegidas((s) => { const x = new Set(s); if (on) x.add(c.rootId); else x.delete(c.rootId); return x })} label={T.traerCarpeta} detail={T.sinCarpeta} />
              </>)}
              <div className="row"><Boton size="sm" variant={e ? 'ghost' : undefined} disabled={p === 'buscando' || busy} onClick={() => buscar(c.rootId)}>{e ? T.otra : T.elegir}</Boton></div>
            </div>
          </div>
        )
      })}
      {ocupada && (<>
        <Aviso tone="atencion">{T.yaTiene(destino)}</Aviso>
        <Casilla checked={ok} onChange={setOk} label={T.reemplazar} />
      </>)}
      <Aviso tone="ok">{T.seguro}</Aviso>
      <div className="row">
        <Boton disabled={busy || !listas.length || (ocupada && !ok)} onClick={traer}>{busy ? T.armando : T.confirmar}</Boton>
        <Boton variant="ghost" disabled={busy} onClick={onClose}>{T.cancelar}</Boton>
      </div>
    </Ventana>
  )
}

/** El botón "Traer de otra compu" con su ventana (en Configuración y en la bienvenida). */
export function TraerDeOtraCompu({ bienvenida = false, variant = 'ghost' }: { bienvenida?: boolean; variant?: 'primary' | 'ghost' }) {
  const [abierto, setAbierto] = useState<MudanzaAbierto | null>(null)
  const abrir = async () => { try { const a = await window.paila.mudanzaAbrir(); if (a) setAbierto(a) } catch (e) { toast(clean(e), 'error') } }
  return (<>
    <Boton size="sm" variant={variant} onClick={abrir} title={T.traerTip}>{bienvenida ? T.bienvenida : T.traer}</Boton>
    {abierto && <Traer abierto={abierto} onClose={() => setAbierto(null)} />}
  </>)
}

/** La sección de Configuración. */
export default function PasarDeCompu() {
  const [busy, setBusy] = useState(false)
  const exportar = async () => {
    setBusy(true)
    try { const r = await window.paila.mudanzaExportar(); if (r) toast(T.exportado(r.archivo, bytes(r.tamano), r.clavesQuitadas), 'ok') } catch (e) { toast(clean(e), 'error') } finally { setBusy(false) }
  }
  return (<>
    <h4>{T.titulo} <Info tip={T.info} /></h4>
    <p className="muted small">{T.intro} {T.claves}</p>
    <div className="row">
      <Boton size="sm" variant="ghost" disabled={busy} onClick={exportar} title={T.exportarTip}>{busy ? T.armando : T.exportar}</Boton>
      <TraerDeOtraCompu />
    </div>
  </>)
}

