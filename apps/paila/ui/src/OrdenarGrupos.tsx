// Ordenar: los grupos de lo que PAILA propone (repetidos, nombres y datos, de internet, tapas, a su carpeta), cerrados con su
// número, que se abren para ver el antes y el después. Se tilda o destilda el grupo entero o un cambio solo; lo destildado queda a
// la vista y no se aplica. (La clase del grupo abierto es ord-abierto: .abierto, de marco.css, gira 90° lo que la lleva y el
// grupo salía de costado, 13/11.)
import { useState } from 'react'
import { GRUPOS_REVISION, type FilaRevision, type GrupoRevision, type RevisionOrdenar } from '@paila/shared/types'
import { Icon, Info } from '@paila/diseno'
import { AvisoRekordbox } from './AvisoRekordbox'
import { T } from './OrdenarGrupos.textos'
import { n } from './format'

const TOPE = 200
const DICE: Record<GrupoRevision, [() => string, () => string, () => string]> = {
  rep: [() => T.rep, () => T.repDice, () => T.repTip],
  nom: [() => T.nom, () => T.nomDice, () => T.nomTip],
  net: [() => T.net, () => T.netDice, () => T.netTip],
  tap: [() => T.tap, () => T.tapDice, () => T.tapTip],
  mov: [() => T.mov, () => T.movDice, () => T.movTip],
}
const campo = (c: string) => (T as unknown as Record<string, string | undefined>)[c] ?? c
const base = (rel: string) => rel.split('/').pop() ?? rel

function Fila({ f, onTildar, tema }: { f: FilaRevision; onTildar: (claves: string[], on: boolean) => void; tema?: boolean }) {
  const despues = f.campo === 'papelera' ? (f.antes ? T.seQueda(base(f.antes)) : T.aPapelera) : f.despues ?? T.vacio
  const antes = f.campo === 'papelera' || f.campo === 'mover' ? f.rel : f.antes ?? T.vacio
  return (
    <label className={`ord-fila${f.on ? '' : ' apagada'}`} title={f.rel}>
      <input type="checkbox" checked={f.on} onChange={(e) => onTildar([f.clave], e.target.checked)} />
      {tema && <span className="ord-tema-fila" title={f.rel}>{base(f.rel)}</span>}
      {f.campo !== 'papelera' && f.campo !== 'mover' && <span className="ord-campo">{campo(f.campo)}</span>}
      <span className="muted ord-antes">{antes}</span><span className="ord-flecha">→</span><span className="ord-despues">{despues}</span>
      {f.error && <span className="ord-error" title={f.error}>{T.noSePudo} {f.error}</span>}
    </label>
  )
}

function Grupo({ g, filas, abierto, onAbrir, onTildar, enRekordbox, otroDice, pie, apagado }: { g: GrupoRevision; filas: FilaRevision[]; abierto: boolean; onAbrir: () => void
  onTildar: (claves: string[], on: boolean) => void; enRekordbox: number; otroDice?: string; pie?: React.ReactNode; apagado?: boolean; siempre?: boolean }) {
  const [nombre, decir, tip] = DICE[g]
  const dice = () => otroDice ?? decir()
  const on = filas.filter((f) => f.on).length
  const todos = on === filas.length
  // los cambios de un mismo tema van juntos, con el nombre del tema arriba
  const temas = new Set(filas.map((f) => f.fileId)).size
  const porTema = g !== 'rep' && g !== 'mov' && temas !== filas.length
  return (
    <div className={`ord-grupo${abierto ? ' ord-abierto' : ''}${apagado ? ' ord-apagado' : ''}`}>
      <div className="ord-grupo-fila">
        {apagado ? <span className="ord-sin-tilde" /> : <input type="checkbox" checked={todos && filas.length > 0} disabled={!filas.length} ref={(el) => { if (el) el.indeterminate = on > 0 && !todos }} aria-label={nombre()}
          onChange={() => onTildar(filas.map((f) => f.clave), !todos)} />}
        <button className="ord-grupo-boton" onClick={onAbrir} aria-expanded={abierto}>
          <span className="ord-grupo-texto"><b>{nombre()}</b> <span className="muted small">{dice()}</span></span>
          <span className="ord-grupo-n">{n(on)}{on !== filas.length && <span className="muted small"> · {T.destildados(filas.length - on)}</span>}</span>
          <Icon name="chevron" size={14} className={`ord-chevron${abierto ? ' abierto' : ''}`} />
        </button>
        <Info tip={tip()} />
      </div>
      {g === 'mov' && !apagado && <AvisoRekordbox n={enRekordbox} que="lugar" />}
      {abierto && pie && <div className="ord-pie">{pie}</div>}
      {abierto && filas.length > 0 && (
        <div className="ord-filas">
          {filas.slice(0, TOPE).map((f, i) => (
            <div key={f.clave}>
              {porTema && (i === 0 || filas[i - 1].fileId !== f.fileId) && <div className="ord-tema">{base(f.rel)}</div>}
              {/* cada cambio dice de qué tema es: con un cambio por tema, en la misma fila (antes salía "Año (vacío) → 2008" sin saber de cuál) */}
              <Fila f={f} onTildar={onTildar} tema={g !== 'rep' && g !== 'mov' && !porTema} />
            </div>
          ))}
          {filas.length > TOPE && <div className="muted small">{T.yMas(filas.length - TOPE)}</div>}
        </div>
      )}
    </div>
  )
}

/** Lo dudoso sin tildar, aceptado de una por tipo ("Tildar los 3 de año"), no de a uno (docs/pruebas/mp5-internet-dudoso.md). */
function PorTipo({ filas, onTildar }: { filas: FilaRevision[]; onTildar: (claves: string[], on: boolean) => void }) {
  const tipos = new Map<string, string[]>()
  for (const f of filas) if (!f.on && !f.error) tipos.set(f.campo, [...(tipos.get(f.campo) ?? []), f.clave])
  return <span className="row ord-por-tipo"><span className="muted">{T.sinTildar}</span>{[...tipos].map(([c, ks]) => <button key={c} className="link" onClick={() => onTildar(ks, true)}>{T.tildarTipo(ks.length, campo(c))}</button>)}</span>
}

export function GruposOrdenar({ rev, onTildar, onCambiarCarpetas }: { rev: RevisionOrdenar; onTildar: (claves: string[], on: boolean) => void; onCambiarCarpetas: () => void }) {
  const [abiertos, setAbiertos] = useState<Set<GrupoRevision>>(new Set())
  const abrir = (g: GrupoRevision) => setAbiertos((s) => { const x = new Set(s); if (x.has(g)) x.delete(g); else x.add(g); return x })
  const cambiar = <button className="link" onClick={onCambiarCarpetas}>{T.cambiarForma}</button>
  // "De internet" se ve mientras busca aunque todavía no haya nada; "A su carpeta", apagado si eligió no tocar las carpetas
  const extra: Partial<Record<GrupoRevision, { otroDice?: string; pie?: React.ReactNode; apagado?: boolean; siempre?: boolean }>> = {
    net: { ...(rev.internet.buscando ? { otroDice: T.buscandoNet(rev.grupos.net.length), siempre: true } : {}), ...(rev.grupos.net.some((f) => !f.on) ? { pie: <PorTipo filas={rev.grupos.net} onTildar={onTildar} /> } : {}) },
    mov: rev.carpetas === 'no-tocar' ? { otroDice: T.movNoTocar, pie: cambiar, apagado: true, siempre: true }
      : { pie: <><span className="muted">{T.carpetaPrincipal(rev.regla.dest || T.tuMusica)}</span> {cambiar}</> },
  }
  return (
    <div className="ord-grupos">
      {GRUPOS_REVISION.filter((g) => rev.grupos[g].length > 0 || extra[g]?.siempre).map((g) => (
        <Grupo key={g} g={g} filas={rev.grupos[g]} abierto={abiertos.has(g)} onAbrir={() => abrir(g)} onTildar={onTildar} enRekordbox={rev.enRekordbox} {...extra[g]} />
      ))}
    </div>
  )
}
