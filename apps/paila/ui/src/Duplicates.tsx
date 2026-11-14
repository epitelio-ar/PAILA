// Pantalla Duplicados: idénticos, mismo audio en otra calidad (por la huella acústica), probables por nombre y versiones.
// Cada grupo es una tabla de una fila por copia y se escucha A/B. Lo que sobra se suma a lo que vas a aplicar y va a la papelera de PAILA
// al apretar Aplicar (se restaura); las versiones nunca. Lo encontrado queda en la base: salís y volvés, y sigue ahí (MASTERPLAN-5, etapa 2).
import { Icon } from './icons'
import QueVaAPasar from './QueVaAPasar'
import { useEffect, useMemo, useState } from 'react'
import type { DupGroup, DupItem, DupLevel, PendingChange } from '@paila/shared/types'
import { bytes, duration, n } from './format'
import { GRADE_HELP } from './problems'
import { JobPanel, useJob } from './jobs'
import { ABPlayer } from './ABPlayer'
import { toast } from './toast'
import { Nota, Aviso, Boton, Info, Cabecera, Pildora } from '@paila/diseno'
import { textos, cant } from '@paila/shared/idioma'
import { useAlCambiarCambios } from './hooks/useChanges'
import { cuando } from './ChangesBar'

const T = textos({
  carpetaPrincipal: { es: '(carpeta principal)', en: '(main folder)' },
  tabTodos: { es: 'Todos', en: 'All' },
  helpTodos: { es: 'Todos los grupos.', en: 'All the groups.' },
  tabExact: { es: 'Idénticos', en: 'Identical' },
  helpExact: { es: 'El mismo archivo copiado (byte a byte), o el mismo audio exacto con otros tags o nombre. Es seguro quedarse con uno.', en: 'The same file copied (byte for byte), or the exact same audio with other tags or a different name. It is safe to keep just one.' },
  tabQuality: { es: 'Mismo audio, otra calidad', en: 'Same audio, other quality' },
  helpQuality: { es: 'Suenan igual de principio a fin (lo dice la huella acústica), aunque tengan otro nombre, formato o calidad: por ejemplo un FLAC y un MP3 de 128 kbps del mismo tema. Se propone quedarse con la mejor nota.', en: 'They sound the same from start to end (the acoustic fingerprint says so), even with a different name, format or quality: for example a FLAC and a 128 kbps MP3 of the same track. It suggests keeping the best grade.' },
  tabProbable: { es: 'Probables por nombre', en: 'Probable by name' },
  helpProbable: { es: 'Mismos artista, título y duración según los tags. Si alguno no tiene huella todavía, no se pudo confirmar a oído: escuchalos si dudás. También van acá los que suenan igual pero uno dura unos segundos más (la intro de un video, aplausos o silencio).', en: 'Same artist, title and length according to the tags. If one has no fingerprint yet, it could not be confirmed by ear: listen to them if you are unsure. Tracks that sound the same but where one runs a few seconds longer (a video intro, applause or silence) also go here.' },
  tabVersion: { es: 'Versiones', en: 'Versions' },
  helpVersion: { es: 'Versiones distintas del mismo tema (radio edit y extended, original y remix, en vivo). NO son duplicados: se muestran juntas para que elijas, pero nunca se propone tirar ninguna.', en: 'Different versions of the same track (radio edit and extended, original and remix, live). They are NOT duplicates: they are shown together so you can choose, but throwing any of them away is never suggested.' },
  huella: { es: 'La huella acústica es un resumen de cómo suena cada tema (la misma tecnología de AcoustID). PAILA la calcula en tu PC, sin internet, y con ella reconoce el mismo audio aunque cambie el nombre, el formato o la calidad.', en: 'The acoustic fingerprint is a summary of how each track sounds (the same technology as AcoustID). PAILA works it out on your PC, with no internet, and uses it to recognize the same audio even if the name, the format or the quality changes.' },
  ultima: { es: (c: string) => `Lo que encontró la última búsqueda (${c}).`, en: (c: string) => `What the last search found (${c}).` },
  cambiaron: {
    es: (k: number) => `${n(k)} grupos no se muestran: un archivo cambió desde la búsqueda (se editó o se reemplazó). Buscá de nuevo para verlos.`,
    en: (k: number) => `${cant(k, 'group is', 'groups are')} not shown: a file changed since the search (it was edited or replaced). Search again to see them.`,
  },
  titulo: { es: 'Duplicados', en: 'Duplicates' },
  sub: { es: 'El mismo tema repetido: te quedás con el mejor.', en: 'The same track repeated: you keep the best one.' },
  d1: { es: 'PAILA busca el mismo archivo copiado, el mismo audio guardado en otra calidad (por cómo suena: la ', en: 'PAILA looks for the same file copied, the same audio saved in another quality (by how it sounds: the ' },
  d2: { es: 'huella acústica', en: 'acoustic fingerprint' },
  d3: { es: ') y los temas con los mismos tags y duración. Te propone quedarte con el de mejor calidad. Las ', en: ') and tracks with the same tags and length. It suggests keeping the best-quality one. The ' },
  d4: { es: 'versiones', en: 'versions' },
  d5: { es: ' (radio edit, extended, remix, en vivo) se muestran juntas pero no son duplicados: nunca se proponen para tirar. Lo que sobra va a la ', en: ' (radio edit, extended, remix, live) are shown together but they are not duplicates: they are never suggested for throwing away. What is left over goes to PAILA\'s ' },
  d6: { es: 'Papelera', en: 'Trash' },
  d7: { es: ' de PAILA: nada se borra de verdad y las playlists pasan a usar la copia que se queda.', en: ': nothing is really deleted, and playlists switch to the copy that stays.' },
  faltanHuellas: { es: (k: number) => `Faltan las huellas de ${n(k)} temas (se calculan en Análisis, en una pasada rápida). Sin huella, esos temas solo se comparan por nombre.`, en: (k: number) => `The fingerprints of ${cant(k, 'track', 'tracks')} are missing (they are worked out in Analysis, in a quick pass). Without a fingerprint, those tracks are only compared by name.` },
  buscando: { es: 'Buscando…', en: 'Searching…' },
  buscarDeNuevo: { es: 'Buscar de nuevo', en: 'Search again' },
  buscar: { es: 'Buscar duplicados', en: 'Look for duplicates' },
  ninguno: { es: 'No se encontraron duplicados.', en: 'No duplicates were found.' },
  resumen: {
    es: (g: number, v: number, f: number, size: string) => `${n(g)} grupos de duplicados y ${n(v)} de versiones. Sobran ${n(f)} archivos, ${size}.`,
    en: (g: number, v: number, f: number, size: string) => `${cant(g, 'group', 'groups')} of duplicates and ${v} of versions. ${cant(f, 'file is', 'files are')} left over, ${size}.`,
  },
  archivos: { es: 'archivos', en: 'files' },
  cancelar: { es: 'Cancelar', en: 'Cancel' },
  primeroTamanos: { es: 'Primero se comparan los tamaños y recién después se lee el contenido de los que podrían ser iguales; la huella acústica ya está guardada.', en: 'First the sizes are compared, and only then is the content of the ones that could be the same read; the acoustic fingerprint is already saved.' },
  sumar: { es: (k: number, size: string) => `Sumar ${n(k)} archivos (${size}) a lo que vas a aplicar`, en: (k: number, size: string) => `Add ${cant(k, 'file', 'files')} (${size}) to what you are going to apply` },
  sacarDeLista: { es: 'Sacarlos de lo que vas a aplicar', en: 'Take them off what you are going to apply' },
  sumados: { es: (k: number) => `${n(k)} archivos quedaron para aplicar: van a la papelera cuando apretás Aplicar, arriba.`, en: (k: number) => `${cant(k, 'file is', 'files are')} ready to apply: they go to the Trash when you press Apply, at the top.` },
  yaSumados: { es: (k: number) => `Ya está en lo que vas a aplicar (${n(k)} archivos): van a la papelera cuando apretás Aplicar, arriba.`, en: (k: number) => `It is already in what you are going to apply (${cant(k, 'file', 'files')}): they go to the Trash when you press Apply, at the top.` },
  deshacerNota: { es: 'Nada se toca hasta Aplicar. Después se puede deshacer desde Papelera. Las versiones no se tocan.', en: 'Nothing is touched until you Apply. Afterwards you can undo it from Trash. Versions are left alone.' },
  enRekordbox: { es: (k: number) => ` ${n(k)} de los que se van a la papelera están exportados a Rekordbox: allá van a quedar sin archivo.`, en: (k: number) => ` ${n(k)} of the files going to the Trash are exported to Rekordbox: there they will be left without a file.` },
  paraAplicar: { es: 'Para aplicar', en: 'To apply' },
  dejar: { es: 'Dejar como está', en: 'Leave as is' },
  dejarTip: { es: 'No son repetidos para vos: el grupo no vuelve a aparecer ni a contar (se puede deshacer desde el Inicio, «Ver cuáles»).', en: "They aren't repeats for you: the group won't show up or count again (you can undo it from Home, “See which”)." },
  masGrupos: { es: (a: number, b: number) => `Mostrar ${n(a)} grupos más (quedan ${n(b)})`, en: (a: number, b: number) => `Show ${n(a)} more groups (${n(b)} left)` },
  parecen: { es: (k: number) => ` · se parecen un ${k} %`, en: (k: number) => ` · they match ${k}%` },
  porQueTip: { es: 'Por qué PAILA los junta. «Byte a byte» = el archivo es exactamente el mismo, copiado. «Huella acústica» = un resumen de cómo suena: si coincide, es el mismo audio aunque cambie el nombre, el formato o la calidad. «Comparten N s de audio» = cuántos segundos suenan idénticos en los dos.', en: 'Why PAILA groups them. "Byte for byte" = the file is exactly the same, copied. "Acoustic fingerprint" = a summary of how it sounds: if it matches, it is the same audio even if the name, format or quality changes. "Share N s of audio" = how many seconds sound identical in both.' },
  parecenTip: { es: 'Qué parte de la huella acústica coincide en la parte que suenan juntos. Dos temas distintos dan alrededor de 50–65 %; el mismo audio en otra calidad, más de 80 %.', en: 'How much of the acoustic fingerprint matches in the part where they play together. Two different tracks give around 50–65%; the same audio in another quality, more than 80%.' },
  cerrarEscucha: { es: 'Cerrar la escucha', en: 'Close listening' },
  noTocarGrupo: { es: ' No sumarlo por ahora', en: " Don't add it for now" },
  hintVersiones: { es: 'Las versiones pueden no empezar igual: mové la barra para comparar la misma parte.', en: 'Versions may not start the same way: move the bar to compare the same part.' },
  hintCopias: { es: 'Cambiá entre las copias mientras suena para comparar en el mismo segundo.', en: 'Switch between the copies while it plays to compare at the same second.' },
  colArchivo: { es: 'Archivo · tags y carpeta', en: 'File · tags and folder' },
  colNota: { es: 'Nota', en: 'Grade' },
  notaTip: { es: 'La nota de calidad real del audio (A+ es la mejor, F la peor), según lo que PAILA midió en el sonido y no lo que dice el archivo.', en: 'The real quality grade of the audio (A+ is the best, F the worst), based on what PAILA measured in the sound and not on what the file says.' },
  colFormato: { es: 'Formato', en: 'Format' },
  formatoTip: { es: 'kbps = cuántos datos por segundo guarda el archivo. En MP3, 320 es lo máximo; 128 se nota con auriculares o un buen equipo. FLAC, WAV y AIFF no pierden nada.', en: 'kbps = how much data per second the file stores. In MP3, 320 is the maximum; 128 can be heard on headphones or a good system. FLAC, WAV and AIFF lose nothing.' },
  colDuracion: { es: 'Duración', en: 'Length' },
  colTamano: { es: 'Tamaño', en: 'Size' },
  colPlaylists: { es: 'Playlists', en: 'Playlists' },
  playlistsTip: { es: 'Si mandás uno a la papelera, sus playlists pasan a usar el que se queda.', en: 'If you send one to the Trash, its playlists switch to the one that stays.' },
  sinTags: { es: 'sin tags', en: 'no tags' },
  paraRevisar: { es: ' · Para revisar', en: ' · To review' },
  sinAnalizar: { es: 'Sin analizar', en: 'Not analyzed' },
  yMas: { es: (k: number) => ` y ${k} más`, en: (k: number) => ` and ${k} more` },
  ninguna: { es: 'ninguna', en: 'none' },
  escucharTip: { es: 'Suena esta copia; con las letras de arriba cambiás a otra en el mismo segundo', en: 'This copy plays; with the letters above you switch to another one at the same second' },
  escuchar: { es: 'Escuchar', en: 'Listen' },
  version: { es: (k: number) => `versión ${k}`, en: (k: number) => `version ${k}` },
  recomTip: { es: 'La que propone PAILA: la de mejor nota (y, si empatan, la de más calidad)', en: 'The one PAILA suggests: the one with the best grade (and, if tied, the higher quality)' },
  eligioTip: { es: 'La elegiste vos', en: 'You chose this one' },
  seQueda: { es: ' Se queda', en: ' Stays' },
  recomendadaPunto: { es: ' · recomendada', en: ' · recommended' },
  recomendadaTipSolo: { es: 'La que propone PAILA', en: 'The one PAILA suggests' },
  meQuedoTip: { es: 'Esta se queda y las otras van a la papelera de PAILA (se pueden restaurar)', en: 'This one stays and the others go to PAILA\'s Trash (they can be restored)' },
  meQuedo: { es: 'Me quedo con esta', en: 'Keep this one' },
  recomendadaPar: { es: ' (recomendada)', en: ' (recommended)' },
  quedoEnLista: { es: (a: string, t: string) => `«${a} - ${t}» quedó en la lista «Faltan o suenan mal»`, en: (a: string, t: string) => `"${a} - ${t}" is now in the "Missing or low quality" list` },
  cualFalta: { es: '¿Cuál te falta?', en: 'Which one are you missing?' },
  cualFaltaTip: { es: 'Escuchalos: el que no suena como su título es el mal nombrado, y ese tema seguramente no lo tenés. Sumalo a la lista «Faltan o suenan mal»; cuando llegue a la Bandeja, PAILA lo reconoce por el nombre.', en: 'Listen to them: the one that does not sound like its title is the wrongly named one, and you probably do not have that track. Add it to the "Missing or low quality" list; when it reaches the Inbox, PAILA recognizes it by name.' },
  enLaLista: { es: (t: string) => ` «${t}» en la lista`, en: (t: string) => ` "${t}" is in the list` },
  meFalta: { es: (t: string) => `Me falta «${t}»`, en: (t: string) => `I'm missing "${t}"` },
})

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
const base = (rel: string) => rel.split('/').pop() ?? rel
const dir = (rel: string) => rel.split('/').slice(0, -1).join('/') || T.carpetaPrincipal
const LETTERS = 'ABCDEFGH' // idioma-ok
const PAGE = 40

const TABS: { key: DupLevel | 'todo'; label: string; help: string }[] = [
  { key: 'todo', label: T.tabTodos, help: T.helpTodos },
  { key: 'exact', label: T.tabExact, help: T.helpExact },
  { key: 'quality', label: T.tabQuality, help: T.helpQuality },
  { key: 'probable', label: T.tabProbable, help: T.helpProbable },
  { key: 'version', label: T.tabVersion, help: T.helpVersion },
]

const HUELLA = T.huella

/** Pantalla Duplicados: busca (o muestra lo último encontrado), propone cuál conservar y suma el resto a lo que vas a aplicar. */
export function Duplicates({ total = 0, pending, onStaged }: { total?: number; pending: PendingChange[]; onStaged: () => void }) {
  const job = useJob('dups')
  const [groups, setGroups] = useState<DupGroup[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [keep, setKeep] = useState<Map<number, number>>(new Map()) // índice de grupo → id que se queda
  const [skip, setSkip] = useState<Set<number>>(new Set()) // grupos que no se tocan
  const [msg, setMsg] = useState<string | null>(null)
  const [ultima, setUltima] = useState<{ at: string; cambiaron: number } | null>(null)
  const [inRb, setInRb] = useState(0)
  const [tab, setTab] = useState<DupLevel | 'todo'>('todo')
  const [shown, setShown] = useState(PAGE)
  const [listening, setListening] = useState<number | null>(null)
  const [faltan, setFaltan] = useState(0)

  useEffect(() => { window.paila.analysisInsights().then((x) => setFaltan(x.prints ?? 0)).catch(() => {}) }, [])

  // lo último encontrado sale de la base, al día (lo que ya se fue a la papelera no está): no hace falta buscar de nuevo
  const cargar = async () => {
    const u = await window.paila.repetidosUltimo()
    if (!u) { setGroups(null); setUltima(null); return }
    setUltima({ at: u.at, cambiaron: u.cambiaron })
    // la copia que se queda: la que ya está en la lista, o la que propone PAILA. Lo que se parece solo por el nombre arranca sin
    // tildar: lo decidís escuchándolos (riesgo 1, MASTERPLAN-5)
    setGroups(u.grupos); setKeep(new Map(u.grupos.flatMap((x, i) => { const k = x.propuesto ?? x.keep; return k != null ? [[i, k] as [number, number]] : [] })))
    setSkip(new Set(u.grupos.flatMap((x, i) => (x.decidir && x.propuesto == null ? [i] : []))))
  }
  useEffect(() => { void cargar() }, [])
  useAlCambiarCambios(() => { void cargar() }) // después de aplicar, lo que se fue a la papelera sale solo
  const search = async () => {
    setBusy(true); setMsg(null); setListening(null)
    try { await window.paila.findDuplicates(); setShown(PAGE); setInRb(0); await cargar() } catch (e) { setMsg(clean(e)) } finally { setBusy(false) }
  }

  // lo que va a la papelera según lo elegido, y cuánto cambia respecto de lo que ya está en la lista
  const enLista = useMemo(() => new Set(pending.filter((p) => p.field === 'papelera').map((p) => p.fileId)), [pending])
  const plan = useMemo(() => {
    const items: [number, number][] = []; let size = 0, cambia = 0
    ;(groups ?? []).forEach((g, i) => {
      const k = keep.get(i) ?? g.keep
      const van = skip.has(i) || k == null || g.level === 'version' ? [] : g.items.filter((it) => it.id !== k) // las versiones nunca
      for (const it of van) { items.push([it.id, k!]); size += it.size; if (!enLista.has(it.id) || g.propuesto !== k) cambia++ }
      cambia += g.items.filter((it) => enLista.has(it.id) && !van.includes(it)).length
    })
    return { ids: items.map((x) => x[0]), items, size, cambia }
  }, [groups, keep, skip, enLista])

  useEffect(() => { if (plan.ids.length) window.paila.inRekordbox(plan.ids).then((x) => setInRb(x.length)); else setInRb(0) }, [plan.ids])

  // sumar no toca ningún archivo: reemplaza en la lista lo de estos grupos por lo elegido ahora
  const sumar = async () => {
    setBusy(true)
    try {
      await window.paila.sumarRepetidos(plan.items, (groups ?? []).flatMap((g) => g.items.map((i) => i.id)))
      onStaged(); if (plan.items.length) toast(T.sumados(plan.items.length), 'ok')
    } catch (e) { setMsg(clean(e)) } finally { setBusy(false) }
  }
  const dejar = async (g: DupGroup) => {
    const ids = g.items.map((i) => i.id)
    await window.paila.dejarComoEsta('repetidos', ids); await window.paila.sacarPropuestas('papelera', ids); onStaged()
  }

  const count = (k: DupLevel | 'todo') => (groups ?? []).filter((g) => k === 'todo' || g.level === k).length
  const visible = (groups ?? []).map((g, i) => ({ g, i })).filter(({ g }) => tab === 'todo' || g.level === tab)
  return (
    <div className="page">
      <Cabecera nivel={2} titulo={T.titulo} sub={T.sub} ayuda={<>{T.d1}<b>{T.d2}</b>
        <Info tip={HUELLA} />{T.d3}<b>{T.d4}</b>{T.d5}<b>{T.d6}</b>{T.d7}</>} />
      {faltan > 0 && <Aviso>{T.faltanHuellas(faltan)}</Aviso>}
      {!groups && !busy && <QueVaAPasar total={total} />}
      <div className="row">
        <Boton variant={groups ? 'ghost' : undefined} disabled={busy} onClick={search}>{busy ? T.buscando : groups ? T.buscarDeNuevo : T.buscar}</Boton>
        {ultima && groups && <span className="muted small">{T.ultima(cuando(ultima.at))}</span>}
        {groups && <span className="muted">{groups.length === 0 ? T.ninguno : T.resumen(groups.length - count('version'), count('version'), plan.ids.length, bytes(plan.size))}</span>}
      </div>
      {msg && <Aviso>{msg}</Aviso>}
      {ultima && ultima.cambiaron > 0 && <p className="muted small">{T.cambiaron(ultima.cambiaron)}</p>}
      {job && <JobPanel job={job} unit={T.archivos} onDismiss={() => window.paila.dismissJob('dups')}>{job.running && <Boton variant="ghost" size="sm" disabled={job.cancelling} onClick={() => window.paila.cancelJob('dups')}>{T.cancelar}</Boton>}{job.running && <span className="muted small">{T.primeroTamanos}</span>}</JobPanel>}

      {groups && groups.length > 0 && (
        <>
          <div className="tabs">
            {TABS.map((t) => (
              <button key={t.key} className={`tab ${tab === t.key ? 'on' : ''}`} title={t.help} onClick={() => { setTab(t.key); setShown(PAGE); setListening(null) }}>
                {t.label} ({n(count(t.key))})
              </button>
            ))}
          </div>
          <div className="actionbar">
            {/* con todo ya en la lista, el botón no ofrece lo que ya pasó */}
            {plan.cambia === 0 ? (plan.ids.length > 0 && <span className="small">{T.yaSumados(plan.ids.length)}</span>)
              : <Boton disabled={busy} onClick={sumar}>{plan.ids.length ? T.sumar(plan.ids.length, bytes(plan.size)) : T.sacarDeLista}</Boton>}
            <span className="muted small">{T.deshacerNota}</span>
            {inRb > 0 && <span className="warn-inline"><Icon name="alert" size={13} className="ic-inline" />{T.enRekordbox(inRb)}</span>}
          </div>
          {tab !== 'todo' && <p className="muted small">{TABS.find((t) => t.key === tab)!.help}</p>}
          <div className="box-list">
            {visible.slice(0, shown).map(({ g, i }) => (
              <GroupCard key={i} g={g} skipped={skip.has(i)} keep={keep.get(i) ?? g.keep} onDejar={() => dejar(g)}
                onKeep={(id) => setKeep((m) => new Map(m).set(i, id))}
                onSkip={(on) => setSkip((s) => { const t = new Set(s); on ? t.add(i) : t.delete(i); return t })}
                listening={listening === i} onListen={(on) => setListening(on ? i : null)} />
            ))}
            {visible.length > shown && <Boton variant="ghost" onClick={() => setShown((x) => x + PAGE)}>{T.masGrupos(Math.min(PAGE, visible.length - shown), visible.length - shown)}</Boton>}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Un grupo: una fila por copia (archivo y carpeta · nota · formato · duración · tamaño · playlists) y a la derecha
 * "Escuchar" (A/B, en el mismo segundo) y "Me quedo con esta". La que propone PAILA va marcada como recomendada.
 */
function GroupCard({ g, skipped, keep, onKeep, onSkip, onDejar, listening, onListen }: {
  g: DupGroup; skipped: boolean; keep: number | null; onKeep: (id: number) => void; onSkip: (on: boolean) => void; onDejar: () => void; listening: boolean; onListen: (on: boolean) => void
}) {
  const isVersion = g.level === 'version'
  const items = g.items
  const letter = (k: number) => LETTERS[k] ?? String(k + 1)
  const [elegido, setElegido] = useState<{ lado: number; at: number } | null>(null)
  const escuchar = (k: number) => { onListen(true); setElegido({ lado: k, at: Date.now() }) }
  return (
    <div className={`box dup-grupo ${skipped ? 'skipped' : ''}`}>
      <div className="box-head">
        <b>{g.label}</b>
        <span className="muted small"> {g.why}{g.similarity != null ? T.parecen(Math.round(g.similarity * 100)) : ''}</span>
        {g.why && <Info tip={T.porQueTip} />}
        {g.similarity != null && <Info tip={T.parecenTip} />}
        <span className="push-right" />
        {listening && <Boton variant="ghost" size="sm" onClick={() => onListen(false)}>{T.cerrarEscucha}</Boton>}
        {g.propuesto != null && !skipped && <Pildora tone="ok">{T.paraAplicar}</Pildora>}
        {!isVersion && <label className="small"><input type="checkbox" checked={skipped} onChange={(e) => onSkip(e.target.checked)} />{T.noTocarGrupo}</label>}
        <Boton variant="ghost" size="sm" onClick={onDejar} title={T.dejarTip}>{T.dejar}</Boton>
      </div>
      {g.warning && <div className="warn-inline dup-warning"><Icon name="alert" size={13} className="ic-inline" /> {g.warning} <MissingButtons items={g.items} /></div>}
      {listening && (
        <ABPlayer elegido={elegido} sources={items.slice(0, LETTERS.length).map((it, k) => ({ label: `${letter(k)}: ${it.ext.toUpperCase()}${it.kbps && !isVersion ? ` ${it.kbps}` : ''}`, url: `paila://audio/${it.id}`, title: it.rel }))}
          hint={isVersion ? T.hintVersiones : T.hintCopias} />
      )}
      <table className="dup-filas">
        <colgroup><col style={{ width: 34 }} /><col /><col style={{ width: 70 }} /><col style={{ width: 132 }} /><col style={{ width: 84 }} /><col style={{ width: 84 }} /><col style={{ width: 150 }} /><col style={{ width: 268 }} /></colgroup>
        <thead>
          <tr>
            <th />
            <th>{T.colArchivo}</th>
            <th>{T.colNota} <Info tip={T.notaTip} /></th>
            <th>{T.colFormato} <Info tip={T.formatoTip} /></th>
            <th>{T.colDuracion}</th>
            <th>{T.colTamano}</th>
            <th>{T.colPlaylists}{!isVersion && <Info tip={T.playlistsTip} />}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((it, k) => {
            const queda = !isVersion && it.id === keep
            const recomendada = !isVersion && it.id === g.keep
            const tags = it.artist || it.title ? `${it.artist ?? '¿?'} – ${it.title ?? '¿?'}` : T.sinTags
            return (
              <tr key={it.id} className={queda ? 'keep' : isVersion ? '' : 'sobra'}>
                <td><span className="dup-letra">{letter(k)}</span></td>
                <td className="dup-archivo" title={`${it.rel}\n${tags}`}>
                  <b className="ellipsis">{base(it.rel)}</b>
                  <span className="ellipsis muted small">{tags} · {dir(it.rel)}{it.kind === 'revisar' ? T.paraRevisar : ''}</span>
                </td>
                <td><Nota grade={it.grade} title={it.grade ? GRADE_HELP[it.grade as keyof typeof GRADE_HELP] : T.sinAnalizar} /></td>
                <td className="num">{it.ext.toUpperCase()}{it.kbps ? ` · ${it.kbps}` : ''}</td>
                <td className="num">{duration(it.duration)}</td>
                <td className="num">{bytes(it.size)}</td>
                <td className="ellipsis" title={it.playlists.join('\n')}>{it.playlists.length ? `${it.playlists.slice(0, 2).join(', ')}${it.playlists.length > 2 ? T.yMas(it.playlists.length - 2) : ''}` : <span className="muted">{T.ninguna}</span>}</td>
                <td className="dup-acciones">
                  <Boton variant="ghost" size="sm" onClick={() => escuchar(k)} title={T.escucharTip}><Icon name="play" size={12} className="ic-inline" /> {T.escuchar}</Boton>
                  {isVersion ? <span className="muted small">{T.version(k + 1)}</span>
                    : queda ? <span className="dup-queda" title={recomendada ? T.recomTip : T.eligioTip}><Icon name="check" size={12} className="ic-inline" />{T.seQueda}{recomendada ? T.recomendadaPunto : ''}</span>
                    : <Boton size="sm" variant="ghost" disabled={skipped} onClick={() => onKeep(it.id)} title={recomendada ? T.recomendadaTipSolo : T.meQuedoTip}>{T.meQuedo}{recomendada ? T.recomendadaPar : ''}</Boton>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * El mismo audio con títulos de temas distintos: uno está mal nombrado y el otro tema quizás no lo tenés. Un botón por
 * título suma ese tema a la lista «Faltan o suenan mal» (con el archivo que tiene ese título, para recordar por qué).
 */
function MissingButtons({ items }: { items: DupItem[] }) {
  const [added, setAdded] = useState<Set<string>>(new Set())
  const titled = items.filter((i, k) => i.title && i.artist && items.findIndex((j) => j.title === i.title) === k)
  if (titled.length < 2) return null
  const add = async (i: DupItem) => {
    try {
      await window.paila.addMissingWanted(i.artist!, i.title!, i.id)
      setAdded((s) => new Set(s).add(i.title!))
      toast(T.quedoEnLista(i.artist!, i.title!))
    } catch (e) { toast(clean(e), 'error') }
  }
  return (
    <span className="small">
      <br />{T.cualFalta}
      <Info tip={T.cualFaltaTip} />{' '}
      {titled.map((i) => (
        <button key={i.id} className="btn ghost small" disabled={added.has(i.title!)} onClick={() => add(i)}>{added.has(i.title!) ? <><Icon name="check" size={12} className="ic-inline" />{T.enLaLista(i.title!)}</> : T.meFalta(i.title!)}</button>
      ))}
    </span>
  )
}
