// Pestaña "Celular" de Llevar la música: una playlist (o lo elegido) directo al celular conectado por cable (MTP) o a una
// carpeta de la PC, en AAC o MP3 con tags y tapa, o en el formato original. La calidad es un techo: solo se achica lo que
// ocupa mucho, nunca se agranda. Corre en segundo plano, se puede cancelar y la próxima vez sigue donde quedó.
import logo from './assets/logo.png'
import { Icon } from './icons'
import { useEffect, useState } from 'react'
import type { CarrySource, PhoneDevice, PhoneOptions, PhonePlan, PhoneQuality, PhoneResult, PhoneTarget, PlaylistNode } from '@paila/shared/types'
import { bytes, n } from './format'
import { JobPanel, useJob } from './jobs'
import { Aviso, Boton, Caja, Info, Festejo, Rico } from '@paila/diseno'
import { T } from './CarryPhone.textos'
import { ConfirmarBoton, Resultado } from './Confirmar'

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
const KBPS = { aac: { chica: 128, normal: 192, alta: 256 }, mp3: { chica: 128, normal: 192, alta: 320 } } as const
const QLABEL: Record<PhoneQuality, () => string> = { chica: () => T.qChica, normal: () => T.qNormal, alta: () => T.qAlta, original: () => T.qOriginal }

/** Lo que conviene elegir de un celular: el primer almacenamiento y la carpeta Music. */
const target = (d: PhoneDevice): PhoneTarget | null => (d.storages.length ? { id: d.id, name: d.name, storage: d.storages[0].name, folder: 'Music' } : null) // idioma-ok

export default function CarryPhone({ lists, selection }: { lists: PlaylistNode[]; selection: number[] }) {
  const [src, setSrc] = useState<CarrySource | null>(null)
  const [opts, setOpts] = useState<PhoneOptions>({ dest: '', device: null, format: 'aac', quality: 'normal', layout: 'lista', numbered: true })
  const [mode, setMode] = useState<'cel' | 'pc'>('pc')
  const [devs, setDevs] = useState<PhoneDevice[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [plan, setPlan] = useState<PhonePlan | null>(null)
  const [res, setRes] = useState<PhoneResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const job = useJob('carry-phone')
  const set = (p: Partial<PhoneOptions>) => setOpts((o) => ({ ...o, ...p }))

  /** Busca celulares; si encuentra uno que sirve y todavía no se eligió ninguno, lo deja elegido. */
  const search = async () => {
    setSearching(true)
    try {
      const list = await window.paila.carryDevices()
      setDevs(list)
      setOpts((o) => {
        const still = o.device && list.some((d) => d.id === o.device!.id)
        if (still) return o
        const first = list.find((d) => !d.apple && d.storages.length)
        return { ...o, device: first ? target(first) : null }
      })
    } catch (e) { setErr(clean(e)); setDevs([]) } finally { setSearching(false) }
  }
  useEffect(() => { void search() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const eff: PhoneOptions = mode === 'cel' ? { ...opts, dest: '' } : { ...opts, device: null }
  const ready = mode === 'cel' ? !!opts.device : !!opts.dest
  useEffect(() => {
    if (!src || !ready) { setPlan(null); return }
    let alive = true
    const t = setTimeout(() => window.paila.carryPhonePlan(src, eff).then((p) => { if (alive) { setPlan(p); setErr(null) } }).catch((e) => { if (alive) setErr(clean(e)) }), 200)
    return () => { alive = false; clearTimeout(t) }
  }, [src, opts, mode]) // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async () => { const d = await window.paila.carryPick(T.pickDestino); if (d) set({ dest: d }) }
  const run = async () => {
    if (!src) return
    setErr(null); setRes(null)
    try { setRes(await window.paila.carryPhoneRun(src, eff)) } catch (e) { setErr(clean(e)) }
  }
  const running = !!job?.running
  const noRoom = !!plan && plan.freeBytes != null && plan.totalBytes > plan.freeBytes
  const blocked = !!plan?.insideLibrary
  const original = opts.quality === 'original'
  const kb = original ? null : KBPS[opts.format][opts.quality as Exclude<PhoneQuality, 'original'>]
  const dev = devs?.find((d) => d.id === opts.device?.id) ?? null
  const usable = (devs ?? []).filter((d) => !d.apple)
  const apple = (devs ?? []).filter((d) => d.apple)
  const toCel = mode === 'cel'

  return (<>
    <p className="muted small">
      <Rico texto={T.intro} partes={{ info: <Info tip={T.copiar} /> }} />
    </p>
    <Caja pad head={<b>{T.paso1}</b>}>
      <SourcePicker lists={lists} selection={selection} value={src} onChange={setSrc} />
      <div className="row small">
        {T.adonde}
        <label><input type="radio" checked={!toCel} onChange={() => setMode('pc')} disabled={running} /> {T.aCarpeta}</label>
        <label><input type="radio" checked={toCel} onChange={() => setMode('cel')} disabled={running} /> {T.alCelular} <Info tip={T.mtp} /></label>
      </div>
      {toCel ? (<>
        {usable.length > 0 && (
          <div className="row small">
            <label>{T.celular}{' '}
              <select value={opts.device?.id ?? ''} disabled={running} onChange={(e) => { const d = usable.find((x) => x.id === e.target.value); set({ device: d ? target(d) : null }) }}>
                {!opts.device && <option value="">{T.elegi}</option>}
                {usable.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
            {dev && dev.storages.length > 1 && opts.device && (
              <label>{T.donde}{' '}
                <select value={opts.device.storage} disabled={running} onChange={(e) => set({ device: { ...opts.device!, storage: e.target.value } })}>
                  {dev.storages.map((s) => <option key={s.name} value={s.name}>{s.name}{s.freeBytes != null ? T.libres(bytes(s.freeBytes)) : ''}</option>)}
                </select>
              </label>
            )}
            {opts.device && (
              <label>{T.carpeta} <input value={opts.device.folder} disabled={running} onChange={(e) => set({ device: { ...opts.device!, folder: e.target.value } })} style={{ width: 120 }} />
                {' '}<Info tip={T.carpetaTip} /></label>
            )}
            <Boton variant="ghost" size="sm" onClick={search} loading={searching} disabled={running}>{T.buscarDeNuevo}</Boton>
          </div>
        )}
        {devs != null && usable.some((d) => !d.storages.length) && (
          <Aviso tone="atencion"><Rico texto={T.noDeja(usable.filter((d) => !d.storages.length).map((d) => d.name).join(', '))} /></Aviso>
        )}
        {devs != null && usable.length === 0 && (
          <Aviso tone="info">
            <Rico texto={T.ninguno} partes={{ boton: <Boton variant="ghost" size="sm" onClick={search} loading={searching}>{T.buscarDeNuevo}</Boton> }} />
            <div className="small muted">{T.ningunoSi}</div>
          </Aviso>
        )}
        {devs == null && <span className="muted small">{T.buscando}</span>}
        {apple.length > 0 && <Aviso tone="info">{T.apple(apple.map((d) => d.name).join(', '))}</Aviso>}
      </>) : (
        <div className="row">
          <Boton variant="ghost" onClick={pick} disabled={running}>{opts.dest ? T.cambiarCarpeta : T.elegirDestino}</Boton>
          <span className="muted small ellipsis" title={opts.dest}>{opts.dest || T.sinDestino}</span>
        </div>
      )}
    </Caja>
    <Caja pad head={<b>{T.paso2}</b>}>
      <div className="rep-opts">
        <div className="row small">
          {T.calidad}{' '}<Info tip={T.kb} />
          {(['chica', 'normal', 'alta', 'original'] as const).map((q) => (
            <label key={q}><input type="radio" checked={opts.quality === q} onChange={() => set({ quality: q })} /> {QLABEL[q]()}{q !== 'original' ? T.hasta(KBPS[opts.format][q]) : <> <Info tip={T.original} /></>}</label>
          ))}
        </div>
        <div className="hint small">
          {original
            ? T.tal
            : <Rico texto={T.achica} partes={{ info: <Info tip={T.techo} /> }} />}
        </div>
        <div className="row small">
          {T.formato}
          <label className={original ? 'muted' : ''}><input type="radio" disabled={original} checked={opts.format === 'aac'} onChange={() => set({ format: 'aac' })} /> AAC (.m4a) <Info tip={T.aac} /></label>
          <label className={original ? 'muted' : ''}><input type="radio" disabled={original} checked={opts.format === 'mp3'} onChange={() => set({ format: 'mp3' })} /> MP3 <Info tip={T.mp3} /></label>
          {original && <span className="muted">{T.sinConvertir}</span>}
        </div>
        <div className="row small">
          {T.carpetas}
          <label><input type="radio" checked={opts.layout === 'lista'} onChange={() => set({ layout: 'lista' })} /> {T.unaCarpeta} <Info tip={T.layoutL} /></label>
          <label><input type="radio" checked={opts.layout === 'discos'} onChange={() => set({ layout: 'discos' })} /> {T.artistaAlbum} <Info tip={T.layoutD} /></label>
        </div>
        {opts.layout === 'lista' && <label className="small"><input type="checkbox" checked={opts.numbered} onChange={(e) => set({ numbered: e.target.checked })} /> {T.numerar}</label>}
      </div>
    </Caja>

    {err && <Aviso tone="error">{err}</Aviso>}
    {plan && (
      <div className="callout">
        <Rico texto={T.planCabeza(n(plan.items.length), plan.deviceFolder || null)} />{' '}
        {plan.convertCount > 0 && <Rico texto={T.planAchican(n(plan.convertCount), opts.format === 'aac' ? 'AAC' : 'MP3', kb)} />}
        <Rico texto={T.planCopian(n(plan.copyCount))} partes={{ info: <Info tip={original ? T.original : T.copiar} /> }} />
        {' · '}<Rico texto={T.planOcupan(bytes(plan.totalBytes), plan.totalBytes !== plan.srcBytes ? bytes(plan.srcBytes) : null)} />
        {plan.freeBytes != null && T.planLibre(bytes(plan.freeBytes), !!plan.deviceFolder)}
        {plan.skipped.length > 0 && <div className="warn-inline"><Icon name="alert" size={13} className="ic-inline" /> {T.saltean(n(plan.skipped.length), plan.skipped.slice(0, 2).map((s) => `${s.rel.split('/').pop()} (${s.reason})`).join('; '))}</div>}
        {plan.warnings.map((w, i) => <div key={i} className="warn-inline"><Icon name="alert" size={13} className="ic-inline" /> {w}</div>)}
      </div>
    )}
    {plan && plan.items.length > 0 && (
      <div className="listbox" style={{ marginTop: 10 }}>
        {plan.items.slice(0, 15).map((it) => (
          <div key={it.fileId} className="pair-row">
            <span className="muted ellipsis" title={it.rel}>{it.rel.split('/').pop()}</span>
            <span title={it.why}>{it.action === 'convert' ? <Icon name="gear" size={14} className="ic-inline" /> : '→'}</span>
            <span className="ellipsis" title={`${it.why}\n${it.outRel}`}>{it.outRel}</span>
          </div>
        ))}
        {plan.items.length > 15 && <div className="muted small pair-row">{T.ymas(n(plan.items.length - 15))}</div>}
      </div>
    )}
    {job && <JobPanel job={job} unit={T.archivos} onDismiss={() => window.paila.dismissJob('carry-phone')}>{running && <Boton variant="ghost" size="sm" disabled={job.cancelling} onClick={() => window.paila.cancelJob('carry-phone')}>{T.cancelar}</Boton>}</JobPanel>}
    {res && <Result res={res} />}
    <Caja pad head={<b>{T.aMano}</b>}>
      <ul className="small">
        <li><b>{T.android}</b> <Rico texto={T.androidT} partes={{ music: <code>Music</code> /* idioma-ok */ }} /></li>
        <li><b>{T.iphone}</b> {T.iphoneT}</li>
      </ul>
    </Caja>
    {/* el paso 3, fijo abajo como en las ventanas: antes había que bajar para encontrar «Copiar temas» (usabilidad, 27/10) */}
    <div className="pie-fijo">
      <span className="pie-fijo-que">
        <b>{!src ? T.pieFaltaQue : !ready ? T.pieFaltaDonde(toCel) : !plan ? T.pieArmando : T.pieQue(toCel, n(plan.items.length), fuente(src, lists), toCel ? `${opts.device!.name} › ${opts.device!.folder}` : opts.dest)}</b>
        <span className="muted small">{T.siLoCortas}{toCel ? T.noDesconectes : ''}</span>
      </span>
      <ConfirmarBoton disabled={running || !plan || !plan.items.length || noRoom || blocked} onSi={run} deshacer="copias" pregunta={T.pasarPreg(toCel, plan ? n(plan.items.length) : '')}>{running ? T.pasando : T.pieBoton(toCel)}</ConfirmarBoton>
    </div>
  </>)
}

function Result({ res }: { res: PhoneResult }) {
  const head = T.resCabeza(n(res.converted), n(res.copied), res.skippedExisting ? n(res.skippedExisting) : null)
  const cel = res.device ? T.resCel(n(res.device.sent), res.device.already ? n(res.device.already) : null, res.device.folder) : ''
  const open = !res.device && <Boton variant="ghost" size="sm" onClick={() => window.paila.openFolder(res.folder)}>{T.abrirCarpeta}</Boton>
  if (res.failed.length || res.cancelled) return (
    <Resultado r={{
      hechos: `${T.resFesteja(head)}${cel}`, fallados: res.failed, cancelado: res.cancelled, deshacer: 'copias',
      extra: res.notes.length > 0 || open ? (<>
        {res.notes.length > 0 && <ul className="small">{res.notes.slice(0, 5).map((x) => <li key={x.name}><b>{x.name.split('/').pop()}</b>: {x.note}</li>)}{res.notes.length > 5 && <li className="muted">{T.resAvisosMas(n(res.notes.length - 5))}</li>}</ul>}
        {open && <div className="row">{open}</div>}
      </>) : undefined,
    }} />
  )
  return (
    <Festejo imagen={logo} titulo={T.resFesteja(head)} acciones={open || undefined}>
      {cel || null}{' '}{res.notes.length > 0 ? T.resAvisos(n(res.notes.length)) : T.resIntactos}
    </Festejo>
  )
}

/** El nombre de lo que se lleva: la playlist o el de la carpeta para lo elegido. */
const fuente = (s: CarrySource, lists: PlaylistNode[]) => ('playlistId' in s ? lists.find((p) => p.id === s.playlistId)?.name ?? '' : s.name)

/** Elegir de dónde salen los temas: una playlist o lo elegido en la Biblioteca. */
function SourcePicker({ lists, selection, value, onChange }: { lists: PlaylistNode[]; selection: number[]; value: CarrySource | null; onChange: (s: CarrySource | null) => void }) {
  const cur = value == null ? '' : 'playlistId' in value ? String(value.playlistId) : 'sel'
  return (
    <div className="row">
      <label className="small">{T.queLlevar}{' '}
        <select value={cur} onChange={(e) => {
          const v = e.target.value
          onChange(v === '' ? null : v === 'sel' ? { ids: selection, name: 'Selección' /* idioma-ok */ } : { playlistId: Number(v) })
        }}>
          <option value="">{T.elegiPlaylist}</option>
          {selection.length > 0 && <option value="sel">{T.losElegidos(n(selection.length))}</option>}
          {lists.map((p) => <option key={p.id} value={p.id}>{p.name} ({n(p.count)})</option>)}
        </select>
      </label>
      {value && 'ids' in value && (
        <label className="small">{T.nombreCarpeta} <input value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} /></label>
      )}
    </div>
  )
}
