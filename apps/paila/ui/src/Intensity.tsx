// Selector de intensidad del análisis (Tranqui / Normal / A fondo) para la pantalla Análisis, con una explicación honesta
// de cuánto rinde en esta PC, y los avisos cuando cambia sola (la notebook pasó a batería o volvió a enchufarse).
import { useEffect, useState } from 'react'
import type { Intensity, IntensityInfo } from '@paila/shared/types'
import { toast } from './toast'
import { Info, Pildora } from '@paila/diseno'
import { textos, tr, cant, num } from '@paila/shared/idioma'

const T = textos({
  hilos: { es: (n: number) => `${cant(n, 'tema', 'temas')} a la vez`, en: (n: number) => `${cant(n, 'track', 'tracks')} at a time` },
  hiloN: { es: (n: number) => cant(n, 'hilo', 'hilos'), en: (n: number) => cant(n, 'thread', 'threads') },
  esteCpu: { es: (cpu: string) => `Este procesador (${cpu})`, en: (cpu: string) => `This processor (${cpu})` },
  esteSolo: { es: 'Este procesador', en: 'This processor' },
  pocos: { es: (cpu: string, h: string) => `${cpu} tiene ${h}: los tres modos andan casi igual.`, en: (cpu: string, h: string) => `${cpu} has ${h}: all three modes run about the same.` },
  compartido: { es: (cpu: string, nucleos: number, hilos: number) => `${cpu} tiene ${nucleos} núcleos y ${hilos} hilos. Los hilos de más comparten núcleo, así que A fondo rinde entre un 20 y un 45 % más que Normal, no el doble, y Tranqui hace algo más de la mitad que Normal.`, en: (cpu: string, nucleos: number, hilos: number) => `${cpu} has ${nucleos} cores and ${hilos} threads. The extra threads share a core, so Full power does 20 to 45 % more than Normal, not double, and Easy does a bit more than half of Normal.` },
  libre: { es: (cpu: string, hilos: number, unoPorNucleo: boolean) => `${cpu} tiene ${hilos} hilos${unoPorNucleo ? ' (uno por núcleo)' : ''}. A fondo usa núcleos que Normal deja libres: rinde bastante más, aunque calienta más la PC. Tranqui hace algo más de la mitad que Normal.`, en: (cpu: string, hilos: number, unoPorNucleo: boolean) => `${cpu} has ${hilos} threads${unoPorNucleo ? ' (one per core)' : ''}. Full power uses cores that Normal leaves free: it does quite a bit more, but it heats the PC up more. Easy does a bit more than half of Normal.` },
  pausadoBateria: { es: 'En pausa: la notebook está a batería (modo Tranqui). Sigue sola al enchufarla.', en: 'Paused: the laptop is on battery (Easy mode). It continues on its own when you plug it in.' },
  bateria: { es: (h: string) => `A batería: va en Normal (${h}). Vuelve a "A fondo" al enchufar la notebook.`, en: (h: string) => `On battery: running at Normal (${h}). Goes back to "Full power" when you plug in the laptop.` },
  ahora: { es: (h: string) => `Ahora: ${h}.`, en: (h: string) => `Now: ${h}.` },
  poca: { es: (gb: string) => ` Hay poca memoria libre (${gb} GB): PAILA analiza menos temas a la vez para no trabar la PC.`, en: (gb: string) => ` There is little free memory (${gb} GB): PAILA analyzes fewer tracks at a time so the PC doesn't freeze.` },
  intensidad: { es: 'Intensidad', en: 'Intensity' },
  intensidadTip: { es: 'Cuántos temas analiza PAILA al mismo tiempo. Siempre con prioridad baja: si usás la PC para otra cosa, eso va primero. Se puede cambiar en cualquier momento, sin cortar el análisis.', en: 'How many tracks PAILA analyzes at the same time. Always at low priority: if you use the PC for something else, that comes first. You can change it any time, without stopping the analysis.' },
  elegido: { es: 'elegido', en: 'selected' },
})

const MODES: { key: Intensity; label: string; help: string }[] = [
  { key: 'tranqui', label: tr({ es: 'Tranqui', en: 'Easy' }), help: tr({ es: 'La PC queda bien liviana: ideal mientras trabajás, producís o pinchás. A batería se pausa solo y sigue al enchufar.', en: 'The PC stays light: ideal while you work, produce or DJ. On battery it pauses by itself and continues when you plug in.' }) },
  { key: 'normal', label: tr({ es: 'Normal', en: 'Normal' }), help: tr({ es: 'El equilibrio: avanza bien y se puede seguir usando la PC sin notarlo.', en: 'The balance: it moves along well and you can keep using the PC without noticing.' }) },
  { key: 'fondo', label: tr({ es: 'A fondo', en: 'Full power' }), help: tr({ es: 'Para dejarla analizando sola. La PC se calienta y suenan más los ventiladores. Solo enchufada: a batería baja solo a Normal.', en: 'To leave it analyzing on its own. The PC heats up and the fans get louder. Only when plugged in: on battery it drops to Normal by itself.' }) },
]

const hilos = (n: number) => T.hilos(n)

/**
 * Cuánto rinde cada modo en este procesador. Medido en una notebook i7-6820HQ de 4 núcleos y 8 hilos con 60 temas
 * (docs/archivo/pruebas/2026-10-intensidad.md): A fondo, 20–45 % más que Normal; Tranqui, 57–65 % de Normal.
 */
function howFast(i: IntensityInfo): string {
  const shared = i.cores != null && i.threads > i.cores
  const cpu = i.cpu ? T.esteCpu(i.cpu) : T.esteSolo
  if (i.threads <= 2) return T.pocos(cpu, T.hiloN(i.threads))
  if (shared) return T.compartido(cpu, i.cores!, i.threads)
  return T.libre(cpu, i.threads, i.cores != null)
}

export function IntensityPicker() {
  const [i, setI] = useState<IntensityInfo | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let alive = true
    window.paila.intensity().then((x) => { if (alive) setI(x) })
    const off = window.paila.onIntensity((x) => setI(x))
    // la memoria libre y la batería cambian solas: se vuelve a mirar cada tanto
    const t = setInterval(() => window.paila.intensity().then((x) => { if (alive) setI(x) }), 15_000)
    return () => { alive = false; off(); clearInterval(t) }
  }, [])
  if (!i) return null

  const pick = async (m: Intensity) => { setBusy(true); try { setI(await window.paila.setIntensity(m)) } finally { setBusy(false) } }
  const now = i.paused ? T.pausadoBateria
    : i.effective !== i.mode ? T.bateria(hilos(i.workers))
      : T.ahora(hilos(i.workers))

  return (
    <section className="intensity">
      <h4>{T.intensidad} <Info tip={T.intensidadTip} /></h4>
      <div className="tidy-profiles">
        {MODES.map((m) => (
          <button key={m.key} className={`tidy-profile${i.mode === m.key ? ' on' : ''}`} disabled={busy} onClick={() => pick(m.key)} title={m.help}>
            <div className="tidy-profile-head"><b>{m.label}</b>{i.mode === m.key && <Pildora tone="ok">{T.elegido}</Pildora>}</div>
            <span className="small muted">{hilos(i.byMode[m.key])}<Info tip={m.help} /></span>
          </button>
        ))}
      </div>
      <p className="small muted">
        {now}{i.limitedByMemory && T.poca(num(i.freeMb / 1000, { maximumFractionDigits: 1 }))}
        {' '}{howFast(i)}
      </p>
    </section>
  )
}

/** Muestra los avisos de intensidad (por ejemplo, que A fondo bajó a Normal al desenchufar), estés en la pantalla que estés. */
export function useIntensityNotices() {
  useEffect(() => window.paila.onIntensity((i) => { if (i.notice) toast(i.notice, 'info') }), [])
}
