// Sonido, una sola historia (MASTERPLAN-5, 2.4 y etapa 5): suena mal → buscar mejor con NAPIA → llegó → aplicar, en una pantalla y sin
// cambiar de ventana. Arriba, el estado de NAPIA (NapiaBanda.tsx). Tres partes: lo que suena mal (con una frase humana cada uno), lo que te
// falta y lo que llegó (la Bandeja lo reconoce y lo verifica; lo que es mejor ya está en lo que vas a aplicar). Abajo, como arreglos de
// sonido secundarios, Volumen parejo y Recortar silencios. El detalle sigue en Faltan o suenan mal y en la Bandeja.
import { useCallback, useEffect, useState } from 'react'
import type { ApplyResult, EjemploSonido, QueMandar, ResumenSonido } from '@paila/shared/types'
import { Aviso, Boton, Cabecera, Info } from '@paila/diseno'
import NapiaBanda, { useEstadoNapia } from './NapiaBanda'
import { ConfirmarBoton } from './Confirmar'
import { InboxAddModal } from './InboxPlan'
import { useAlCambiarCambios } from './hooks/useChanges'
import type { PageKey } from './nav'
import { toast } from './toast'
import { n } from './format'
import { T } from './Sonido.textos'

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')

export default function Sonido({ onGo, onStaged, onApply }: { onGo: (p: PageKey) => void; onStaged: () => void; onApply: (ids: number[]) => Promise<ApplyResult | string> }) {
  const napia = useEstadoNapia()
  const [r, setR] = useState<ResumenSonido | null>(null)
  const [mandando, setMandando] = useState<QueMandar | null>(null)
  const [pasar, setPasar] = useState(false)
  const cargar = useCallback(async () => { try { setR(await window.paila.sonidoResumen()); onStaged() } catch (e) { toast(clean(e), 'error') } }, [onStaged])
  useEffect(() => { void cargar() }, [cargar])
  // lo que llega: cada archivo que la Bandeja termina de revisar, y cuando NAPIA cuenta uno más
  useEffect(() => window.paila.onInboxUpdate(() => { void cargar() }), [cargar])
  useEffect(() => { if (napia?.bajados) void cargar() }, [napia?.bajados, cargar])
  useAlCambiarCambios(() => { void cargar() })

  const mandar = async (que: QueMandar) => {
    setMandando(que)
    try {
      const x = await window.paila.mandarANapia(que)
      if (x) toast(T.mandado(x.count) + (x.bandeja ? T.bandeja : ''), 'ok')
    } catch (e) { toast(clean(e), 'error') } finally { setMandando(null) }
  }
  const tildar = async (fileId: number, on: boolean) => { setR(await window.paila.tildarReemplazos([fileId], on)); onStaged() }
  const aplicar = async () => {
    const ids = (await window.paila.pendingChanges()).filter((c) => c.field === 'reemplazo' && !c.error).map((c) => c.id)
    const x = await onApply(ids)
    if (typeof x !== 'string') void cargar()
  }

  const bajando = !!napia?.corriendo
  const l = r?.llegaron
  return (
    <div className="page son">
      <Cabecera nivel={2} titulo={T.titulo} sub={T.sub} />
      <NapiaBanda e={napia} />

      <section className="son-parte">
        <h3>{T.malTitulo(r?.suenanMal.n ?? 0)}<Info tip={T.malTip} /></h3>
        {r && !r.suenanMal.n && <p className="muted">{T.malNada}</p>}
        <Ejemplos xs={r?.suenanMal.ejemplos ?? []} mas={(r?.suenanMal.n ?? 0) - (r?.suenanMal.ejemplos.length ?? 0)} onVer={() => onGo('wishlist')} />
        {!!r?.suenanMal.n && <div className="row">
          <Boton disabled={!!mandando} onClick={() => mandar('calidad')} title={T.mandarTip}>{mandando === 'calidad' ? T.mandando : T.mandarMal(r.suenanMal.n)}</Boton>
          {bajando && <span className="small muted">{T.seSuma}</span>}
        </div>}
      </section>

      <section className="son-parte">
        <h3>{T.faltanTitulo(r?.faltan.n ?? 0)}<Info tip={T.faltanTip} /></h3>
        {r && !r.faltan.n && <p className="muted">{T.faltanNada}</p>}
        <Ejemplos xs={r?.faltan.ejemplos ?? []} mas={(r?.faltan.n ?? 0) - (r?.faltan.ejemplos.length ?? 0)} onVer={() => onGo('wishlist')} />
        {!!r?.faltan.n && <div className="row">
          <Boton variant="ghost" disabled={!!mandando} onClick={() => mandar('faltan')} title={T.mandarTip}>{mandando === 'faltan' ? T.mandando : T.mandarFaltan(r.faltan.n)}</Boton>
        </div>}
      </section>

      <section className="son-parte">
        <h3>{T.llegaronTitulo}<Info tip={T.llegaronTip} /></h3>
        {r && !r.bandeja && <p className="muted">{T.sinBandeja}</p>}
        {l && r?.bandeja && !l.mejores.length && !l.nuevos && !l.otros.length && <p className="muted">{l.revisando ? T.revisando(l.revisando) : T.nadaTodavia}</p>}
        {l && l.mejores.length > 0 && (
          <div className="son-llegaron">
            <p className="small">{T.mejoresTexto(l.enLista)}<Info tip={T.mejoresTip} /></p>
            <ul className="son-lista">
              {l.mejores.map((m) => (
                <li key={m.path}>
                  <label><input type="checkbox" checked={m.decision !== 'apagado'} onChange={(e) => tildar(m.fileId!, e.target.checked)} />
                    <b className="ellipsis">{m.rel?.split('/').pop()}</b></label>
                  <span className="muted small ellipsis">{m.frase}</span>
                </li>
              ))}
            </ul>
            {l.enLista > 0 && <ConfirmarBoton variant="aplicar" pregunta={T.aplicarPreg(l.enLista)} deshacer="historial" si={T.siAplicar} onSi={aplicar}>{T.aplicar(l.enLista)}</ConfirmarBoton>}
          </div>
        )}
        {l && l.revisando > 0 && (l.mejores.length > 0 || l.otros.length > 0) && <p className="small muted">{T.revisando(l.revisando)}</p>}
        {l && l.nuevos > 0 && <div className="row"><span>{T.nuevos(l.nuevos)}</span><Boton variant="ghost" onClick={() => setPasar(true)}>{T.pasar}</Boton></div>}
        {l && l.otros.length > 0 && (
          <details className="son-otros">
            <summary>{T.otros(l.otros.length)}</summary>
            <ul className="son-lista">{l.otros.map((o) => <li key={o.path}><b className="ellipsis">{o.name}</b><span className="muted small ellipsis">{o.frase}</span></li>)}</ul>
            <button className="link" onClick={() => onGo('inbox')}>{T.verBandeja}</button>
          </details>
        )}
      </section>

      <section className="son-parte son-arreglos">
        <h3>{T.arreglosTitulo}<Info tip={T.arreglosTip} /></h3>
        <div className="son-tarjetas">
          <button className="son-tarjeta" onClick={() => onGo('volumen')}><b>{T.volumen}</b><span className="muted small">{T.volumenTexto}</span></button>
          <button className="son-tarjeta" onClick={() => onGo('silencios')}><b>{T.silencios}</b><span className="muted small">{T.silenciosTexto}</span></button>
        </div>
      </section>
      {r && !r.suenanMal.n && !r.faltan.n && !l?.mejores.length && <Aviso tone="ok">{T.todoBien}</Aviso>}
      {pasar && <InboxAddModal onClose={() => setPasar(false)} onDone={() => { setPasar(false); void cargar() }} />}
    </div>
  )
}

/** Unos ejemplos, cada uno con su frase, y "Ver los N" para la lista entera. */
function Ejemplos({ xs, mas, onVer }: { xs: EjemploSonido[]; mas: number; onVer: () => void }) {
  if (!xs.length) return null
  return (
    <>
      <ul className="son-lista">{xs.map((x) => <li key={x.key}><b className="ellipsis">{x.artist} — {x.title}</b><span className="muted small ellipsis">{x.frase}</span></li>)}</ul>
      {mas > 0 && <button className="link small" onClick={onVer}>{T.verTodos(n(xs.length + mas))}</button>}
    </>
  )
}
