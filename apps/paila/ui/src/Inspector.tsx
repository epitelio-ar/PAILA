// Modo avanzado: inspector de un tema. Muestra todo lo que PAILA ve y decide de un tema (lo mismo que `npm run tema`): tags, calidad
// y por qué, BPM y tono, grilla, huellas, playlists, duplicados, historial y lo que propondría cada asistente. Solo mira.
import { useCallback, useEffect, useState } from 'react'
import type { AdvInspectResult, InspectSection, TrackInspection } from '@paila/shared/types'
import { Aviso, Boton, Caja, Cabecera, Casilla, Info } from '@paila/diseno'
import { toast } from './toast'
import { textos } from '@paila/shared/idioma'

const T = textos({
  sinDatos: { es: 'Sin datos.', en: 'No data.' },
  titulo: { es: 'Inspeccionar un tema', en: 'Inspect a track' },
  info: { es: 'Todo lo que PAILA sabe y decide de un tema, tal cual está guardado. Es lo mismo que muestra el comando «npm run tema». Solo mira: no cambia nada.', en: 'Everything PAILA knows and decides about a track, exactly as it is stored. It is the same as what the "npm run tema" command shows. It only looks: it changes nothing.' },
  sub: { es: 'Los datos crudos de un tema: qué leyó, qué midió, qué hizo con él y qué propondría.', en: 'The raw data of a track: what it read, what it measured, what it did with it and what it would suggest.' },
  ph: { es: 'Número, ruta o un pedazo del nombre', en: 'Number, path or part of the name' },
  inspeccionar: { es: 'Inspeccionar', en: 'Inspect' },
  usarElegido: { es: 'Usar el tema elegido', en: 'Use the selected track' },
  usarElegidoTip: { es: 'El tema que tenés elegido en la biblioteca', en: "The track you've selected in the library" },
  incluir: { es: 'Incluir lo que propondría cada asistente', en: 'Include what each assistant would suggest' },
  incluirDetalle: { es: 'Arreglar nombres, nombres oficiales, volumen parejo… En bibliotecas grandes puede tardar unos segundos.', en: 'Fix names, official names, even volume… In big libraries it can take a few seconds.' },
  incluirInfo: { es: 'Los asistentes miran toda la biblioteca para decidir (por ejemplo, cómo se escribe un artista en el resto de sus temas), por eso tardan más. Mirar lo que proponen no cambia nada.', en: 'The assistants look at the whole library to decide (for example, how an artist is spelled in the rest of their tracks), so they take longer. Looking at what they suggest changes nothing.' },
  copiado: { es: (que: string) => `Copiado: ${que}`, en: (que: string) => `Copied: ${que}` },
  noCopio: { es: 'No se pudo copiar', en: "Couldn't copy" },
  elTexto: { es: 'el texto del inspector', en: 'the inspector text' },
  losDatos: { es: 'los datos (JSON)', en: 'the data (JSON)' },
  copiarTexto: { es: 'Copiar como texto', en: 'Copy as text' },
  copiarJson: { es: 'Copiar como JSON', en: 'Copy as JSON' },
  reanalizar: { es: 'Reanalizar este tema', en: 'Re-analyze this track' },
  reanalizarTip: { es: 'Vuelve a analizar este tema (calidad, BPM, tono y huellas) en la próxima pasada. No toca el archivo.', en: "Analyzes this track again (quality, BPM, key and fingerprints) in the next pass. The file isn't touched." },
  reanalizarInfo: { es: 'Marca el análisis de este tema como vencido y PAILA lo hace de nuevo. Sirve para ver si un cambio en el motor o en el archivo cambia el resultado. El archivo no se toca.', en: "Marks this track's analysis as out of date and PAILA does it again. Useful to see whether a change in the engine or in the file changes the result. The file isn't touched." },
})

function Bloque({ s }: { s: InspectSection }) {
  const filas = s.rows.filter((r) => r.value !== '—')
  return (
    <Caja head={<><b>{s.title}</b>{s.help && <Info tip={s.help} />}</>} pad>
      {filas.length > 0 && <dl className="insp-filas">{filas.map((r) => <div key={r.label}><dt>{r.label}</dt><dd>{r.value}</dd></div>)}</dl>}
      {(s.items ?? []).length > 0 && <ul className="insp-items">{s.items!.map((i, k) => <li key={k}>{i}</li>)}</ul>}
      {!filas.length && !(s.items ?? []).length && <span className="muted small">{s.empty ?? T.sinDatos}</span>}
    </Caja>
  )
}

/** `elegido`: el tema que está elegido en la biblioteca (se inspecciona solo al abrir). */
export default function Inspector({ elegido }: { elegido: number | null }) {
  const [q, setQ] = useState(elegido != null ? String(elegido) : '')
  const [asist, setAsist] = useState(false)
  const [res, setRes] = useState<AdvInspectResult | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const ver = useCallback(async (ref: string, conAsistentes = asist) => {
    if (!ref.trim()) return
    setOcupado(true)
    try { setRes(await window.paila.advInspect(ref, conAsistentes)) } catch (e) { toast((e as Error).message, 'error') } finally { setOcupado(false) }
  }, [asist])
  useEffect(() => { if (elegido != null) { setQ(String(elegido)); void ver(String(elegido)) } }, [elegido]) // eslint-disable-line react-hooks/exhaustive-deps

  const data: TrackInspection | null = res?.ok ? res.data : null
  const copiar = async (texto: string, que: string) => { try { await navigator.clipboard.writeText(texto); toast(T.copiado(que), 'ok') } catch { toast(T.noCopio, 'error') } }
  const reanalizar = async () => { if (data) toast(await window.paila.advReanalyze(data.id), 'ok') }

  return (
    <div className="page">
      <Cabecera nivel={2} titulo={T.titulo} info={T.info}
        sub={T.sub} />
      <form className="row" onSubmit={(e) => { e.preventDefault(); void ver(q) }}>
        <input className="insp-campo" autoFocus placeholder={T.ph} value={q} onChange={(e) => setQ(e.target.value)} />
        <Boton type="submit" loading={ocupado}>{T.inspeccionar}</Boton>
        {elegido != null && <Boton variant="ghost" onClick={() => { setQ(String(elegido)); void ver(String(elegido)) }} title={T.usarElegidoTip}>{T.usarElegido}</Boton>}
      </form>
      <Casilla checked={asist} onChange={(v) => { setAsist(v); if (data) void ver(String(data.id), v) }} label={T.incluir}
        detail={T.incluirDetalle}
        info={T.incluirInfo} />

      {res && !res.ok && (
        <Aviso tone="atencion">
          {res.mensaje}
          {res.choices.length > 0 && <ul className="insp-items">{res.choices.map((c) => <li key={c.id}><button className="link" onClick={() => { setQ(String(c.id)); void ver(String(c.id)) }}>#{c.id}</button> {c.rel}</li>)}</ul>}
        </Aviso>
      )}
      {data && (<>
        <div className="insp-cab">
          <div><b>#{data.id} · {data.title}</b><div className="muted small insp-ruta">{data.abs ?? data.rel}</div></div>
          <div className="row">
            <Boton variant="ghost" size="sm" onClick={() => res?.ok && copiar(res.texto, T.elTexto)}>{T.copiarTexto}</Boton>
            <Boton variant="ghost" size="sm" onClick={() => copiar(JSON.stringify(data, null, 1), T.losDatos)}>{T.copiarJson}</Boton>
            <Boton variant="ghost" size="sm" onClick={reanalizar} title={T.reanalizarTip}>{T.reanalizar}</Boton>
            <Info tip={T.reanalizarInfo} />
          </div>
        </div>
        {data.sections.map((s) => <Bloque key={s.key} s={s} />)}
      </>)}
    </div>
  )
}
