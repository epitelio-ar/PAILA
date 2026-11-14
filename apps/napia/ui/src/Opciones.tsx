// Paso 2, dónde y cómo: la carpeta de NAPIA (Música\NAPIA o la que elijas; una subcarpeta por lista), en qué disco está,
// cuánto espacio queda y si es externo; la primera vez pregunta si está bien. Si la Bandeja de PAILA lo va a recibir, la
// calidad y las opciones. Avisa si esta misma lista ya se bajó antes.
import { Aviso, Boton, Casilla, Info, Paso, Ruta } from '@paila/diseno'
import type { Calidad, Destino, Disco, IndexSummary, NapiaOptions, YaTenes } from '@paila/shared/napia'
import { num, textos } from '@paila/shared/idioma'
import { TIP, n } from './textos'

const T = textos({
  titulo: { es: 'Dónde y cómo', en: 'Where and how' },
  dondeSeGuarda: { es: 'Dónde se guarda lo que baje', en: 'Where your downloads are saved' },
  elegirOtra: { es: 'Elegir otra', en: 'Choose another' },
  volverA: { es: 'Volver a Música\\NAPIA', en: 'Back to Música\\NAPIA' },
  abrir: { es: 'Abrir', en: 'Open' },
  cadaLista: {
    es: ' Cada lista va en su propia carpeta, con su nombre («Mi lista»). Si la volvés a bajar otro día, lo nuevo se suma ahí y lo que ya tenías no se baja de nuevo. Lo que está bajando queda aparte y aparece ahí cuando termina.',
    en: " Each list goes in its own folder, with its name (“My list”). If you download it again another day, what's new is added there and what you already had isn't downloaded again. What's being downloaded is kept apart and shows up there when it's done.",
  },
  externo: { es: 'Es un disco externo: si no está enchufado cuando bajes, NAPIA no va a poder guardar ahí.', en: "It's an external drive: if it isn't plugged in when you download, NAPIA won't be able to save there." },
  pocoEspacio: {
    es: (g: string) => `Queda poco espacio en ese disco (${g}). Cada tema ocupa entre 5 y 50 MB.`,
    en: (g: string) => `There's little space left on that drive (${g}). Each track takes between 5 and 50 MB.`,
  },
  guardamos: { es: '¿Guardamos acá?', en: 'Save here?' },
  primeraVez: {
    es: ' Es la primera vez: fijate si te sirve esta carpeta. Después la podés cambiar cuando quieras.',
    en: " This is the first time: check that this folder works for you. You can change it whenever you want.",
  },
  siGuardar: { es: 'Sí, guardar acá', en: 'Yes, save here' },
  laBandeja: { es: 'La Bandeja de PAILA', en: "PAILA's Inbox" },
  vigilaEsa: { es: ' vigila esa carpeta: lo bajado le llega solo.', en: ' watches that folder: what you download reaches it on its own.' },
  vigilaOtra: {
    es: (b: string) => ` vigila otra carpeta (${b}). Para que lo bajado le llegue solo, abrí PAILA: en su Bandeja te ofrece vigilar la de NAPIA.`,
    en: (b: string) => ` watches another folder (${b}). So that what you download reaches it on its own, open PAILA: in its Inbox it offers to watch NAPIA's.`,
  },
  usasPaila: { es: '¿Usás PAILA? En su pantalla Bandeja', en: 'Do you use PAILA? On its Inbox screen' },
  teVaAOfrecer: { es: ' te va a ofrecer vigilar ', en: ' it will offer to watch ' },
  asiRevisa: { es: ': así revisa sola lo que baje sockseek.', en: ': that way it checks on its own what sockseek downloads.' },
  calidad: { es: 'Calidad', en: 'Quality' },
  buena: { es: 'Buena calidad', en: 'Good quality' },
  buenaDetalle: { es: 'MP3 de 320 kbps o sin pérdida (si hay, primero sin pérdida). Lo recomendado.', en: 'MP3 at 320 kbps or lossless (lossless first, if there is any). Recommended.' },
  sinPerdida: { es: 'Solo sin pérdida', en: 'Lossless only' },
  sinPerdidaDetalle: { es: 'FLAC, WAV o AIFF (primero FLAC). Va a encontrar menos.', en: 'FLAC, WAV or AIFF (FLAC first). It will find fewer.' },
  cualquiera: { es: 'La que haya', en: 'Whatever is there' },
  cualquieraDetalle: { es: 'Busca primero la mejor calidad y, si no la encuentra, se conforma con lo que haya.', en: "It looks for the best quality first and, if it can't find it, settles for whatever is there." },
  remaster: { es: 'Sacar "- Remaster" de los títulos', en: 'Remove "- Remaster" from titles' },
  remasterDetalle: { es: 'Encuentra más temas de listas de Spotify.', en: 'Finds more tracks from Spotify lists.' },
  saltear: { es: 'Saltear lo que ya tenés bien en PAILA', en: 'Skip what you already have in good quality in PAILA' },
  saltearDetalle: {
    es: 'No baja de nuevo lo que ya tenés en buena calidad (nota A o B). Lo que tenés en mala calidad (C, D o F) lo baja igual, para reemplazarlo.',
    en: "Doesn't download again what you already have in good quality (grade A or B). What you have in poor quality (C, D or F) is downloaded anyway, to replace it.",
  },
  nombres: { es: 'Que llegue con el nombre arreglado', en: 'Arrive with the name fixed' },
  nombresDetalle: {
    es: 'Cada tema llega como «Artista - Título», con ese artista y ese título en los tags, como en la lista.',
    en: 'Each track arrives as “Artist - Title”, with that artist and title in its tags, just like in the list.',
  },
  probar: { es: 'Probar con los primeros 5', en: 'Try with the first 5' },
  probarDetalle: { es: 'Para ver que encuentra bien antes de bajar todo.', en: 'To check it finds them well before downloading everything.' },
  mejorar: {
    es: (m: number) => `${n(m)} ${m === 1 ? 'lo tenés' : 'los tenés'} en mala calidad: se ${m === 1 ? 'baja' : 'bajan'} para reemplazar${m === 1 ? 'lo' : 'los'} (solo si llega uno claramente mejor).`,
    en: (m: number) => `You have ${n(m)} in poor quality: ${m === 1 ? 'it is' : 'they are'} downloaded to replace ${m === 1 ? 'it' : 'them'} (only if a clearly better one arrives).`,
  },
  yaTenes: {
    es: (t: number, f: number) => `${n(t)} ${t === 1 ? 'tema ya está' : 'temas ya están'} en PAILA y se ${t === 1 ? 'saltea' : 'saltean'}; se ${f === 1 ? 'baja' : 'bajan'} ${n(f)}.`,
    en: (t: number, f: number) => `${n(t)} ${t === 1 ? 'track is' : 'tracks are'} already in PAILA and ${t === 1 ? 'is' : 'are'} skipped; ${n(f)} will be downloaded.`,
  },
  verCuales: { es: 'Ver cuáles', en: 'See which' },
  notaDe: { es: (g: string) => `nota ${g}: se reemplaza`, en: (g: string) => `grade ${g}: gets replaced` },
  yaSeBajo: { es: 'Esta lista ya se bajó antes: ', en: 'This list was downloaded before: ' },
  yaEstan: { es: ' ya están (se saltean), ', en: ' are already there (skipped), ' },
  noSeEncontraron: { es: ' no se encontraron (se vuelven a buscar)', en: " weren't found (they're searched for again)" },
  noLlegaron: { es: ' no llegaron a terminar', en: " didn't finish" },
  aMedias: { es: ' quedaron a medio bajar', en: ' were left half-downloaded' },
  libres: { es: (d: string) => `: hay ${d} libres`, en: (d: string) => `: ${d} free` },
  queda: {
    es: (nombre: string, tipo: string, libre: string) => `Queda en ${nombre}${tipo}${libre}.`,
    en: (nombre: string, tipo: string, libre: string) => `It's saved on ${nombre}${tipo}${libre}.`,
  },
  carpetaRed: { es: (r: string) => `la carpeta de red ${r}`, en: (r: string) => `the network folder ${r}` },
  elDisco: { es: (r: string, e: string) => `el disco ${r}${e}`, en: (r: string, e: string) => `drive ${r}${e}` },
  tipoExterno: { es: ' (externo)', en: ' (external)' },
  tipoInterno: { es: ' (el de la compu)', en: " (the computer's own)" },
})

const norm = (p: string) => p.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase()
/** La Bandeja mira también las subcarpetas: le llega si vigila esa carpeta o una que la contiene. */
const dentroDe = (folder: string, bandeja: string | null) => !!bandeja && (norm(folder) === norm(bandeja) || norm(folder).startsWith(norm(bandeja) + '/'))
const gb = (b: number) => `${num(b / 1e9, { maximumFractionDigits: b < 1e10 ? 1 : 0 })} GB`
const POCO_ESPACIO = 3e9

function textoDisco(d: Disco): string {
  const nombre = d.red ? T.carpetaRed(d.raiz) : T.elDisco(d.raiz.replace(/\\$/, ''), d.etiqueta ? ` («${d.etiqueta}»)` : '')
  const tipo = d.red ? '' : d.externo ? T.tipoExterno : d.externo === false ? T.tipoInterno : ''
  return T.queda(nombre, tipo, d.libre != null ? T.libres(gb(d.libre)) : '')
}

const CALIDADES: { key: Calidad; label: string; detail: string; info?: string }[] = [
  { key: 'buena', get label() { return T.buena }, get detail() { return T.buenaDetalle }, info: TIP.kbps },
  { key: 'sinperdida', get label() { return T.sinPerdida }, get detail() { return T.sinPerdidaDetalle }, info: TIP.sinPerdida },
  { key: 'cualquiera', get label() { return T.cualquiera }, get detail() { return T.cualquieraDetalle }, info: TIP.laQueHaya },
]

interface Props {
  destino: Destino | null
  onDestino: (d: Destino) => void
  options: NapiaOptions | null
  onOptions: (o: NapiaOptions) => void
  previous: IndexSummary | null
  yaTenes: YaTenes | null
  disabled: boolean
  apagado: boolean
}

export default function Opciones({ destino, onDestino, options, onOptions, previous, yaTenes, disabled, apagado }: Props) {
  if (!destino || !options) return null
  const final = destino.folder
  const bandejaOk = dentroDe(final, destino.bandeja)
  const d = destino.disco
  return (
    <Paso n={2} titulo={T.titulo} apagado={apagado}>
      <div className="campo-label">{T.dondeSeGuarda}</div>
      <Ruta ruta={destino.folder} acciones={<>
        <Boton size="sm" variant="ghost" disabled={disabled} onClick={async () => onDestino(await window.napia.chooseDestino())}>{T.elegirOtra}</Boton>
        {!destino.porDefecto && <Boton size="sm" variant="ghost" disabled={disabled} onClick={async () => onDestino(await window.napia.chooseDestino(true))}>{T.volverA}</Boton>}
        <Boton size="sm" variant="ghost" onClick={() => window.napia.openFolder(destino.folder)}>{T.abrir}</Boton>
      </>} />
      <p className="muted small" style={{ margin: '6px 0 0' }}>{d && textoDisco(d)}{T.cadaLista}<Info tip={TIP.carpeta} /></p>
      {d?.externo && <Aviso tone="atencion" style={{ marginTop: 'var(--sp-2)' }}>{T.externo}</Aviso>}
      {d?.libre != null && d.libre < POCO_ESPACIO && <Aviso tone="atencion" style={{ marginTop: 'var(--sp-2)' }}>{T.pocoEspacio(gb(d.libre))}</Aviso>}
      {!destino.confirmado && (
        <Aviso style={{ marginTop: 'var(--sp-2)' }}>
          <b>{T.guardamos}</b>{T.primeraVez}
          <div className="row" style={{ marginTop: 'var(--sp-2)' }}>
            <Boton size="sm" disabled={disabled} onClick={async () => onDestino(await window.napia.confirmDestino())}>{T.siGuardar}</Boton>
            <Boton size="sm" variant="ghost" disabled={disabled} onClick={async () => onDestino(await window.napia.chooseDestino())}>{T.elegirOtra}</Boton>
          </div>
        </Aviso>
      )}
      {bandejaOk
        ? <Aviso tone="ok" style={{ marginTop: 'var(--sp-2)' }}>{T.laBandeja}<Info tip={TIP.bandeja} />{T.vigilaEsa}</Aviso>
        : destino.bandeja
          ? <Aviso tone="atencion" style={{ marginTop: 'var(--sp-2)' }}>{T.laBandeja}<Info tip={TIP.bandeja} />{T.vigilaOtra(destino.bandeja)}</Aviso>
          : <Aviso style={{ marginTop: 'var(--sp-2)' }}>{T.usasPaila}<Info tip={TIP.bandeja} />{T.teVaAOfrecer}<b>{final}</b>{T.asiRevisa}</Aviso>}

      <div className="campo-label" style={{ marginTop: 'var(--sp-4)' }}>{T.calidad}</div>
      <div className="calidades">
        {CALIDADES.map((c) => <Casilla key={c.key} tipo="radio" checked={options.calidad === c.key} disabled={disabled} onChange={() => onOptions({ ...options, calidad: c.key })} label={c.label} detail={c.detail} info={c.info} />)}
      </div>
      <div className="calidades" style={{ marginTop: 'var(--sp-2)' }}>
        <Casilla checked={options.sacarRemaster} disabled={disabled} onChange={(v) => onOptions({ ...options, sacarRemaster: v })} label={T.remaster} detail={T.remasterDetalle} info={TIP.remaster} />
        <Casilla checked={options.saltearTenes} disabled={disabled} onChange={(v) => onOptions({ ...options, saltearTenes: v })} label={T.saltear} detail={T.saltearDetalle} info={TIP.yaTenes} />
        <Casilla checked={options.arreglarNombres !== false} disabled={disabled} onChange={(v) => onOptions({ ...options, arreglarNombres: v })} label={T.nombres} detail={T.nombresDetalle} info={TIP.nombres} />
        <Casilla checked={options.primeros != null} disabled={disabled} onChange={(v) => onOptions({ ...options, primeros: v ? 5 : null })} label={T.probar} detail={T.probarDetalle} info={TIP.probar} />
      </div>
      {yaTenes && (yaTenes.tenes.length > 0 || yaTenes.mejorar.length > 0) && (
        <Aviso style={{ marginTop: 'var(--sp-3)' }}>
          {yaTenes.tenes.length > 0 && T.yaTenes(yaTenes.tenes.length, yaTenes.faltan.length)}
          {yaTenes.mejorar.length > 0 && <>{yaTenes.tenes.length > 0 ? ' ' : ''}{T.mejorar(yaTenes.mejorar.length)}</>}
          <details style={{ marginTop: 'var(--sp-2)' }}>
            <summary>{T.verCuales}</summary>
            <ul className="small" style={{ margin: 'var(--sp-2) 0 0', paddingLeft: 'var(--sp-4)', maxHeight: 180, overflow: 'auto' }}>
              {yaTenes.tenes.map((t, i) => <li key={i}>{t.artist} - {t.title} <span className="muted">({t.enPaila})</span></li>)}
              {yaTenes.mejorar.map((t, i) => <li key={`m${i}`}>{t.artist} - {t.title} <span className="muted">({T.notaDe(t.nota)} · {t.enPaila})</span></li>)}
            </ul>
          </details>
        </Aviso>
      )}
      {previous && previous.bajados + previous.noEncontrados + previous.pendientes > 0 && (
        <Aviso style={{ marginTop: 'var(--sp-3)' }}>
          {T.yaSeBajo}{n(previous.bajados)}{T.yaEstan}{n(previous.noEncontrados)}{T.noSeEncontraron}{previous.pendientes ? `, ${n(previous.pendientes)}${T.noLlegaron}` : ''}{previous.aMedias ? <>, {n(previous.aMedias)}{T.aMedias}<Info tip={TIP.aMedias} /></> : ''}.
        </Aviso>
      )}
    </Paso>
  )
}
