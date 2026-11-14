// Sección "Separar voz" (DJ y producción; masterplan 4, 4B.6): la acapella y el instrumental de uno o pocos temas. Se baja el
// modelo (una vez), se eligen temas con el buscador o arrastrándolos a la barra lateral, y se separan de a uno en segundo
// plano. Lo de baja calidad avisa antes ("Buscar uno mejor" / "Separar igual"). Lo separado se escucha, se muestra en su
// carpeta o se deshace (a la papelera de PAILA). Sin atajo desde el tema: no es una herramienta para todos los temas.
import { useEffect, useRef, useState } from 'react'
import type { StemsHecho, StemsInfo, StemsModo, StemsParte, StemsTema } from '@paila/shared/types'
import { Aviso, Boton, Cabecera, Icon, Info, Nota, Rico } from '@paila/diseno'
import { fecha } from '@paila/shared/idioma'
import { T } from './SepararVoz.textos'
import { ConfirmarBoton, Resultado, type ResultadoTanda } from './Confirmar'
import { JobPanel, useJob } from './jobs'
import { duration } from './format'
import { conTeclado } from './conTeclado'
import { alSoltar, tomarSoltados } from './separar-soltar'
import { toast } from './toast'

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
const GRID = { display: 'grid', gridTemplateColumns: '1fr 44px 64px 92px 110px', gap: 8, alignItems: 'center' } as const
const NOMBRE: Record<StemsParte, () => string> = { acapella: () => T.acapella, instrumental: () => T.instrumental, bateria: () => T.bateria, bajo: () => T.bajo, resto: () => T.resto }
const MODO = 'paila.separar-modo'
const modoGuardado = (): StemsModo => { try { const m = localStorage.getItem(MODO); return m === 'cuatro' || m === 'max' ? m : 'voz' } catch { return 'voz' } }

export default function SepararVoz({ onPlay }: { onPlay?: (id: number) => void }) {
  const [info, setInfo] = useState<StemsInfo | null>(null)
  const [q, setQ] = useState('')
  const [found, setFound] = useState<StemsTema[] | null>(null)
  const [baja, setBaja] = useState<StemsTema[]>([])
  const [res, setRes] = useState<ResultadoTanda | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  // en qué se separa lo que se suma ahora (se acuerda en esta compu)
  const [modo, setModoRaw] = useState<StemsModo>(modoGuardado)
  const setModo = (m: StemsModo) => { setModoRaw(m); try { localStorage.setItem(MODO, m) } catch { /* sin almacenamiento */ } }
  const audio = useRef<HTMLAudioElement>(null)
  const job = useJob('separar')
  const bajando = useJob('separar-modelo')

  const load = () => window.paila.stemsInfo().then(setInfo).catch((e) => toast(clean(e), 'error'))
  useEffect(() => { void load(); return window.paila.onStems(setInfo) }, [])
  useEffect(() => { if (bajando && !bajando.running) void load() }, [bajando?.running]) // eslint-disable-line react-hooks/exhaustive-deps
  // lo que se soltó en la barra lateral
  useEffect(() => alSoltar(() => { const ids = tomarSoltados(); if (ids.length) void sumar(ids, false) }), []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!q.trim()) { setFound(null); return }
    const t = setTimeout(() => { window.paila.stemsSearch(q).then(setFound).catch((e) => toast(clean(e), 'error')) }, 250)
    return () => clearTimeout(t)
  }, [q])

  const sumar = async (ids: number[], igual: boolean) => {
    try {
      const r = await window.paila.stemsAdd(ids, igual, modo)
      setInfo(r.info)
      setBaja((b) => [...b.filter((x) => !ids.includes(x.id)), ...r.bajaCalidad])
    } catch (e) { toast(clean(e), 'error') }
  }
  const esperar = async (ids: number[]) => {
    try { setInfo(await window.paila.stemsWait(ids)); setBaja((b) => b.filter((x) => !ids.includes(x.id))) } catch (e) { toast(clean(e), 'error') }
  }
  const bajar = (cual: StemsModo = 'voz') => window.paila.stemsDownload(cual).then(setInfo).catch((e) => toast(clean(e), 'error'))
  const sacar = (id: number) => window.paila.stemsDrop(id).then(setInfo).catch((e) => toast(clean(e), 'error'))
  const deshacer = async (h: StemsHecho) => {
    try {
      const r = await window.paila.historyUndo('separar', h.batch)
      setRes({ hechos: T.deshecho(r.done), fallados: r.failed, deshacer: 'papelera' })
      void load()
    } catch (e) { toast(clean(e), 'error') }
  }
  const play = async (file: string) => {
    const a = audio.current
    if (!a) return
    if (playing === file) { a.pause(); setPlaying(null); return }
    try { a.src = await window.paila.stemsPlay(file); await a.play(); setPlaying(file) } catch (e) { toast(clean(e), 'error') }
  }

  if (!info) return <div className="page"><Cabecera nivel={2} titulo={T.titulo} /><div className="spinner" /></div>
  const enCola = new Set(info.cola.filter((t) => t.modo === modo).map((t) => t.id))
  const listo = modo === 'voz' ? info.modelo.ready : info[modo].ready
  const destino = modo === 'voz' ? info.destino : info.destino4
  const mb = (b: number) => `${Math.round(b / 1e6)} ${T.megas}`
  // separar en 4 tarda ~1,2 veces lo que dura el tema (medido el 31/10); el de voz, lo que se va midiendo en esta compu
  const minutos = (t: StemsTema & { modo?: StemsModo }) => Math.max(1, Math.round(((t.duration ?? 240) * (t.modo === 'max' ? 5.6 : t.modo === 'cuatro' ? 1.3 : info.ritmo)) / 60))
  const fila = (t: StemsTema, accion: React.ReactNode) => (
    // la fila se ilumina al pasar el mouse: tocarla hace sonar el tema (la persona 1 y la persona 2 tocaban el nombre 29 veces y no pasaba nada)
    <div key={t.id} className="box-row" style={GRID} title={T.escucharlo} {...conTeclado(() => onPlay?.(t.id))} onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) onPlay?.(t.id) }}>
      <span className="ellipsis" title={t.name}>{t.name}</span>
      <span>{t.grade ? <Nota grade={t.grade} /> : <span className="muted small">–</span>}</span>
      <span className="num small">{t.duration ? duration(t.duration) : ''}</span>
      <span className="small num">{[t.bpm ? `${Math.round(t.bpm)} BPM` : '', t.musicKey ?? ''].filter(Boolean).join(' · ')}</span>
      <span style={{ justifySelf: 'end' }}>{accion}</span>
    </div>
  )

  return (
    <div className="page">
      <Cabecera nivel={2} titulo={T.titulo} info={T.introTip} />
      <p className="small"><Rico texto={T.intro} /></p>
      {res && <Resultado r={res} onCerrar={() => setRes(null)} />}

      {/* el modelo de cada modo: solo el que se va a usar (para separar en 4 no hace falta el de voz) */}
      {modo === 'voz' && (info.modelo.ready
        ? <p className="small muted"><Rico texto={T.modeloListo} partes={{ quitar: <Boton size="sm" variant="ghost" disabled={!!job?.running} onClick={() => void window.paila.stemsRemove().then(setInfo)}>{T.quitar}</Boton> }} /></p>
        : <Aviso tone="info">
            {T.faltaModelo(`${Math.round(info.modelo.bytes / 1e6)} ${T.megas}`)} <Info tip={T.modeloTip} />
            <div className="row" style={{ marginTop: 8 }}><Boton size="sm" disabled={!!bajando?.running} onClick={() => void bajar()}>{T.bajar(`${Math.round(info.modelo.bytes / 1e6)} ${T.megas}`)}</Boton></div>
          </Aviso>)}
      {/* separar en 4 (y en máxima calidad): opcionales, otros modelos */}
      {modo !== 'voz' && (info[modo].ready
        ? <p className="small muted"><Rico texto={modo === 'max' ? T.listoMax : T.listo4} partes={{ quitar: <Boton size="sm" variant="ghost" disabled={!!job?.running} onClick={() => void window.paila.stemsRemove(modo).then(setInfo)}>{T.quitar}</Boton> }} /></p>
        : <Aviso tone="info">
            {(modo === 'max' ? T.faltaMax : T.falta4)(mb(info[modo].bytes))} <Info tip={modo === 'max' ? T.maxTip : T.modoTip} />
            <div className="row" style={{ marginTop: 8 }}><Boton size="sm" disabled={!!bajando?.running} onClick={() => void bajar(modo)}>{T.bajar(mb(info[modo].bytes))}</Boton></div>
          </Aviso>)}
      {bajando?.running && <JobPanel job={bajando} unit={T.megas} />}

      {/* a dónde va */}
      <p className="small">
        <Rico texto={T.vaA} partes={{ carpeta: <b title={destino.abs ?? ''}>{destino.rel ?? '–'}</b>, info: <Info tip={T.carpetaTip} /> }} />{' '}
        <Boton size="sm" variant="ghost" onClick={() => void window.paila.stemsPickFolder().then(setInfo).catch((e) => toast(clean(e), 'error'))}>{T.cambiar}</Boton>
        {destino.chosen && <Boton size="sm" variant="ghost" onClick={() => void window.paila.stemsResetFolder().then(setInfo)}>{T.deFabrica}</Boton>}
        {!!info.hechos.length && destino.abs && <Boton size="sm" variant="ghost" onClick={() => void window.paila.openFolder(destino.abs!)}>{T.abrirCarpeta}</Boton>}
      </p>
      {destino.error && <Aviso tone="atencion">{destino.error}</Aviso>}

      {/* aviso de baja calidad */}
      {!!baja.length && (
        <Aviso tone="atencion">
          <Rico texto={baja.length === 1 ? T.bajaUno(baja[0].name, baja[0].grade ?? '') : T.bajaVarios(baja.length)} /> <Info tip={T.bajaTip} />
          <div className="row" style={{ marginTop: 8, gap: 8 }}>
            <Boton size="sm" onClick={() => void esperar(baja.map((t) => t.id))}>{T.buscarMejor}</Boton>
            <Boton size="sm" variant="ghost" onClick={() => { const ids = baja.map((t) => t.id); setBaja([]); void sumar(ids, true) }}>{T.separarIgual}</Boton>
          </div>
        </Aviso>
      )}

      {/* la cola */}
      {job?.running && <JobPanel job={job} unit={T.unidad}><Boton size="sm" variant="ghost" onClick={() => void window.paila.cancelJob('separar')}>{T.cortar}</Boton></JobPanel>}
      {!!info.cola.length && <>
        <h3>{T.cola}</h3>
        <div className="box">{info.cola.map((t, i) => fila(t.modo !== 'voz' ? { ...t, name: `${t.name} · ${t.modo === 'max' ? T.enMax : T.enCuatro}` } : t, info.actual?.id === t.id && i === 0
          ? <span className="small muted">{T.ahora}{info.actual.total > 1 ? ` · ${Math.round((info.actual.done / info.actual.total) * 100)} %` : ''}</span>
          : <span className="row" style={{ gap: 6 }}><span className="small muted">{T.tarda(minutos(t))}</span><Boton size="sm" variant="ghost" onClick={() => void sacar(t.id)}>{T.sacar}</Boton></span>))}</div>
      </>}

      {/* elegir */}
      <h3>{T.elegir}</h3>
      <div className="row small" style={{ gap: 12, flexWrap: 'wrap' }}>
        <span>{T.separarEn}</span>
        {([['voz', T.modoVoz], ['cuatro', T.modoCuatro], ['max', T.modoMax]] as const).map(([m, label]) => (
          <label key={m}><input type="radio" name="separar-modo" checked={modo === m} onChange={() => setModo(m)} /> {label}</label>
        ))}
        <Info tip={T.modoTip} />
      </div>
      <div className="searchbox" style={{ maxWidth: 520 }}>
        <Icon name="search" size={15} />
        <input type="search" placeholder={T.buscar} value={q} disabled={!listo} onChange={(e) => setQ(e.target.value)} />
      </div>
      <p className="small muted">{T.arrastrar} <Info tip={T.notaTip} /></p>
      {found && (found.length
        ? <div className="box">{found.map((t) => fila(t, enCola.has(t.id) ? <span className="small muted">{T.enCola}</span> : <Boton size="sm" onClick={() => void sumar([t.id], false)}>{T.separar}</Boton>))}</div>
        : <p className="small muted">{T.nada}</p>)}

      {/* esperando uno mejor */}
      {!!info.esperando.length && <>
        <h3>{T.esperando} <Info tip={T.esperandoTip} /></h3>
        <div className="box">{info.esperando.map((t) => fila({ ...t, name: `${t.name} · ${T.desde(fecha(t.desde))}` }, <span className="row" style={{ gap: 6 }}>
          <Boton size="sm" variant="ghost" onClick={() => void sumar([t.id], true)}>{T.separarIgual}</Boton>
          <Boton size="sm" variant="ghost" onClick={() => void sacar(t.id)}>{T.sacar}</Boton>
        </span>))}</div>
      </>}

      {/* lo separado */}
      <h3>{T.hechos}</h3>
      <audio ref={audio} onEnded={() => setPlaying(null)} />
      {!info.hechos.length ? <p className="small muted">{T.ningunoHecho}</p> : (
        <div className="box">{info.hechos.map((h) => (
          <div key={h.batch} className="box-row" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', cursor: 'default' }}>
            <span className="ellipsis" style={{ flex: '1 1 240px', minWidth: 0 }} title={h.source}><b>{h.source}</b> <span className="muted small">{fecha(h.at)}</span></span>
            {!h.available && <span className="small muted">{T.desconectado}</span>}
            {(Object.entries(h.partes) as [StemsParte, string | null][]).map(([k, file]) => file && (
              <Boton key={k} size="sm" variant="ghost" disabled={!h.available} title={T.escuchar(NOMBRE[k]())} onClick={() => void play(file)}>
                <Icon name={playing === file ? 'pause' : 'play'} size={14} /> {NOMBRE[k]()}
              </Boton>
            ))}
            {h.partes.acapella && <Boton size="sm" variant="ghost" disabled={!h.available} onClick={() => void window.paila.stemsShow(h.partes.acapella!)}>{T.mostrar}</Boton>}
            <ConfirmarBoton size="sm" variant="ghost" deshacer="papelera" disabled={!h.available} pregunta={T.deshacerPreg(h.source)} onSi={() => void deshacer(h)}>{T.deshacer}</ConfirmarBoton>
          </div>
        ))}</div>
      )}
    </div>
  )
}
