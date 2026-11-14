// Pestaña "Servidor casero" de Llevar la música: el chequeo "listo para tu servidor" (Plex, Jellyfin, Navidrome), con lo
// que falta, ejemplos y a qué pantalla de PAILA ir a arreglarlo, más una guía corta. Solo lee: no cambia nada.
import { useState } from 'react'
import type { ServerCheck } from '@paila/shared/types'
import type { PageKey } from './nav'
import { n } from './format'
import { toast } from './toast'
import { JobPanel, useJob } from './jobs'
import { Aviso, Boton, Caja, Info, Pildora, Rico } from '@paila/diseno'
import { plural, textos } from '@paila/shared/idioma'

const T = textos({
  servidor: {
    es: 'Un servidor de música casero es un programa que corre en una compu de tu casa (o un disco de red) y te deja escuchar tu biblioteca desde el celular, la tele o cualquier lado, como si fuera Spotify pero con tus archivos. Los más usados: Plex, Jellyfin y Navidrome.',
    en: 'A home music server is a program that runs on a computer at home (or a network drive) and lets you listen to your library from your phone, your TV or anywhere, like Spotify but with your own files. The most popular ones: Plex, Jellyfin and Navidrome.',
  },
  tags: {
    es: 'Los tags son los datos guardados adentro de cada archivo: artista, título, álbum, año, número de pista, tapa. Los servidores arman todo con eso.',
    en: 'Tags are the details stored inside each file: artist, title, album, year, track number, cover. Servers build everything from them.',
  },
  intro: {
    es: 'Plex, Jellyfin y Navidrome {servidor} arman la biblioteca con las **carpetas** (Artista / Álbum) y los **tags** {tags} de cada tema, y muestran la tapa que está adentro del archivo o el {cover} de la carpeta. Justo lo que ordena PAILA: este chequeo dice qué te falta y dónde se arregla. Mira solo la Música (no los samples, inéditos ni sets) y **no cambia nada**.',
    en: 'Plex, Jellyfin and Navidrome {servidor} build the library from the **folders** (Artist / Album) and the **tags** {tags} of each track, and they show the cover inside the file or the {cover} in the folder. That is exactly what PAILA tidies up: this check tells you what is missing and where to fix it. It only looks at your Music (not samples, unreleased tracks or sets) and **changes nothing**.',
  },
  discos: { es: 'discos', en: 'albums' },
  disco: { es: 'disco', en: 'album' },
  tema: { es: 'tema', en: 'track' },
  temas: { es: 'temas', en: 'tracks' },
  revisarDeNuevo: { es: 'Revisar de nuevo', en: 'Check again' },
  revisar: { es: 'Revisar mi Música', en: 'Check my Music' },
  listoServidor: {
    es: (c: string) => `Listo para tu servidor: los ${c} temas tienen sus datos, sus carpetas y sus tapas.`,
    en: (c: string) => `Ready for your server: all ${c} tracks have their details, their folders and their covers.`,
  },
  resumen: {
    es: (bien: string, total: string, pct: number, completos: string, discos: string) => `**${bien}** de ${total} temas (${pct} %) se van a ver bien en tu servidor, y ${completos} ya están completos (carpeta, año, pista y tapa). Revisé ${discos} discos. Lo que falta, de lo más importante a lo menos:`,
    en: (bien: string, total: string, pct: number, completos: string, discos: string) => `**${bien}** of ${total} tracks (${pct}%) will look good on your server, and ${completos} are already complete (folder, year, track number and cover). I checked ${discos} albums. What's missing, from most to least important:`,
  },
  importante: { es: 'Importante', en: 'Important' },
  conviene: { es: 'Conviene', en: 'Worth doing' },
  ocultar: { es: 'Ocultar', en: 'Hide' },
  verEjemplos: { es: 'Ver ejemplos', en: 'See examples' },
  irA: { es: (donde: string) => `Ir a ${donde}`, en: (donde: string) => `Go to ${donde}` },
  ymas: { es: (c: string) => `… y ${c} más`, en: (c: string) => `… and ${c} more` },
  como: { es: 'Cómo:', en: 'How:' },
  guiaCorta: { es: 'Guía corta', en: 'Quick guide' },
  antes: { es: 'Antes:', en: 'First:' },
  antesT: {
    es: 'ordená con PAILA (Arreglar nombres, Completar desde internet, Organizar carpetas y Discos → Tapas) y volvé a revisar acá.',
    en: 'tidy up with PAILA (Fix names and tags, Fill in from the internet, Organize folders and Albums → Covers) and check again here.',
  },
  plex: { es: 'Plex:', en: 'Plex:' },
  plexT: {
    es: 'instalá Plex Media Server, creá una biblioteca de tipo "Música" y elegí tu carpeta de Música. En la configuración avanzada de la biblioteca, "Preferir los datos locales" usa tus tags en vez de los de internet.',
    en: 'install Plex Media Server, create a library of type "Music" and pick your Music folder. In the library\'s advanced settings, "Prefer local metadata" uses your tags instead of the ones from the internet.',
  },
  jellyfin: { es: 'Jellyfin:', en: 'Jellyfin:' },
  jellyfinT: {
    es: 'Panel → Bibliotecas → Agregar → tipo "Música" y tu carpeta. Lee los tags y el cover.jpg de cada carpeta.',
    en: 'Dashboard → Libraries → Add → type "Music" and your folder. It reads the tags and the cover.jpg in each folder.',
  },
  navidrome: { es: 'Navidrome:', en: 'Navidrome:' },
  navidromeT: {
    es: 'poné en su configuración la carpeta de Música ({code}). Se guía solo por los tags, así que el artista del álbum y el número de pista importan mucho. Las playlists .m3u8 que estén dentro de esa carpeta aparecen solas.',
    en: 'set your Music folder in its configuration ({code}). It goes only by the tags, so the album artist and the track number matter a lot. Any .m3u8 playlists inside that folder show up by themselves.',
  },
  volumen: { es: 'Volumen parejo:', en: 'Even volume:' },
  volumenA: { es: 'Navidrome usa el ReplayGain {info} que PAILA guarda en Volumen parejo; Plex y Jellyfin miden el suyo propio.', en: 'Navidrome uses the ReplayGain {info} that PAILA saves in Even volume; Plex and Jellyfin measure their own.' },
  replayGain: {
    es: 'ReplayGain: un dato guardado en cada archivo que le dice al reproductor cuánto subir o bajar el tema para que todos suenen parejo. El sonido del archivo no cambia.',
    en: "ReplayGain: a value stored in each file that tells the player how much to turn the track up or down so they all sound even. The file's sound doesn't change.",
  },
  soloLee: {
    es: 'El servidor solo lee tus archivos. Si después cambiás algo con PAILA, el servidor lo toma en su próxima revisión de la biblioteca.',
    en: "The server only reads your files. If you change something with PAILA later, the server picks it up on its next library scan.",
  },
})

/** El último chequeo, para no perderlo al cambiar de pantalla. */
let last: ServerCheck | null = null

export default function CarryServer({ onGo }: { onGo: (p: PageKey) => void }) {
  const job = useJob('carry-server')
  const [res, setRes] = useState<ServerCheck | null>(last)
  const [open, setOpen] = useState<string | null>(null)
  const check = async () => {
    try { const r = await window.paila.carryServer(); last = r; setRes(r) } catch (e) { toast((e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, ''), 'error') }
  }
  const must = res?.issues.filter((i) => i.level === 'imprescindible') ?? []
  const nice = res?.issues.filter((i) => i.level === 'conviene') ?? []
  const pct = res && res.tracks ? Math.round((res.okEssential * 100) / res.tracks) : 0

  return (<>
    <p className="muted small">
      <Rico texto={T.intro} partes={{ servidor: <Info tip={T.servidor} />, tags: <Info tip={T.tags} />, cover: <code>cover.jpg</code> }} />
    </p>
    {job && <JobPanel job={job} unit={T.discos} onDismiss={() => window.paila.dismissJob('carry-server')} />}
    <div className="row">
      <Boton disabled={!!job?.running} loading={!!job?.running} onClick={check}>{res ? T.revisarDeNuevo : T.revisar}</Boton>
    </div>
    {res && (<>
      <Aviso tone={res.issues.length === 0 ? 'ok' : pct < 80 ? 'atencion' : 'info'}>
        {res.issues.length === 0
          ? T.listoServidor(n(res.tracks))
          : <Rico texto={T.resumen(n(res.okEssential), n(res.tracks), pct, n(res.okTracks), n(res.albums))} />}
      </Aviso>
      {[...must, ...nice].map((i) => (
        <Caja pad={open === i.id} key={i.id} head={<>
          <Pildora tone={i.level === 'imprescindible' ? 'atencion' : 'info'}>{i.level === 'imprescindible' ? T.importante : T.conviene}</Pildora>
          <b>{i.label}</b> <Info tip={i.why} />
          <span className="num">{n(i.count)} {i.unit === 'discos' ? plural(i.count, T.disco, T.discos) : plural(i.count, T.tema, T.temas)}</span>
          <span className="push-right" style={{ display: 'flex', gap: 6 }}>
            <Boton variant="ghost" size="sm" onClick={() => setOpen(open === i.id ? null : i.id)}>{open === i.id ? T.ocultar : T.verEjemplos}</Boton>
            <Boton size="sm" onClick={() => onGo(i.go)} title={i.goHow ? `${i.goLabel} (${i.goHow})` : i.goLabel}>{T.irA(i.goLabel)}</Boton>
          </span>
        </>}>
          {open === i.id && (
            <div className="listbox">
              {i.examples.map((e) => <div key={e} className="listbox-row small ellipsis" title={e}>{e}</div>)}
              {i.count > i.examples.length && <div className="listbox-row muted small">{T.ymas(n(i.count - i.examples.length))}</div>}
            </div>
          )}
          {open === i.id && i.goHow && <p className="muted small">{T.como}{i.goHow}.</p>}
        </Caja>
      ))}
    </>)}
    <Caja pad head={<b>{T.guiaCorta}</b>}>
      <ul className="small">
        <li><b>{T.antes}</b> {T.antesT}</li>
        <li><b>{T.plex}</b> {T.plexT}</li>
        <li><b>{T.jellyfin}</b> {T.jellyfinT}</li>
        {/* idioma-ok */}
        <li><b>{T.navidrome}</b> <Rico texto={T.navidromeT} partes={{ code: <code>MusicFolder</code> }} /></li>
        <li><b>{T.volumen}</b> <Rico texto={T.volumenA} partes={{ info: <Info tip={T.replayGain} /> }} /></li>
      </ul>
      <p className="muted small">{T.soloLee}</p>
    </Caja>
  </>)
}
