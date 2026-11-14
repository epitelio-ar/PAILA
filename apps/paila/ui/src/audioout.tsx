// Salida de audio elegible desde PAILA sin cambiar la de Windows (setSinkId del reproductor). Lo elegido se acuerda.
// El reproductor de siempre pasa por el mezclador compartido de Windows (puede cambiar la frecuencia y el volumen); para que
// el sonido llegue sin tocar está la salida "bit perfect" (bitperfect.tsx: mpv con WASAPI exclusivo), apagada de fábrica.
import { useCallback, useEffect, useState } from 'react'
import { Aviso, Campo } from '@paila/diseno'
import { textos } from '@paila/shared/idioma'
import { BitPerfectOutput, useBitPerfect } from './bitperfect'

const T = textos({
  salida: { es: (i: number) => `Salida ${i}`, en: (i: number) => `Output ${i}` },
  sinSoporte: { es: 'Esta versión de PAILA no puede elegir la salida de audio: suena por la de Windows.', en: "This version of PAILA can't choose the audio output: it plays through the Windows one." },
  campo: { es: 'Salida de audio de PAILA', en: 'PAILA audio output' },
  info: { es: 'Elegí por dónde suena PAILA (auriculares, parlantes, una placa de sonido) sin cambiar lo que usa el resto de Windows. Si desenchufás el dispositivo, PAILA vuelve a la salida de Windows.', en: "Choose where PAILA plays (headphones, speakers, a sound card) without changing what the rest of Windows uses. If you unplug the device, PAILA goes back to the Windows output." },
  ayuda: { es: 'Solo cambia el reproductor de PAILA: el resto de los programas siguen en la salida que tengas en Windows.', en: 'This only changes the PAILA player: all your other programs stay on whichever output Windows uses.' },
  conBp: { es: 'Con "bit perfect" prendido suena por el aparato elegido abajo', en: 'With "bit perfect" on, it plays through the device chosen below' },
  deWindows: { es: 'La de Windows (la de siempre)', en: 'The Windows one (as usual)' },
  faltaSalida: { es: 'La salida que habías elegido no está conectada: suena por la de Windows.', en: "The output you had chosen isn't connected: it plays through the Windows one." },
  nota: { es: 'PAILA suena a través de Windows, que puede retocar apenas el sonido (el volumen o la calidad). Para escuchar de forma normal no se nota; si tenés un equipo de audio bueno, prendé la salida "bit perfect".', en: 'PAILA plays through Windows, which may slightly alter the sound (the volume or the quality). For normal listening you won\'t notice; if you have good audio gear, turn on the "bit perfect" output.' },
})

const KEY = 'paila.sink'
const EVENT = 'paila:sink'
export const DEFAULT_SINK = 'default'

export const readSink = (): string => { try { return localStorage.getItem(KEY) || DEFAULT_SINK } catch { return DEFAULT_SINK } }

type SinkAudio = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }

/** Manda el sonido de `a` a la salida `id`. Devuelve false si no se pudo (el dispositivo ya no está o no hay soporte). */
export async function applySink(a: HTMLAudioElement, id: string): Promise<boolean> {
  const el = a as SinkAudio
  if (!el.setSinkId) return false
  try { await el.setSinkId(id === DEFAULT_SINK ? '' : id); return true } catch { return false }
}

export interface Output { id: string; label: string }

/** Las salidas de audio que ve el reproductor, la elegida, y cómo cambiarla. Se mantiene al día si se enchufa o desenchufa algo. */
export function useAudioOutputs() {
  const [outputs, setOutputs] = useState<Output[]>([])
  const [current, setCurrent] = useState(readSink)
  const supported = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype

  const refresh = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      const outs = all.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
      setOutputs(outs.map((d, i) => ({ id: d.deviceId, label: d.label || T.salida(i + 1) })))
    } catch { setOutputs([]) }
  }, [])

  useEffect(() => {
    void refresh()
    navigator.mediaDevices?.addEventListener?.('devicechange', refresh)
    const sync = () => setCurrent(readSink())
    window.addEventListener(EVENT, sync)
    return () => { navigator.mediaDevices?.removeEventListener?.('devicechange', refresh); window.removeEventListener(EVENT, sync) }
  }, [refresh])

  const choose = useCallback((id: string) => {
    try { localStorage.setItem(KEY, id) } catch { /* sin almacenamiento */ }
    setCurrent(id)
    window.dispatchEvent(new Event(EVENT))
  }, [])

  /** La elegida ya no está enchufada: el reproductor vuelve a la de Windows. */
  const missing = current !== DEFAULT_SINK && outputs.length > 0 && !outputs.some((o) => o.id === current)
  return { outputs, current, choose, supported, missing, refresh }
}

/** Selector de salida con su explicación. Lo usan Configuración y el reproductor. */
export default function AudioOutput() {
  const { outputs, current, choose, supported, missing } = useAudioOutputs()
  const bp = useBitPerfect()
  if (!supported) return <Aviso tone="atencion">{T.sinSoporte}</Aviso>
  return (
    <>
      <Campo label={T.campo} info={T.info}
        ayuda={T.ayuda}>
        <select value={missing ? DEFAULT_SINK : current} onChange={(e) => choose(e.target.value)} style={{ maxWidth: 420 }} disabled={bp.active} title={bp.active ? T.conBp : undefined}>
          <option value={DEFAULT_SINK}>{T.deWindows}</option>
          {outputs.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </Campo>
      {missing && <Aviso tone="atencion">{T.faltaSalida}</Aviso>}
      {!bp.active && <p className="muted small">{T.nota}</p>}
      <BitPerfectOutput />
    </>
  )
}
