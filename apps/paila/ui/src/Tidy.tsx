// Pantalla Arreglar nombres y tags: propone correcciones de nombres y tags, y deja lo dudoso para decidir a mano.
import { Icon } from './icons'
import QueVaAPasar from './QueVaAPasar'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { TidyReport, TidyReview, TidyRule, TidySet, TidyStep } from '@paila/shared/types'
import { PROFILES, RULES, profileOf } from '@paila/shared/tidy-profiles'
import { n } from './format'
import { conTeclado } from './conTeclado'
import { T } from './Tidy.textos'
import { LearnedWords } from './LearnedWords'
import type { PageKey } from './nav'
import { Aviso, Boton, Info, Pildora, Cabecera } from '@paila/diseno'
import { AvisoRekordbox } from './AvisoRekordbox'
import { useAlCambiarCambios } from './hooks/useChanges'

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
const FIELD: Record<string, string> = { filename: T.fNombre, extension: T.fExtension, title: T.fTitulo, artist: T.fArtista, albumArtist: T.fArtistaAlbum, album: T.fAlbum, track: T.fNum, year: T.fAnio, genre: T.fGenero, bpm: T.fBpm, key: T.fTono }
const fileOf = (rel: string) => rel.split('/').pop() ?? rel

function Meter({ label, a, b, total }: { label: string; a: number; b: number; total: number }) {
  // una barra que no cambia no dice nada: cinco iguales ocupaban el primer tercio de la pantalla (hallazgo 10)
  if (a === b) return null
  const pa = total ? (a * 100) / total : 0, pb = total ? (b * 100) / total : 0
  return (
    <div className="gbar tidy-meter">
      <span className="small">{label}</span>
      <div className="tidy-track"><i className="after" style={{ width: `${pb}%` }} /><i className="before" style={{ width: `${pa}%` }} /></div>
      <span className="muted small">{n(a)} → <b>{n(b)}</b></span>
    </div>
  )
}

/** "antes → después" en chiquito (vacío = se borra: el BPM o el tono del tag). */
const Change = ({ from, to }: { from: string | null; to: string }) => <><span className="muted">{from ?? T.vacio}</span> → <b>{to || T.seBorra}</b></>

/** Un renglón por tema de "se proponen con un aviso": el archivo, lo que propone y por qué conviene mirarlo. */
function stagedRows(items: TidyReview[]) {
  const byId = new Map<number, TidyReview[]>()
  for (const x of items) byId.set(x.id, [...(byId.get(x.id) ?? []), x])
  return [...byId.values()].map((xs) => (
    <div key={xs[0].id} className="listbox-row tidy-review" title={xs[0].rel}>
      <span className="tidy-ex">
        {fileOf(xs[0].rel)}
        <span className="muted"> → {xs.map((x) => `${FIELD[x.field] ?? x.field}: ${x.to}`).join(' · ')}</span>
      </span>
      <span className="muted small tidy-why">{xs[0].why}</span>
    </div>
  ))
}

/**
 * Un tema "para mirar a mano": la propuesta más probable de cada campo, por qué es dudosa, y tres botones:
 * aceptarla (va a Cambios pendientes), editarla antes de aceptar, o dejar el tema como está (no vuelve a aparecer).
 */
function HandItem({ items, busy, onAccept, onKeep }: {
  items: TidyReview[]; busy: boolean
  onAccept: (v: { id: number; field: 'filename' | TidyReview['field']; value: string }[]) => void
  onKeep: (xs: TidyReview[]) => void
}) {
  const [edit, setEdit] = useState(false)
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(items.map((x) => [x.field, x.to])))
  const first = items[0]
  // un nombre de archivo que chocaría con otro no se puede aceptar: es un duplicado
  const blocked = items.some((x) => x.field === 'filename' && x.blocked)
  const whys = [...new Set(items.map((x) => x.why))]
  const accept = () => onAccept(items.filter((x) => x.field !== 'extension').map((x) => ({ id: x.id, field: x.field, value: (vals[x.field] ?? x.to).trim() })).filter((x) => x.value))
  return (
    <div className="tidy-hand">
      <div className="tidy-hand-file" title={first.rel}>{fileOf(first.rel)} <span className="muted small">· {first.rel.includes('/') ? first.rel.slice(0, first.rel.lastIndexOf('/')) : T.raiz}</span></div>
      <div className="tidy-hand-fields">
        {items.map((x) => (
          <div key={x.field} className="tidy-hand-field">
            <span className="muted small">{FIELD[x.field] ?? x.field}</span>
            <span className="small muted tidy-hand-now">{x.from ?? T.vacio}</span>
            <span className="small">→</span>
            {edit
              ? <input className="small" value={vals[x.field] ?? ''} onChange={(e) => setVals({ ...vals, [x.field]: e.target.value })} />
              : <b className="small">{x.to}</b>}
          </div>
        ))}
      </div>
      <div className="small doubt"><Icon name="alert" size={13} className="ic-inline" /> {whys.join(' · ')}</div>
      <div className="tidy-hand-actions">
        {blocked
          ? <span className="muted small">{T.bloqueado}</span>
          : <>
            <Boton size="sm" disabled={busy} onClick={accept}>{edit ? T.aceptarAsi : T.aceptar}</Boton>
            <Boton variant="ghost" size="sm" disabled={busy} onClick={() => setEdit((e) => !e)}>{edit ? T.cancelar : T.editar}</Boton>
          </>}
        <Boton variant="ghost" size="sm" disabled={busy} onClick={() => onKeep(items)} title={T.dejarTip}>{T.dejar}</Boton>
      </div>
    </div>
  )
}

/** Asistente "Arreglar nombres y tags": junta las acciones de limpieza en un recorrido guiado sobre toda la Música. */
export default function Tidy({ total = 0, onStaged, onGo }: { total?: number; onStaged: () => void; onGo: (p: PageKey) => void }) {
  const [r, setR] = useState<TidyReport | null>(null)
  const [picked, setPicked] = useState<Set<TidyStep>>(new Set())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [setsPicked, setSetsPicked] = useState<Set<number>>(new Set())
  const [setsDone, setSetsDone] = useState<TidySet[] | null>(null)
  const [handMsg, setHandMsg] = useState<string | null>(null)
  // los números de los demás perfiles llegan después (un hilo aparte los cuenta): vale solo el último pedido
  const [counting, setCounting] = useState(false)
  const profilesAsk = useRef(0)

  const countProfiles = (x: TidyReport) => {
    const mine = ++profilesAsk.current
    setCounting(true)
    window.paila.tidyProfiles(x.rules)
      .then((ps) => { if (ps && profilesAsk.current === mine) setR((cur) => (cur ? { ...cur, profiles: ps } : cur)) })
      .catch(() => { /* sin los números: la pantalla sirve igual */ })
      .finally(() => { if (profilesAsk.current === mine) setCounting(false) })
  }
  const analyze = async (rules?: TidyRule[]) => {
    setBusy(true); setMsg(null)
    try {
      const x = await window.paila.tidyAnalyze(rules)
      setR(x)
      countProfiles(x)
      setPicked(new Set(x.steps.filter((s) => s.count).map((s) => s.key)))
      setSetsPicked(new Set(x.sets.map((s) => s.id)))
    } catch (e) { setMsg(clean(e)) } finally { setBusy(false) }
  }
  // al entrar mira sola, con el nivel elegido la vez anterior: lo que trajo internet ya está acá, sin apretar nada (MASTERPLAN-5, 3.2)
  useEffect(() => { void analyze() }, [])
  // lo propuesto, aplicado o descartado arriba: se vuelve a mirar con las mismas reglas, así no ofrece de nuevo lo que ya está
  useAlCambiarCambios(() => { if (r) void analyze(r.rules) })
  const stage = async () => {
    if (!r) return
    setBusy(true)
    try {
      const k = await window.paila.tidyStage([...picked], r.rules)
      setMsg(T.listo(n(k)))
      onStaged()
    } catch (e) { setMsg(clean(e)) } finally { setBusy(false) }
  }
  const toggleRule = (k: TidyRule, on: boolean) => { if (r) analyze(RULES.map((x) => x.key).filter((x) => (x === k ? on : r.rules.includes(x)))) }
  const sendSets = async (ids: number[], back = false) => {
    setBusy(true)
    try {
      const k = await window.paila.tidySets(ids, back)
      setSetsDone(back ? null : r!.sets.filter((s) => ids.includes(s.id)))
      // analizar de nuevo borra el mensaje: va después (antes se perdía)
      await analyze(r!.rules)
      if (back) setMsg(T.volvieron(k))
    } catch (e) { setMsg(clean(e)) } finally { setBusy(false) }
  }
  const drop = (ids: Set<number>) => setR((x) => (x ? { ...x, review: x.review.filter((v) => v.staged || !ids.has(v.id)) } : x))
  const accept = async (items: { id: number; field: TidyReview['field']; value: string }[]) => {
    setBusy(true)
    try {
      await window.paila.tidyAccept(items as { id: number; field: 'title'; value: string }[])
      drop(new Set(items.map((x) => x.id)))
      setHandMsg(T.aceptado(fileOf(r!.review.find((v) => v.id === items[0]?.id)?.rel ?? '')))
      onStaged()
    } catch (e) { setHandMsg(clean(e)) } finally { setBusy(false) }
  }
  /** Aceptar varios temas de una (todos o un grupo con el mismo motivo): los que chocarían con otro nombre quedan afuera. */
  const acceptMany = async (grupos: TidyReview[][]) => {
    const ok = grupos.filter((xs) => !xs.some((x) => x.field === 'filename' && x.blocked))
    const items = ok.flatMap((xs) => xs.filter((x) => x.field !== 'extension').map((x) => ({ id: x.id, field: x.field, value: x.to.trim() }))).filter((x) => x.value)
    if (!items.length) return
    setBusy(true)
    try {
      await window.paila.tidyAccept(items as { id: number; field: 'title'; value: string }[])
      drop(new Set(items.map((x) => x.id)))
      setHandMsg(T.aceptadosN(ok.length))
      onStaged()
    } catch (e) { setHandMsg(clean(e)) } finally { setBusy(false) }
  }
  const keep = async (xs: TidyReview[], reset = false) => {
    setBusy(true)
    try {
      await window.paila.tidyKeep(xs.map(({ id, field, from, origin }) => ({ id, field, from, ...(origin ? { origin } : {}) })), reset)
      if (reset) await analyze(r!.rules)
      else { drop(new Set(xs.map((x) => x.id))); setR((x) => (x ? { ...x, kept: x.kept + 1 } : x)) }
    } catch (e) { setHandMsg(clean(e)) } finally { setBusy(false) }
  }

  // lo que se va a lograr con los pasos elegidos (aproximado: usa el resultado de todos los pasos juntos)
  const chosenCount = useMemo(() => (r?.steps ?? []).filter((s) => picked.has(s.key)).reduce((s, x) => s + x.count, 0), [r, picked])
  const profile = r ? profileOf(r.rules) : null
  const hand = useMemo(() => {
    const byId = new Map<number, TidyReview[]>()
    for (const x of r?.review ?? []) if (!x.staged) byId.set(x.id, [...(byId.get(x.id) ?? []), x])
    return [...byId.values()]
  }, [r])

  return (
    <div className="page">
      <Cabecera nivel={2} titulo={T.titulo} sub={T.sub} ayuda={<>{T.a1}<b>{T.a1b}</b>{T.a2}
        <b>{T.a3}</b>{T.a4}</>} />
      {!r && !busy && <QueVaAPasar total={total} />}
      <div className="row"><Boton disabled={busy} onClick={() => analyze(r?.rules)}>{busy && !r ? T.mirando : r ? T.analizarDeNuevo : T.analizar}</Boton>{busy && r && <span className="muted small">{T.calculando}</span>}</div>
      {msg && <Aviso>{msg}</Aviso>}

      {r && (<>
        {/* el botón para seguir a la vista, sin bajar: el resultado esconde la acción (usabilidad, 27/10/2026) */}
        <p className="tidy-siguiente"><b>{T.encontre(chosenCount)}</b> <button className="link" onClick={() => document.getElementById('tidy-proponer')?.scrollIntoView({ block: 'center' })}>{T.verYProponer}</button></p>
        <h4><span className="sec-n">1</span>{T.s1}</h4>
        <div className="callout tidy-box">
          <Meter label={T.conArtista} a={r.before.artist} b={r.after.artist} total={r.before.total} />
          <Meter label={T.conTitulo} a={r.before.title} b={r.after.title} total={r.before.total} />
          <Meter label={T.conAlbum} a={r.before.album} b={r.after.album} total={r.before.total} />
          <Meter label={T.conAnio} a={r.before.year} b={r.after.year} total={r.before.total} />
          <Meter label={T.conGenero} a={r.before.genre} b={r.after.genre} total={r.before.total} />
          {r.before.artist === r.after.artist && r.before.title === r.after.title && r.before.album === r.after.album && r.before.year === r.after.year && r.before.genre === r.after.genre && <div className="small">{T.nadaCambia}</div>}
          <div className="muted small">{T.deTotal(r.before.total)}</div>
        </div>

        <h4><span className="sec-n">2</span>{T.s2} <Info tip={T.perfilTip} /></h4>
        {/* la persona 1 saltó entre niveles 12 veces, propuso, descartó y volvió a proponer: elegir uno no cambia nada (31/10) */}
        <p className="small">{T.nivelesAyuda}</p>
        <div className="tidy-profiles">
          {PROFILES.map((p) => {
            const c = r.profiles.find((x) => x.key === p.key)
            const on = profile === p.key
            return (
              <button key={p.key} className={`tidy-profile${on ? ' on' : ''}`} disabled={busy || !!p.soon} onClick={() => analyze(p.rules)} title={p.help}>
                <div className="tidy-profile-head"><b>{p.label}</b>{on && <Pildora tone="ok">{T.elegido}</Pildora>}{p.soon && <Pildora>{T.proximamente}</Pildora>}</div>
                <div className="small muted">{p.help}</div>
                {c ? <div className="small"><b>{n(c.count)}</b>{T.cambiosEn(c.tracks)}</div> : counting && !p.soon && <div className="small muted">{T.calculando}</div>}
                {p.soon && <div className="small muted">{p.soon}</div>}
                {p.key === 'oficial' && !r.searched && <div className="small doubt">{T.noBuscados}<span className="link" {...conTeclado(() => onGo('online'))} onClick={(e) => { e.stopPropagation(); onGo('online') }}>{T.buscarlos}</span>.</div>}
                {c?.extra.map((x, i) => <div key={i} className="small tidy-ex" title={x.rel}>{FIELD[x.field] ?? x.field}: <Change from={x.from} to={x.to} /></div>)}
              </button>
            )
          })}
        </div>
        <p className="small muted">{T.diccionario1}<button className="link" onClick={() => onGo('settings')}>{T.configuracion}</button>.</p>
        {!profile && <p className="small muted">{T.aMedida}<button className="link" disabled={busy} onClick={() => analyze(PROFILES.find((p) => p.key === 'prolijo')!.rules)}>{T.volverA}{PROFILES.find((p) => p.key === 'prolijo')!.label}</button></p>}

        <div className="box tidy-rules">
          <div className="box-head"><b>{T.queHace}</b><span className="muted small">{T.prenderApagar}</span></div>
          {RULES.map((x) => {
            const st = r.byRule[x.key]
            const on = r.rules.includes(x.key)
            return (
              <label key={x.key} className={`choice tidy-rule${on ? '' : ' off'}`}>
                <input type="checkbox" checked={on} disabled={busy || x.always} onChange={(e) => toggleRule(x.key, e.target.checked)} />
                <div className="choice-body">
                  <div><b>{x.label}</b> <Info tip={x.help} />{x.always && <Pildora>{T.siempre}</Pildora>}
                    {on && <span className="muted small">{st ? T.cambiosBiblio(st.count) : T.nadaBiblio}</span>}</div>
                  <div className="small muted">{x.help}</div>
                  <div className="small tidy-ex">{T.ejemplo}<Change from={x.example[0]} to={x.example[1]} />
                    {on && st?.examples[0] && <span className="muted">{T.enBiblio}{st.examples[0].from ?? T.vacio} → {st.examples[0].to}</span>}</div>
                </div>
              </label>
            )
          })}
        </div>

        <LearnedWords on={r.rules.includes('aprendidas')} onChanged={() => analyze(r.rules)} />

        <h4><span className="sec-n">3</span>{T.s3}</h4>
        {r.steps.map((s) => (
          <label key={s.key} className="box choice">
            <input type="checkbox" checked={picked.has(s.key)} disabled={!s.count} onChange={(e) => setPicked((p) => { const t = new Set(p); e.target.checked ? t.add(s.key) : t.delete(s.key); return t })} />
            <div className="choice-body">
              <div><b>{s.label}</b></div>
              <div className="muted small">{s.count ? T.cambiosEnTemas(s.count, s.tracks) : T.nadaHacer}</div>
              {s.detail && <div className="muted small">{s.detail}</div>}
              {s.warning && <div className="small doubt"><Icon name="alert" size={13} className="ic-inline" /> {s.warning}</div>}
              {s.examples.slice(0, 3).map((x, i) => (
                <div key={i} className="small tidy-ex" title={x.rel}>{fileOf(x.rel)} · {FIELD[x.field] ?? x.field}: <Change from={x.from} to={x.to} /></div>
              ))}
            </div>
          </label>
        ))}
        {(picked.has('filenames') || picked.has('extension')) && <AvisoRekordbox n={r.inRekordbox} que="nombre" />}
        <div className="actionbar" id="tidy-proponer">
          <Boton disabled={busy || !picked.size || !chosenCount} onClick={stage}>{T.proponer(chosenCount)}</Boton>
          <span className="muted small">{T.nadaEscrito}</span>
        </div>

        {(r.sets.length > 0 || setsDone) && (<>
          <h4>{T.setsTitulo(r.sets.length)} <Info tip={T.setsTip} /></h4>
          {setsDone && (
            <p className="hint">{T.setsPasaron1(setsDone.length)}<b>Sets y en vivo</b>{/* idioma-ok */}{T.setsPasaron2}{' '}
              <button className="link" disabled={busy} onClick={() => sendSets(setsDone.map((s) => s.id), true)}>{T.deshacer}</button></p>
          )}
          {r.sets.length > 0 && (<>
            <p className="muted small">
              {T.setsP1}
              {T.setsP2}<b>Sets y en vivo</b>{/* idioma-ok */}{T.setsP3}
            </p>
            <div className="listbox">
              {r.sets.map((s) => (
                <label key={s.id} className="listbox-row tidy-review" title={s.rel}>
                  <span className="tidy-ex"><input type="checkbox" checked={setsPicked.has(s.id)} onChange={(e) => setSetsPicked((p) => { const t = new Set(p); e.target.checked ? t.add(s.id) : t.delete(s.id); return t })} /> {fileOf(s.rel)}</span>
                  <span className="muted small tidy-why">{s.why}</span>
                </label>
              ))}
            </div>
            <div className="row"><Boton variant="ghost" disabled={busy || !setsPicked.size} onClick={() => sendSets([...setsPicked])}>{T.pasarN(setsPicked.size)}Sets y en vivo</Boton>{/* idioma-ok */}</div>
          </>)}
        </>)}

        {(hand.length > 0 || r.kept > 0) && (<>
          <h4>{T.manoTitulo(hand.length)}</h4>
          <p className="muted small">
            {T.m1}<b>{T.m2}</b>{T.m3}<b>{T.m4}</b>{T.m5}
            <b>{T.m6}</b>{T.m7}<b>{T.m8}</b>{T.m9}
          </p>
          {handMsg && <Aviso>{handMsg}</Aviso>}
          {r.kept > 0 && <p className="small muted">{T.dejaste(r.kept)}<button className="link" disabled={busy} onClick={() => keep([], true)}>{T.mostrar}</button></p>}
          <div className="tidy-hand-list">
            {hand.length > 1 && <div className="row"><Boton size="sm" disabled={busy} onClick={() => acceptMany(hand)}>{T.aceptarTodos(hand.length)}</Boton></div>}
            {hand.map((xs, i) => {
              const why = [...new Set(xs.map((x) => x.why))].join(' · ')
              const antes = i > 0 && [...new Set(hand[i - 1].map((x) => x.why))].join(' · ') === why
              if (antes) return <HandItem key={xs[0].id} items={xs} busy={busy} onAccept={accept} onKeep={(ys) => keep(ys)} />
              const grupo = hand.filter((g) => [...new Set(g.map((x) => x.why))].join(' · ') === why)
              return <Fragment key={xs[0].id}>
                {grupo.length > 1 && grupo.length < hand.length && <div className="row small"><b>{why}</b><Boton variant="ghost" size="sm" disabled={busy} onClick={() => acceptMany(grupo)}>{T.aceptarGrupo(grupo.length)}</Boton></div>}
                <HandItem items={xs} busy={busy} onAccept={accept} onKeep={(ys) => keep(ys)} />
              </Fragment>
            })}
          </div>
        </>)}
        {r.review.some((x) => x.staged) && (<>
          <h4>{T.avisoTitulo(new Set(r.review.filter((x) => x.staged).map((x) => x.id)).size)}</h4>
          <p className="muted small">{T.avisoP}</p>
          <div className="listbox">{stagedRows(r.review.filter((x) => x.staged))}</div>
        </>)}

        <h4>{T.sinResolver(r.leftover.count)}</h4>
        <p className="muted small">{T.sinResolverP}</p>
        <div className="listbox">{r.leftover.sample.map((x) => <div key={x} className="pair-row"><span>{x}</span><span /><span /></div>)}</div>
        {r.leftover.count > r.leftover.sample.length && <div className="muted small">{T.yMas(r.leftover.count - r.leftover.sample.length)}</div>}
      </>)}
    </div>
  )
}
