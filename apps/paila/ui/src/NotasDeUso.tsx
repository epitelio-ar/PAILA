// Configuración → Notas de uso: la lista de lo que anotaste con el botón "Anotar" (hora, pantalla y texto) y un botón para abrir la carpeta.
import { useEffect, useState } from 'react'
import type { NotaDeUso } from '@paila/shared/types'
import { Boton, Info } from '@paila/diseno'
import { cant, fechaHora, textos } from '@paila/shared/idioma'

const T = textos({
  titulo: { es: 'Notas de uso', en: 'Usage notes' },
  tip: { es: 'Lo que opinaste con el botón «Opinar» (Ctrl+Mayús+N) de la barra de arriba. Cada nota guarda la hora, la pantalla, por dónde venías y una captura de la ventana, en una carpeta de esta PC. No se manda a ningún lado: se la pasás vos a quien te ayuda.', en: 'What you wrote with the «Feedback» button (Ctrl+Shift+N) in the top bar. Each note keeps the time, the screen, where you came from and a screenshot of the window, in a folder on this PC. Nothing is sent anywhere: you hand it over to whoever helps you.' },
  intro: { es: 'Cuando algo te resulte raro, apretá Opinar y contalo. Acá queda la lista.', en: 'When something feels odd, press Feedback and say it. The list stays here.' },
  vacio: { es: 'Todavía no anotaste nada.', en: "You haven't noted anything yet." },
  abrir: { es: 'Abrir la carpeta', en: 'Open the folder' },
  cuantas: { es: (n: number) => cant(n, 'nota', 'notas'), en: (n: number) => cant(n, 'note', 'notes') },
  venias: { es: (v: string) => `Venías de: ${v}`, en: (v: string) => `You came from: ${v}` },
  mandar: { es: 'Mandar a PAILA', en: 'Send to PAILA' },
  porGithub: { es: 'En GitHub', en: 'On GitHub' },
  porMail: { es: 'Por mail', en: 'By email' },
  publico: { es: 'Lo que mandes va a ser público: no pongas datos privados.', en: "What you send will be public: don't include private details." },
  mandarTip: { es: 'Abre un pedido ya escrito con tu nota, la pantalla y la versión (sin tus archivos ni la captura). Vos lo revisás y lo mandás: nada sale solo.', en: 'Opens a ready-written request with your note, the screen and the version (no files, no screenshot). You review it and send it: nothing goes out by itself.' },
  conCaptura: { es: 'con captura', en: 'with screenshot' },
})

export default function NotasDeUso() {
  const [notas, setNotas] = useState<NotaDeUso[] | null>(null)
  useEffect(() => { void window.paila.notasLista().then(setNotas) }, [])
  return (
    <>
      <h4>{T.titulo} <Info tip={T.tip} /></h4>
      <p className="muted small">{T.intro}</p>
      <div className="actionrow">
        <Boton variant="ghost" size="sm" onClick={() => void window.paila.notasAbrirCarpeta()}>{T.abrir}</Boton>
        {notas && notas.length > 0 && <span className="muted small">{T.cuantas(notas.length)}</span>}
      </div>
      {notas && !notas.length && <p className="muted small">{T.vacio}</p>}
      {notas?.map((n) => (
        <div key={n.hora} className="box" style={{ marginTop: 6 }}>
          <div className="box-head"><b>{n.pantalla}</b><span className="muted small">{fechaHora(n.hora)}{n.captura ? ` · ${T.conCaptura}` : ''}</span>
            <span className="push-right" title={T.mandarTip}><b className="small">{T.mandar}</b>{' '}
              <Boton size="sm" variant="ghost" onClick={() => void window.paila.notaMandar(n.hora, 'github')}>{T.porGithub}</Boton>{' '}
              <Boton size="sm" variant="ghost" onClick={() => void window.paila.notaMandar(n.hora, 'mail')}>{T.porMail}</Boton></span></div>
          <div className="choice-body keybox small" style={{ whiteSpace: 'pre-wrap' }}>{n.texto}</div>
          {n.acciones.length > 0 && <div className="choice-body keybox muted small">{T.venias(n.acciones.join(' → '))}</div>}
          <div className="choice-body keybox muted small">{T.publico}</div>
        </div>
      ))}
    </>
  )
}
