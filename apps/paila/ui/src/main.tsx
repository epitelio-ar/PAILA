// Punto de entrada de la interfaz: monta la app de React en la ventana.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { JobsProvider } from './jobs'
import { ProfileProvider } from './profile'
import { iniciarCabina, iniciarEstilo, leerEstilo } from '@paila/diseno'
import './styles/index.css'
import { marcaArranque } from './arranque'
import { adelantarPedidos } from './hooks/useLibrary'

marcaArranque('js') // el código de la interfaz ya cargó
adelantarPedidos()

iniciarCabina() // el modo cabina, como quedó la última vez
iniciarEstilo() // el estilo (actual o historieta), y se lo deja a NAPIA
void window.paila.setEstilo(leerEstilo())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ProfileProvider><JobsProvider><App /></JobsProvider></ProfileProvider>
  </StrictMode>,
)
