// "Herramientas para DJ y producción" disponible en toda la interfaz: si están prendidas, cómo cambiarlo y la oferta de una sola vez.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

interface ProfileCtx {
  /** Las herramientas para DJ y producción (BPM y tono, "Para DJs", Cabina): apagadas de fábrica. */
  djTools: boolean
  loaded: boolean
  /** Las prende o las apaga a mano. */
  setDjTools: (on: boolean) => Promise<void>
  /** Por qué parece que pinchás (se ofrece una sola vez, ver DjOffer.tsx). null = no hay nada que ofrecer. */
  offer: string[] | null
  /** Mira de nuevo si hay que ofrecerlas (cuando termina un escaneo o un análisis). */
  checkOffer: () => void
  /** "Ahora no": no se ofrece más. */
  dismissOffer: () => void
}

const Ctx = createContext<ProfileCtx>({ djTools: false, loaded: false, setDjTools: async () => {}, offer: null, checkOffer: () => {}, dismissOffer: () => {} })

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [djTools, setOn] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [offer, setOffer] = useState<string[] | null>(null)
  const checkOffer = useCallback(() => { window.paila.djToolsOffer().then(setOffer, () => setOffer(null)) }, [])
  useEffect(() => {
    window.paila.djTools().then((on) => { setOn(on); setLoaded(true) })
    checkOffer()
  }, [checkOffer])
  const setDjTools = useCallback(async (on: boolean) => {
    const saved = await window.paila.setDjTools(on)
    // las columnas que había elegido a mano se reajustan (se pueden volver a elegir desde "⋯" de la tabla)
    try { localStorage.removeItem('paila.cols') } catch { /* sin almacenamiento */ }
    setOn(saved)
    setOffer(null)
  }, [])
  const dismissOffer = useCallback(() => { setOffer(null); void window.paila.djToolsOffered() }, [])
  const value = useMemo(() => ({ djTools, loaded, setDjTools, offer, checkOffer, dismissOffer }), [djTools, loaded, setDjTools, offer, checkOffer, dismissOffer])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useProfile = () => useContext(Ctx)
