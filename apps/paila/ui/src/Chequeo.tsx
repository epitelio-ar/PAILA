// Configuración → Chequeo: lo que le puede impedir andar a PAILA (los programas que usa, escribir en tu Música y en sus datos,
// el lugar, las claves, MusicBrainz, la base y, si está, NAPIA con su firewall y su puerto), cada uno con ✓ / ⚠ y su arreglo.
// `ControlFila` es un control con sus botones: la usa también el aviso que aparece solo cuando algo falla (AvisoChequeo.tsx).
// El firewall de NAPIA se muestra con el mismo texto que NAPIA (@paila/shared/firewall). No cambia nada sin un clic.
import { useEffect, useState } from 'react'
import type { Control, ControlId } from '@paila/shared/types'
import { Aviso, Boton, Info, Rico } from '@paila/diseno'
import { TIP_FIREWALL, arreglandoTexto, textoResultado } from '@paila/shared/firewall'
import { cant, fechaHora, textos } from '@paila/shared/idioma'
import { Icon } from './icons'
import { irASeccion, type PageKey } from './nav'

const T = textos({
  titulo: { es: 'Chequeo', en: 'Health check' },
  tip: {
    es: 'Una revisión de lo que le puede impedir andar a PAILA: los programas que usa por dentro, los permisos para escribir, el lugar en el disco, las claves de internet, la base y NAPIA. Mira y no cambia nada; cada arreglo es un botón aparte.',
    en: "A check of what can keep PAILA from working: the programs it uses inside, permission to write, disk space, the internet keys, the database and NAPIA. It looks and changes nothing; each fix is a separate button.",
  },
  intro: {
    es: 'Si algo de esto falla mientras usás PAILA (un disco lleno, una clave que dejó de andar), te avisa sola. Acá podés revisarlo todo cuando quieras.',
    en: 'If any of this fails while you use PAILA (a full drive, a key that stopped working), it tells you on its own. Here you can check it all whenever you want.',
  },
  revisar: { es: 'Revisar', en: 'Check' },
  deNuevo: { es: 'Revisar de nuevo', en: 'Check again' },
  mirando: { es: 'Mirando…', en: 'Checking…' },
  ultima: { es: (c: string) => `Revisado a las ${c}`, en: (c: string) => `Checked at ${c}` },
  todoBien: { es: 'Todo en orden.', en: 'All good.' },
  paraMirar: { es: (n: number) => `${cant(n, 'cosa', 'cosas')} para mirar.`, en: (n: number) => `${cant(n, 'thing', 'things')} to look at.` },
  ok: { es: 'Bien', en: 'Fine' },
  info: { es: 'Se puede mejorar', en: 'Could be better' },
  atencion: { es: 'Para mirar', en: 'Worth a look' },
  mal: { es: 'Hay un problema', en: "There's a problem" },
  nose: { es: 'No se pudo probar', en: "Couldn't be tested" },
  ocultar: { es: 'Menos', en: 'Less' },
  porQue: { es: 'Por qué', en: 'Why' },
})

const ORDEN: ControlId[] = ['programas', 'datos', 'carpetas', 'espacio', 'base', 'musicbrainz', 'clave-discogs', 'clave-acoustid', 'clave-lastfm', 'napia-firewall', 'napia-puerto']
const ICONO = { ok: 'check', info: 'info', atencion: 'alert', mal: 'alert', nose: 'info' } as const
const ETIQUETA = { ok: () => T.ok, info: () => T.info, atencion: () => T.atencion, mal: () => T.mal, nose: () => T.nose }
const partes = () => ({ info: <Info tip={TIP_FIREWALL.info} />, perfil: <Info tip={TIP_FIREWALL.perfil} />, bloquearTodo: <Info tip={TIP_FIREWALL.bloquearTodo} /> })

/** Ir a una pantalla (y, en Configuración, a una parte). */
export function irAl(onGo: (p: PageKey) => void, pagina: PageKey, seccion?: string) {
  if (seccion) irASeccion(seccion, () => onGo(pagina)); else onGo(pagina)
}

/** Un control con su estado, por qué y sus arreglos. */
export function ControlFila({ c, onCambio, onGo, abierto }: { c: Control; onCambio: (c: Control) => void; onGo: (p: PageKey) => void; abierto?: boolean }) {
  const [ver, setVer] = useState(abierto ?? (c.estado === 'mal' || c.estado === 'atencion'))
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<{ texto: string; tono: 'ok' | 'info' | 'error'; aMano: string | null } | null>(null)
  const p = partes()
  const accion = async (a: Control['arreglos'][number]) => {
    if (a.tipo === 'ir') return irAl(onGo, a.pagina, a.seccion)
    if (a.tipo === 'windows') return void window.paila.chequeoAbrirWindows(a.que)
    setBusy(true); setRes(null)
    try {
      if (a.tipo === 'repetir') { const n = await window.paila.chequeoUno(c.id); if (n) onCambio(n); return }
      const r = await window.paila.chequeoArreglarFirewall()
      setRes({ texto: textoResultado(r.resultado), tono: r.resultado === 'listo' || r.resultado === 'nada' ? 'ok' : r.resultado === 'cancelado' ? 'info' : 'error', aMano: r.resultado === 'error' ? r.firewall?.aMano ?? c.aMano ?? null : null })
      if (r.control) onCambio(r.control)
    } finally { setBusy(false) }
  }
  return (
    <div className={`chq-fila chq-${c.estado}`}>
      <span className="chq-ico" title={ETIQUETA[c.estado]()} aria-label={ETIQUETA[c.estado]()}><Icon name={ICONO[c.estado]} size={16} /></span>
      <div className="chq-cuerpo">
        <div className="chq-cab">
          <b>{c.titulo}</b>{c.tip && <Info tip={c.tip} />}
          <span className="chq-resumen">{c.resumen}</span>
          {c.detalle.length > 0 && <button className="link small push-right" onClick={() => setVer(!ver)}>{ver ? T.ocultar : T.porQue}</button>}
        </div>
        {ver && c.detalle.map((d, i) => <p key={i} className="small"><Rico texto={d} partes={p} /></p>)}
        {c.arreglos.length > 0 && (ver || !c.detalle.length) && (
          <div className="row">
            {c.arreglos.map((a, i) => (
              <Boton key={i} size="sm" variant={i === 0 && a.tipo !== 'repetir' && (c.estado === 'mal' || c.estado === 'atencion') ? 'primary' : 'ghost'} disabled={busy} loading={busy && a.tipo === 'firewall'} onClick={() => void accion(a)}>
                {busy && a.tipo === 'firewall' ? arreglandoTexto() : a.etiqueta}
              </Boton>
            ))}
          </div>
        )}
        {ver && c.nota && <p className="muted small">{c.nota}</p>}
        {res && <Aviso tone={res.tono}>{res.texto}{res.aMano && <pre className="diag-contenido">{res.aMano}</pre>}</Aviso>}
      </div>
    </div>
  )
}

/** El último chequeo, para no perderlo al cambiar de pantalla. */
let ultimo: { at: string; controles: Control[] } | null = null

export default function Chequeo({ onGo }: { onGo: (p: PageKey) => void }) {
  const [res, setRes] = useState(ultimo)
  const [vivos, setVivos] = useState<Control[] | null>(null)
  useEffect(() => window.paila.onChequeoControl((c) => setVivos((v) => (v ? [...v.filter((x) => x.id !== c.id), c] : v))), [])
  const revisar = async () => {
    setVivos([])
    try { const controles = await window.paila.chequeo(); ultimo = { at: new Date().toISOString(), controles }; setRes(ultimo) } finally { setVivos(null) }
  }
  const cambiar = (c: Control) => { if (!res) return; ultimo = { ...res, controles: res.controles.map((x) => (x.id === c.id ? c : x)) }; setRes(ultimo) }
  const lista = [...(vivos ?? res?.controles ?? [])].sort((a, b) => ORDEN.indexOf(a.id) - ORDEN.indexOf(b.id))
  const mirar = lista.filter((c) => c.estado === 'mal' || c.estado === 'atencion').length
  return (<>
    <h4>{T.titulo} <Info tip={T.tip} /></h4>
    <p className="muted small">{T.intro}</p>
    <div className="row">
      <Boton size="sm" variant={res ? 'ghost' : 'primary'} disabled={!!vivos} loading={!!vivos} onClick={revisar}>{vivos ? T.mirando : res ? T.deNuevo : T.revisar}</Boton>
      {res && !vivos && <span className="muted small">{T.ultima(fechaHora(res.at, { hour: '2-digit', minute: '2-digit' }))} · {mirar ? T.paraMirar(mirar) : T.todoBien}</span>}
    </div>
    {lista.length > 0 && <div className="chq-lista">{lista.map((c) => <ControlFila key={c.id} c={c} onCambio={cambiar} onGo={onGo} />)}</div>}
  </>)
}
