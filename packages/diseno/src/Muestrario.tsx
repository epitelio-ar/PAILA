// Muestrario: pantalla oculta de desarrollo con todos los componentes en todos sus estados, con el acento de PAILA y el de NAPIA,
// y también en modo cabina (alto contraste y letra más grande, src/cabina.ts).
import { useState, type ReactNode } from 'react'
import { Anillo, Aviso, Barra, BarrasH, Boton, Cabecera, Caja, Campo, Casilla, Cifra, Columnas, FilaEstado, Info, Nota, PantallaVacia, Paso, Pestanas, Pildora, Ruta, Ventana, ZonaSoltar, colorNota, colorSerie } from './index'

const GRADES = ['A+', 'A', 'B', 'C', 'D', 'F']
const COLORES: [string, string][] = [
  ['fondo', '--fondo'], ['superficie', '--superficie'], ['superficie-2', '--superficie-2'], ['superficie-3', '--superficie-3'], ['borde', '--borde'],
  ['texto', '--texto'], ['texto-suave', '--texto-suave'], ['acento', '--acento'], ['ok', '--ok'], ['atención', '--atencion'], ['error', '--error'], ['info', '--info'],
]

const Cell = ({ label, children }: { label: string; children: ReactNode }) => <div className="mu-cell">{children}<small>{label}</small></div>
const Sec = ({ title, children }: { title: string; children: ReactNode }) => <section className="mu-sec"><h4>{title}</h4>{children}</section>

/** Todas las muestras de una app (el acento sale de data-app; `cabina` = en modo cabina). */
function Muestras({ app, cabina }: { app: 'paila' | 'napia'; cabina?: boolean }) {
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState('B')
  const [tab, setTab] = useState<'a' | 'b' | 'c'>('a')
  const [chk, setChk] = useState([true, false])
  const [radio, setRadio] = useState('x')
  return (
    <div className="mu-app" data-app={app} data-cabina={cabina ? '1' : undefined}>
      <h2>{app === 'paila' ? 'PAILA' : 'NAPIA'} <Pildora tone="acento">acento de {app === 'paila' ? 'PAILA' : 'NAPIA'}</Pildora>{cabina && <Pildora tone="info">modo cabina</Pildora>}</h2>

      <Sec title="Colores por función">
        <div className="mu-row">{COLORES.map(([n, v]) => <div key={n}><div className="mu-sw" style={{ background: `var(${v})` }} /><div className="mu-sw-name">{n}</div></div>)}</div>
      </Sec>

      <Sec title="Botones: normal · encima · elegido · desactivado · cargando">
        {(['primary', 'ghost', 'danger'] as const).map((v) => (
          <div className="mu-row" key={v}>
            <Cell label="normal"><Boton variant={v}>Aplicar</Boton></Cell>
            <Cell label="encima"><span className="mu-hover"><Boton variant={v}>Aplicar</Boton></span></Cell>
            <Cell label="elegido"><Boton variant={v} selected>Aplicar</Boton></Cell>
            <Cell label="desactivado"><Boton variant={v} disabled>Aplicar</Boton></Cell>
            <Cell label="cargando"><Boton variant={v} loading>Aplicando</Boton></Cell>
          </div>
        ))}
        <div className="mu-row">
          <Cell label="chico"><Boton size="sm" variant="ghost">Chico</Boton></Cell>
          <Cell label="normal"><Boton variant="ghost">Normal</Boton></Cell>
          <Cell label="grande"><Boton size="lg">Grande</Boton></Cell>
          <Cell label="grupo (elegido: B)"><span className="mu-row">{['A', 'B', 'C'].map((g) => <Boton key={g} size="sm" variant="ghost" selected={sel === g} onClick={() => setSel(g)}>{g}</Boton>)}</span></Cell>
          <Cell label="enlace"><button className="link">Ver más →</button></Cell>
        </div>
      </Sec>

      <Sec title="Notas de calidad (un color fijo por nota)">
        <div className="mu-row">{GRADES.map((g) => <Nota key={g} grade={g} title={`Nota ${g}`} />)}<Nota grade={null} /></div>
        <div className="mu-row">{GRADES.map((g) => <Nota key={g} grade={g} big />)}</div>
      </Sec>

      <Sec title="Píldoras">
        <div className="mu-row">
          <Pildora>neutra</Pildora><Pildora tone="acento">acento</Pildora><Pildora tone="ok">lo tenés</Pildora><Pildora tone="info">otra versión</Pildora>
          <Pildora tone="atencion">en mala calidad</Pildora><Pildora tone="error">te falta</Pildora>
        </div>
      </Sec>

      <Sec title="Cajas: normal · elegida · apagada · error">
        <Caja head={<><b>Grupo de duplicados</b><Pildora tone="info">2 archivos</Pildora></>}><div style={{ padding: '8px 14px' }}>Contenido de la caja</div></Caja>
        <div className="mu-row" style={{ alignItems: 'stretch' }}>
          <Caja pad selected style={{ flex: 1, margin: 0 }} head={<b>Elegida</b>}>… (con <code>pad</code>: margen adentro)</Caja>
          <Caja skipped style={{ flex: 1, margin: 0 }} head={<b>Apagada</b>}><div style={{ padding: '8px 14px' }}>…</div></Caja>
          <Caja error style={{ flex: 1, margin: 0 }} head={<b>Con error</b>}><div style={{ padding: '8px 14px' }}>…</div></Caja>
        </div>
      </Sec>

      <Sec title="Barras de avance: 0 · mitad · lista · error · sin saber cuánto falta">
        <div className="mu-row"><Barra value={0} /><Barra value={45} /><Barra value={100} tone="ok" /><Barra value={60} tone="error" /><Barra /></div>
        <Barra big value={72} />
        <Barra big />
      </Sec>

      <Sec title="Avisos">
        <Aviso>Dato: te faltan las huellas de 3.683 temas.</Aviso>
        <Aviso tone="ok">Listo: se aplicaron 614 cambios.</Aviso>
        <Aviso tone="atencion">Atención: este disco no está conectado.</Aviso>
        <Aviso tone="error">Error: no se pudo escribir el archivo.</Aviso>
      </Sec>

      <Sec title="Pestañas (con las flechas del teclado)">
        <Pestanas label="Ejemplo" value={tab} onChange={setTab} items={[{ key: 'a', label: 'Calidad' }, { key: 'b', label: 'Épocas', count: 12 }, { key: 'c', label: 'Artistas' }]} />
      </Sec>

      <Sec title="Campos y casillas: normal · elegida · desactivada">
        <Campo label="Nombre de la playlist" info="El nombre que ves en la barra lateral." ayuda="Podés cambiarlo cuando quieras."><input placeholder="Mi playlist" /></Campo>
        <Casilla checked={chk[0]} onChange={(v) => setChk([v, chk[1]])} label="Escuchar y coleccionar" detail="Tener la música ordenada y con buena calidad." info="El perfil de base." />
        <Casilla checked={chk[1]} onChange={(v) => setChk([chk[0], v])} label="DJ" detail="Pinchar con Rekordbox." />
        <Casilla checked={false} onChange={() => {}} label="Desactivada" detail="No se puede elegir ahora." disabled />
        <div className="mu-row"><Casilla tipo="radio" checked={radio === 'x'} onChange={() => setRadio('x')} label="Opción X" /><Casilla tipo="radio" checked={radio === 'y'} onChange={() => setRadio('y')} label="Opción Y" /></div>
      </Sec>

      <Sec title="Cabecera con ⓘ y pantalla vacía">
        <Cabecera titulo="Calidad de CD o mejor" info="Audio sin pérdida a 44,1 kHz y 16 bits, como el de un disco." acciones={<Boton size="sm" variant="ghost">Ver más</Boton>} />
        <PantallaVacia titulo="No hay nada para mostrar" accion={<Boton size="sm">Escanear</Boton>}>Cuando PAILA escanee tu música, acá vas a ver tu colección.</PantallaVacia>
      </Sec>

      <Sec title="Gráficos: barras, columnas y anillo (colores de las notas y de la serie)">
        <BarrasH titulo="Géneros" datos={[{ label: 'Rock', valor: 820, color: colorSerie(0) }, { label: 'Cumbia', valor: 410, color: colorSerie(1) }, { label: 'Electrónica', valor: 240, color: colorSerie(2) }, { label: 'Jazz', valor: 60, color: colorSerie(3) }]} />
        <Columnas titulo="Décadas" alto={110} datos={[{ label: '1970s', valor: 80 }, { label: '1980s', valor: 210 }, { label: '1990s', valor: 540 }, { label: '2000s', valor: 380 }, { label: '2010s', valor: 150 }]} />
        <Anillo titulo="Notas" centro="72 %" datos={GRADES.map((g, i) => ({ label: g, valor: [40, 120, 90, 30, 12, 6][i], color: colorNota(g) }))} />
      </Sec>

      <Sec title="Recorrido por pasos, carpeta y zona para soltar">
        <Paso n={1} hecho titulo="Qué bajar" info="Una lista de temas: CSV de Exportify o Chosic, texto pegado o la lista «Faltan o suenan mal» de PAILA."><span className="muted">80s Mood · 140 temas</span></Paso>
        <Paso n={2} titulo="Dónde" acciones={<Boton size="sm" variant="ghost">Elegir otra</Boton>}><Ruta ruta="D:\Soulseek\Descargando\80s Mood" acciones={<Boton size="sm" variant="ghost">Abrir</Boton>} /></Paso>
        <Paso n={3} apagado titulo="Bajar" />
        <ZonaSoltar onSoltar={() => {}} onElegir={() => {}}><b>Soltá acá tu lista</b><span className="small">o tocá para elegirla (CSV, .txt o .m3u)</span></ZonaSoltar>
      </Sec>

      <Sec title="Avance tema por tema: cifras y filas con estado">
        <div className="mu-row">
          <Cifra valor={12} label="bajados" tone="ok" /><Cifra valor={3} label="ya estaban" tone="info" /><Cifra valor={2} label="no se encontraron" tone="atencion" info="Nadie los tenía compartidos con ese nombre." /><Cifra valor={123} label="faltan" />
        </div>
        <Caja>
          <FilaEstado tone="ok" titulo="Soda Stereo - De Música Ligera" sub="flac" estado="Bajado" />
          <FilaEstado tone="acento" activo titulo="Virus - Wadu Wadu" sub="mp3 320 kbps" estado="Bajando" avance={45} />
          <FilaEstado tone="neutro" activo titulo="Charly García - Demoliendo Hoteles" estado="Buscando" />
          <FilaEstado tone="info" titulo="Sumo - La Rubia Tarada" estado="Ya estaba" />
          <FilaEstado tone="atencion" titulo="Los Redondos - Un Tema Raro" sub="Nadie lo tiene compartido (o con otro nombre)." estado="No se encontró" />
          <FilaEstado tone="error" titulo="Fito Páez - Mariposa Tecknicolor" sub="Lo encontró, pero los que lo tenían no respondieron." estado="No se pudo" />
          <FilaEstado tone="neutro" titulo="Spinetta - Seguir Viviendo sin Tu Amor" estado="En espera" />
        </Caja>
      </Sec>

      <Sec title="Ventana y ⓘ con tooltip">
        <div className="mu-row">
          <Boton variant="ghost" onClick={() => setOpen(true)}>Abrir una ventana</Boton>
          <span>Huella acústica <Info tip={'Cómo suena el tema, sin importar el nombre.\nSirve para encontrar el mismo tema aunque tenga otro nombre.'} /></span>
        </div>
        {open && <Ventana onClose={() => setOpen(false)}><h3>Una ventana</h3><p className="muted">Se cierra con la cruz o tocando afuera.</p><div className="mu-row"><Boton onClick={() => setOpen(false)}>Listo</Boton></div></Ventana>}
      </Sec>

      <Sec title="Letra y números de ancho fijo">
        <div className="mu-type">
          <div style={{ fontSize: 'var(--fs-2xl)', fontWeight: 650 }}>Título 26</div><div style={{ fontSize: 'var(--fs-xl)', fontWeight: 650 }}>Subtítulo 20</div>
          <div style={{ fontSize: 'var(--fs-lg)' }}>Destacado 15</div><div>Texto 13</div><div className="muted small">Ayuda 12</div><div className="muted" style={{ fontSize: 'var(--fs-xs)' }}>Mínimo 11</div>
        </div>
        <div className="mu-row">
          <Cell label="sin ancho fijo"><span>111 · 888 BPM</span></Cell>
          <Cell label="con .num (columnas parejas)"><span className="num">111 · 888 BPM</span></Cell>
        </div>
      </Sec>

      <Sec title="Espacios, radios, sombras">
        <div className="mu-space">{[4, 8, 12, 16, 24, 32].map((n) => <div key={n} style={{ textAlign: 'center' }}><i style={{ width: n, height: n }} /><div className="mu-sw-name">{n}</div></div>)}</div>
        <div className="mu-row">
          {['r-sm', 'r-md', 'r-lg', 'r-pill'].map((r) => <div key={r} className="mu-box" style={{ borderRadius: `var(--${r})` }}>{r}</div>)}
          {['sombra-1', 'sombra-2', 'sombra-3'].map((s) => <div key={s} className="mu-box" style={{ boxShadow: `var(--${s})` }}>{s}</div>)}
        </div>
      </Sec>
    </div>
  )
}

/** Las dos apps lado a lado, con la misma base. */
export default function Muestrario() {
  return (
    <div className="page">
      <h2>Muestrario</h2>
      <p className="muted" style={{ margin: '4px 0 var(--sp-4)' }}>Pantalla de desarrollo (Ctrl+Mayús+M): todos los componentes de @paila/diseno en todos sus estados, con el acento de PAILA y el de NAPIA, y en modo cabina (Ctrl+Mayús+C lo prende en toda la ventana).</p>
      <div className="mu"><Muestras app="paila" /><Muestras app="napia" /><Muestras app="paila" cabina /><Muestras app="napia" cabina /></div>
    </div>
  )
}
