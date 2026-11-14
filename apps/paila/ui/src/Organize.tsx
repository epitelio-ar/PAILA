// Pantalla Organizar carpetas: dónde iría cada tema según sus tags (como van a quedar después de aplicar lo que ya está para aplicar),
// y sumarlo a la lista única de arriba. Se mueve al apretar Aplicar, en orden con todo lo demás (MASTERPLAN-5, etapa 2).
import { Icon } from './icons'
import { useEffect, useMemo, useState } from 'react'
import type { OrganizePlan, PendingChange } from '@paila/shared/types'
import type { LibraryStats } from '@paila/shared/tableview'
import { n } from './format'
import { Aviso, Boton, Cabecera, Rico } from '@paila/diseno'
import { textos } from '@paila/shared/idioma'
import { useEstado } from './hooks/useEstado'
import { convieneAntes, renglones } from './Estado.lista'
import { AvisoRekordbox } from './AvisoRekordbox'
import { REGLA_DE_FABRICA, recordarOrden, ultimoOrden } from './ordenUltimo'
import { toast } from './toast'
import { useAlCambiarCambios } from './hooks/useChanges'

const T = textos({
  r1: { es: 'Artista / Año - Álbum / N.º - Título', en: 'Artist / Year - Album / No. - Title' },
  r2: { es: 'Artista / Álbum / N.º - Título', en: 'Artist / Album / No. - Title' },
  r3: { es: 'Género / Artista / Título', en: 'Genre / Artist / Title' },
  r4: { es: 'Artista - Título (todo en la misma carpeta)', en: 'Artist - Title (all in the same folder)' },
  titulo: { es: 'Organizar carpetas', en: 'Organize folders' },
  futuro: {
    es: (k: string) => `Ya cuenta los cambios de nombre de ${k} temas que están para aplicar: al apretar Aplicar, primero se escriben los nombres y después se mueve.`,
    en: (k: string) => `It already counts the name changes of ${k} tracks that are waiting to be applied: when you press Apply, the names are written first and then things move.`,
  },
  sub: { es: 'Acomoda tu Música en carpetas según los tags, con vista previa.', en: 'Arranges your Music into folders based on its tags, with a preview.' },
  ayuda: {
    es: 'Acomoda los temas de tu **Música** en carpetas según sus tags. Primero ves la vista previa de dónde iría cada uno; lo sumás a lo que vas a aplicar y recién cuando apretás Aplicar (arriba) se mueven los archivos (dentro del mismo disco), y se puede deshacer todo. Los sample packs, inéditos y sets **no se tocan**, y los temas largos que son un set o un enganchado tampoco (pasalos a "Sets y en vivo" desde Arreglar nombres). Los temas sin título o sin artista se saltean: arreglalos primero con el editor de tags.',
    en: 'Arranges the tracks in your **Music** into folders based on their tags. First you see a preview of where each one would go; you add it to what you are going to apply, and the files only move when you press Apply (at the top, within the same disk), and everything can be undone. Sample packs, unreleased tracks and sets **are not touched**, and neither are long tracks that are a set or a mix (move them to "Sets y en vivo" from Fix names and tags). Tracks with no title or no artist are skipped: fix them first with the tag editor.',
  },
  regla: { es: 'Regla de carpetas', en: 'Folder rule' },
  personalizada: { es: 'Personalizada', en: 'Custom' },
  oEscribila: { es: '…o escribila', en: '…or write your own' },
  destinoTip: { es: 'Carpeta, dentro de cada carpeta de música, donde queda lo ordenado. Vacío = en la raíz.', en: 'Folder, inside each music folder, where the organized music ends up. Empty = in the root.' },
  destino: { es: 'Carpeta de destino', en: 'Destination folder' },
  campos: { es: 'Campos: %artista% %albumartista% %album% %año% %n% %titulo% %genero%. Si falta el año o el n.º, se omite. La carpeta de un disco se arma solo si tenés 2 temas o más de ese disco: un tema solo, o sin álbum, va directo a la carpeta del artista (sin n.º). Compilados con "Various Artists" van a "Varios Artistas".', en: 'Fields: %artista% %albumartista% %album% %año% %n% %titulo% %genero% (they stay in Spanish). If the year or the number is missing, it is left out. An album folder is only made if you have 2 or more tracks of that album: a single track, or one with no album, goes straight to the artist folder (without a number). Compilations by "Various Artists" go to "Varios Artistas".' },
  calculando: { es: 'Calculando…', en: 'Calculating…' },
  vistaPrevia: { es: 'Ver vista previa', en: 'See preview' },
  resumen: { es: (a: string, b: string, c: string) => `**${a}** temas se mueven · **${b}** ya están donde corresponde · **${c}** se saltean por falta de tags`, en: (a: string, b: string, c: string) => `**${a}** tracks will move · **${b}** are already in the right place · **${c}** are skipped for missing tags` },
  resumenExtras: { es: (k: string) => ` · ${k} archivos que acompañan (tapas, .cue…) viajan con su disco`, en: (k: string) => ` · ${k} files that go along (covers, .cue…) travel with their album` },
  choque: { es: (k: string, uno: boolean) => `**${k} ${uno ? 'tema choca' : 'temas chocan'} con otro que va al mismo lugar**: no se mueven hasta que lo resuelvas. Casi siempre es el mismo tema repetido: pasá por **Duplicados** (te quedás con el mejor y el otro va a la papelera, antes de mover). O tildá abajo para moverlos igual con "(2)" en el nombre.`, en: (k: string, uno: boolean) => `**${k} ${uno ? 'track clashes' : 'tracks clash'} with another one going to the same place**: they don't move until you sort it out. It is almost always the same track repeated: go through **Duplicates** (you keep the best one and the other goes to the trash, before moving). Or tick below to move them anyway with "(2)" in the name.` },
  conChoques: { es: (k: string) => `Mover también los ${k} que chocan, con "(2)" en el nombre`, en: (k: string) => `Also move the ${k} that clash, with "(2)" in the name` },
  irDuplicados: { es: 'Ir a Duplicados', en: 'Go to Duplicates' },
  ocultar: { es: 'Ocultar', en: 'Hide' },
  verCuales: { es: 'Ver cuáles (cada uno ↔ con cuál choca)', en: 'See which ones (each one ↔ the one it clashes with)' },
  chocaCon: { es: 'choca con', en: 'clashes with' },
  yMas: { es: (k: string) => `… y ${k} más`, en: (k: string) => `… and ${k} more` },
  nadaMover: { es: 'No hay nada para mover con esta regla.', en: 'There is nothing to move with this rule.' },
  sumar: { es: (k: string) => `Sumar ${k} temas a lo que vas a aplicar`, en: (k: string) => `Add ${k} tracks to what you are going to apply` },
  sumados: { es: (k: string) => `${k} temas quedaron para aplicar: se mueven cuando apretás Aplicar, arriba.`, en: (k: string) => `${k} tracks are ready to apply: they move when you press Apply, at the top.` },
  yaSumados: { es: (k: string) => `Ya está en lo que vas a aplicar (${k} temas): se mueven cuando apretás Aplicar, arriba.`, en: (k: string) => `It is already in what you are going to apply (${k} tracks): they move when you press Apply, at the top.` },
  sacar: { es: 'Sacarlos de la lista', en: 'Take them off the list' },
  carpetasNuevas: { es: 'Carpetas nuevas', en: 'New folders' },
  yMasCarpetas: { es: (k: number) => `… y ${k} carpetas más`, en: (k: number) => `… and ${k} more folders` },
  ejemplos: { es: 'Ejemplos', en: 'Examples' },
  comoQueres: { es: 'Cómo querés las carpetas', en: 'How you want your folders' },
  cambiarNombres: { es: 'Cambiar también el nombre de los archivos (n.º de pista y título)', en: 'Also rename the files (track number and title)' },
  cambiarNombresTip: { es: 'Tildado, cada archivo se llama como dice la regla ("01 - Rehén.mp3"). Destildado, conserva su nombre y solo cambia de carpeta.', en: 'Ticked, each file is named as the rule says ("01 - Rehén.mp3"). Unticked, it keeps its name and only changes folder.' },
  personalizar: { es: 'Personalizar la regla', en: 'Customize the rule' },
  ocultarRegla: { es: 'Ocultar la regla', en: 'Hide the rule' },
  resumen2: { es: (a: string, b: string, c: string) => `**${a}** temas cambian de carpeta · **${b}** solo cambian de nombre · **${c}** ya están en su lugar`, en: (a: string, b: string, c: string) => `**${a}** tracks change folder · **${b}** only get a new name · **${c}** are already in place` },
  saltean: { es: (k: string) => ` · **${k}** se saltean (sin artista o título)`, en: (k: string) => ` · **${k}** are skipped (no artist or title)` },
  todoEnSuLugar: { es: 'Todo está en su lugar con esta regla.', en: 'Everything is in place with this rule.' },
  cambianCarpeta: { es: (k: string) => `Cambian de carpeta (${k})`, en: (k: string) => `Change folder (${k})` },
  soloNombre: { es: (k: string) => `Solo cambian de nombre (${k})`, en: (k: string) => `Only get a new name (${k})` },
  soloNombreTip: { es: 'Siguen en la misma carpeta: la regla les agrega el número de pista o corrige el título. Si no querés renombrarlos, destildá «Cambiar también el nombre de los archivos».', en: 'They stay in the same folder: the rule adds the track number or fixes the title. If you don’t want them renamed, untick “Also rename the files”.' },
  verSaltean: { es: (mostrar: boolean, k: string) => `${mostrar ? 'Ocultar' : 'Ver'} los ${k} que se saltean`, en: (mostrar: boolean, k: string) => `${mostrar ? 'Hide' : 'See'} the ${k} skipped` },
})

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
const RULES = [
  { get label() { return T.r1 }, rule: REGLA_DE_FABRICA },
  { get label() { return T.r2 }, rule: '%artista%/%album%/%n% - %titulo%' },
  { get label() { return T.r3 }, rule: '%genero%/%artista%/%titulo%' },
  { get label() { return T.r4 }, rule: '%artista% - %titulo%' },
]

/** La carpeta de un lugar (para separar lo que se muda de lo que solo cambia de nombre). */
const carpetaDe = (rel: string) => rel.replace(/\/[^/]*$/, '').toLowerCase()

/**
 * Organizar carpetas: dónde iría cada tema (se calcula solo, al entrar y con cada cambio de la regla), aplicar y deshacer. Solo
 * mueve la colección Música. Repaso del 01/11 (el autor: "le falta bastante"): la vista previa sin botón, separa lo que cambia de
 * carpeta de lo que solo cambia de nombre, se puede ordenar sin renombrar los archivos, la regla con códigos queda en
 * "Personalizar", y al terminar queda un solo resultado.
 */
export default function Organize({ stats, onGo, pending, onStaged }: { stats: LibraryStats; onGo: (page: 'dups') => void
  /** La lista única de arriba (lo que ya se va a mover y los nombres que van a cambiar) y avisarle que se sumó algo. */
  pending: PendingChange[]; onStaged: () => void }) {
  const estado = useEstado(stats)
  const antes = estado ? convieneAntes(renglones(estado)) : ''
  // arranca como ordenaste la última vez
  const [rule, setRule] = useState(() => ultimoOrden().rule)
  const [dest, setDest] = useState(() => ultimoOrden().dest)
  const [soloCarpetas, setSoloCarpetas] = useState(() => !!ultimoOrden().soloCarpetas)
  const [personalizar, setPersonalizar] = useState(() => !RULES.some((r) => r.rule === ultimoOrden().rule))
  const [plan, setPlan] = useState<OrganizePlan | null>(null)
  const [calculando, setCalculando] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [conChoques, setConChoques] = useState(false)
  const [showSkipped, setShowSkipped] = useState(false)
  const [showClashes, setShowClashes] = useState(false)
  const [vuelta, setVuelta] = useState(0)
  // lo que se aplicó arriba (nombres, tags) cambia adónde va cada tema: se vuelve a calcular
  useAlCambiarCambios(() => setVuelta((v) => v + 1))
  const opciones = { rule, dest: dest.trim(), soloCarpetas }

  // la vista previa se calcula sola (sin "Ver vista previa"): al entrar y un ratito después de cada cambio
  useEffect(() => {
    let vivo = true
    setCalculando(true); setMsg(null)
    const t = setTimeout(() => {
      window.paila.organizePlan({ rule, dest: dest.trim(), soloCarpetas })
        .then((p) => { if (vivo) setPlan(p) }, (e) => { if (vivo) { setPlan(null); setMsg(clean(e)) } })
        .finally(() => { if (vivo) setCalculando(false) })
    }, 350)
    return () => { vivo = false; clearTimeout(t) }
  }, [rule, dest, soloCarpetas, vuelta])

  // lo que ya está en la lista para mover, y los temas con un cambio de nombre o tags que ya cuenta la vista previa
  const enLista = pending.filter((p) => p.field === 'mover' && !p.error).length
  const nombresFuturos = new Set(pending.filter((p) => !p.error && !['mover', 'papelera', 'cover', 'folderCover', 'replaygain', 'trim', 'comment', 'serato', 'bpm', 'key'].includes(p.field)).map((p) => p.fileId)).size
  const choques = new Set((plan?.clashes ?? []).map((c) => c.fileId))
  const aSumar = (plan?.moves ?? []).filter((m) => conChoques || !choques.has(m.fileId)).length
  const sumar = async () => {
    setBusy(true); setMsg(null)
    try {
      await window.paila.sumarMover(opciones, conChoques)
      recordarOrden(opciones); onStaged(); toast(T.sumados(n(aSumar)), 'ok')
    } catch (e) { setMsg(clean(e)) } finally { setBusy(false) }
  }
  const sacar = async () => { await window.paila.sacarPropuestas('mover'); onStaged() }
  // lo que se muda de carpeta y lo que solo cambia de nombre, aparte
  const { mudan, renombran } = useMemo(() => {
    const ms = plan?.moves ?? []
    return { mudan: ms.filter((m) => carpetaDe(m.from) !== carpetaDe(m.to)), renombran: ms.filter((m) => carpetaDe(m.from) === carpetaDe(m.to)) }
  }, [plan])
  // Resumen en árbol: primer nivel de carpetas nuevas con cuántos temas van a cada una.
  const tree = useMemo(() => {
    const m = new Map<string, number>()
    for (const mv of mudan) {
      const parts = mv.to.split('/')
      const key = parts.slice(0, Math.min(parts.length - 1, dest.trim() ? 2 : 1)).join('/')
      m.set(key, (m.get(key) ?? 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [mudan, dest])
  const lista = (ms: typeof mudan) => (
    <div className="listbox">
      {ms.slice(0, 40).map((m) => <div key={m.fileId} className="pair-row"><span className="muted" title={m.from}>{m.from}</span><span>→</span><span title={m.to}>{m.to}</span></div>)}
      {ms.length > 40 && <div className="muted small">{T.yMas(n(ms.length - 40))}</div>}
    </div>
  )

  return (
    <div className="page">
      <Cabecera nivel={2} titulo={T.titulo} sub={T.sub} ayuda={<Rico texto={T.ayuda} />} />
      {antes && <Aviso tone="atencion" className="conviene-antes">{antes}</Aviso>}
      {nombresFuturos > 0 && <p className="muted small">{T.futuro(n(nombresFuturos))}</p>}

      <h4>{T.comoQueres}</h4>
      <div className="form-row">
        <label>{T.regla}
          <select value={RULES.some((r) => r.rule === rule) ? rule : ''} onChange={(e) => e.target.value && setRule(e.target.value)}>
            {RULES.map((r) => <option key={r.rule} value={r.rule}>{r.label}</option>)}
            {!RULES.some((r) => r.rule === rule) && <option value="">{T.personalizada}</option>}
          </select>
        </label>
        <label title={T.destinoTip}>{T.destino}
          <input value={dest} onChange={(e) => setDest(e.target.value)} placeholder="Biblioteca" /* idioma-ok */ />
        </label>
      </div>
      <label className="check-row" title={T.cambiarNombresTip}>
        <input type="checkbox" checked={!soloCarpetas} onChange={(e) => setSoloCarpetas(!e.target.checked)} /> {T.cambiarNombres}
      </label>
      <p className="small"><button className="link" onClick={() => setPersonalizar(!personalizar)}>{personalizar ? T.ocultarRegla : T.personalizar}</button></p>
      {personalizar && (<>
        <label className="form-row">{T.oEscribila}
          <input value={rule} onChange={(e) => setRule(e.target.value)} />
        </label>
        <p className="muted small">{T.campos}</p>
      </>)}

      {msg && <Aviso>{msg}</Aviso>}

      {!plan && calculando && <p className="muted">{T.calculando}</p>}
      {plan && (
        <div className={`plan${calculando ? ' calculando' : ''}`}>
          <div className="callout">
            <Rico texto={T.resumen2(n(mudan.length), n(renombran.length), n(plan.alreadyOk))} />
            {plan.skipped.length > 0 && <Rico texto={T.saltean(n(plan.skipped.length))} />}
            {plan.extras.length > 0 && T.resumenExtras(n(plan.extras.length))}
          </div>
          {plan.conflicts > 0 && (
            <Aviso tone="atencion" style={{ margin: 'var(--sp-3) 0' }}>
              <Rico texto={T.choque(n(plan.conflicts), plan.conflicts === 1)} />
              <label className="check-row small"><input type="checkbox" checked={conChoques} onChange={(e) => setConChoques(e.target.checked)} /> {T.conChoques(n(plan.conflicts))}</label>
              <div className="row" style={{ marginTop: 'var(--sp-2)' }}>
                <Boton size="sm" onClick={() => onGo('dups')}>{T.irDuplicados}</Boton>
                {!!plan.clashes?.length && <button className="link" onClick={() => setShowClashes(!showClashes)}>{showClashes ? T.ocultar : T.verCuales}</button>}
              </div>
              {showClashes && (
                <div className="listbox" style={{ marginTop: 'var(--sp-2)' }}>
                  {plan.clashes!.slice(0, 100).map((c) => <div key={c.fileId} className="pair-row"><span title={c.from}>{c.from}</span><span title={T.chocaCon}>↔</span><span className="muted" title={c.with}>{c.with}</span></div>)}
                  {plan.clashes!.length > 100 && <div className="muted small">{T.yMas(n(plan.clashes!.length - 100))}</div>}
                </div>
              )}
            </Aviso>
          )}
          {plan.moves.length === 0 && plan.extras.length === 0 ? <p className="muted">{T.todoEnSuLugar}</p> : (<>
            <AvisoRekordbox n={plan.inRekordbox} que="lugar" />
            {/* sumar no toca nada: sin pregunta. Con todo ya en la lista, el botón no ofrece lo que ya pasó */}
            <div className="actionrow">
              {enLista > 0 && enLista === aSumar
                ? <><span className="muted small">{T.yaSumados(n(enLista))}</span><button className="link small" onClick={sacar}>{T.sacar}</button></>
                : aSumar > 0 && <Boton disabled={busy || calculando} onClick={sumar}>{T.sumar(n(aSumar))}</Boton>}
            </div>
            {mudan.length > 0 && (<>
              <h4>{T.cambianCarpeta(n(mudan.length))}</h4>
              <div className="listbox">
                {tree.slice(0, 40).map(([k, c]) => <div key={k} className="listbox-row"><span><Icon name="folder" size={14} className="ic-inline" /> {k}</span><span className="muted">{n(c)}</span></div>)}
                {tree.length > 40 && <div className="muted small">{T.yMasCarpetas(tree.length - 40)}</div>}
              </div>
              {lista(mudan)}
            </>)}
            {renombran.length > 0 && (<>
              <h4>{T.soloNombre(n(renombran.length))}</h4>
              {!soloCarpetas && <p className="muted small">{T.soloNombreTip}</p>}
              {lista(renombran)}
            </>)}
          </>)}
          {plan.skipped.length > 0 && (
            <>
              <button className="link" onClick={() => setShowSkipped(!showSkipped)}>{T.verSaltean(showSkipped, n(plan.skipped.length))}</button>
              {showSkipped && <div className="listbox">{plan.skipped.slice(0, 100).map((s) => <div key={s.fileId} className="pair-row"><span>{s.rel}</span><span /><span className="muted">{s.reason}</span></div>)}</div>}
            </>
          )}
        </div>
      )}

    </div>
  )
}
