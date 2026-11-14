// Punto de entrada de la pantalla de NAPIA: monta la app de React con el diseño de la familia (acento violeta).
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { iniciarEstilo, ponerEstilo } from '@paila/diseno'
import './napia.css'

// el estilo que eligió PAILA (actual o historieta); hasta que llegue, el que quedó la última vez
iniciarEstilo()
void window.napia.estilo().then((e) => iniciarEstilo(e))
// y si se cambia en PAILA con NAPIA abierta, cambia acá también
window.napia.onEstilo((e) => ponerEstilo(e)) // ponerEstilo avisa a las partes que dependen del estilo

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
