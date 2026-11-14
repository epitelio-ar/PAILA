// Contexto compartido del proceso principal: la biblioteca y todos los servicios de `core/`, ya armados.
// Cada archivo de `electron/ipc/` recibe este contexto y registra los pedidos (IPC) de su área.
import path from 'node:path'
import type { BrowserWindow } from 'electron'
import { Library } from '@paila/core/library'
import type { WaitHandle } from '@paila/core/oplock'
import { Changes } from '@paila/core/changes'
import { Playlists } from '@paila/core/playlists'
import { PlaylistOps } from '@paila/core/playlistops'
import { Trash } from '@paila/core/trash'
import { Organizer } from '@paila/core/organizer'
import { Replacer } from '@paila/core/replace'
import { Exporter } from '@paila/core/export'
import { Rekordbox } from '@paila/core/rekordbox'
import { Wishlist } from '@paila/core/wishlist'
import { Inbox } from '@paila/core/inbox'
import { Wanted } from '@paila/core/wanted'
import { Space } from '@paila/core/space'
import { MusicBrainz } from '@paila/core/musicbrainz'
import { Improver } from '@paila/core/improve'
import { Requests } from '@paila/core/requests'
import { ListImports } from '@paila/core/listimport'
import { InboxAdd } from '@paila/core/inboxadd'
import { IsrcIndex } from '@paila/core/isrc'
import { Archives } from '@paila/core/archives'
import { ArchiveExtract } from '@paila/core/archive/extract'
import { ArchiveTrash } from '@paila/core/archive/papelera'
import { StemsSeparate } from '@paila/core/stems/separar'
import type { Jobs } from '@paila/core/jobs'
import type { IntensityControl } from './intensity'
import type { TableServer } from '@paila/core/tableserver'
import { officialNames, type OnlineKeys } from '@paila/core/official-run'
import type { ControlId } from '@paila/shared/types'
import type { Sondas } from '@paila/core/chequeo'

export interface Ctx {
  /** ¿Volvió un disco con algo a medias? Lo resuelve ahora (core/recoverywatch.ts). Se llama antes de escanear. */
  recoveryCheck: () => Promise<number>
  /** Ventana principal (puede no existir todavía). */
  win: () => BrowserWindow | null
  /** Manda un evento a la interfaz (progreso, estado…). */
  send: (channel: string, payload: unknown) => void
  userData: string
  ffprobe: string
  ffmpeg: string
  lib: Library
  changes: Changes
  playlists: Playlists
  trash: Trash
  organizer: Organizer
  replacer: Replacer
  exporter: Exporter
  rekordbox: Rekordbox
  wishlist: Wishlist
  inbox: Inbox
  wanted: Wanted
  space: Space
  musicbrainz: MusicBrainz
  improver: Improver
  playlistOps: PlaylistOps
  /** Listas traídas de otro lado y los códigos ISRC de la biblioteca. */
  requests: Requests
  /** Playlists traídas de Rekordbox o de un pendrive (core/listimport.ts). */
  imports: ListImports
  /** La Bandeja pasa a tu Música los temas que no tenías (core/inboxadd.ts). */
  inboxAdd: InboxAdd
  /** Los reemplazos de Sonido en el Aplicar único (core/sonido-reemplazos.ts); lo pone ipc/sonido.ts. */
  reemplazar?: import('@paila/core/aplicar').AplicarDeps['reemplazar']
  isrc: IsrcIndex
  /** Los ZIP y RAR de la biblioteca y "Sacar al lado" (core/archives.ts, core/archive/extract.ts). */
  archives: Archives
  archiveExtract: ArchiveExtract
  archiveTrash: ArchiveTrash
  /** Separar voz: a dónde va y cómo se guarda lo separado, con Historial y deshacer (core/stems/separar.ts). */
  stems: StemsSeparate
  /** Carpeta de música (ruta de hoy) de un disco conectado, o null. */
  rootPath: (rootId: number) => string | null
  /** Procesos largos con avance visible (ver core/jobs.ts). */
  jobs: Jobs
  /**
   * Mover o escribir archivos mientras el análisis los lee daría errores: el análisis se pausa mientras corre `fn` y se retoma solo
   * después. `wait`: el proceso largo donde decir "Espera a que termine: Buscando tapas" (y poder cancelar la espera); sin él, si
   * algo está leyendo los archivos, avisa enseguida en vez de esperar (core/oplock.ts).
   */
  withPaused: <T>(fn: () => Promise<T> | T, wait?: WaitHandle) => Promise<T>
  /** Un valor guardado en la tabla `settings`. */
  setting: (key: string) => string | null
  setSetting: (key: string, value: string) => void
  /** Pide analizar lo pendiente / escanear y analizar (los maneja main.ts). */
  analyze: () => Promise<void>
  scanThenAnalyze: () => Promise<void>
  /** La tabla de bibliotecas grandes (filtra y pagina en un hilo aparte, ver core/tableindex.ts). */
  table: TableServer
  /** Intensidad del análisis (Tranqui / Normal / A fondo). */
  intensity: IntensityControl
  /** Claves de internet y si se usa Deezer (las pone electron/ipc/online.ts; las usa la pantalla Discos). */
  onlineKeys?: () => OnlineKeys
  useDeezer?: () => boolean
  /** Prueba un control del Chequeo y, si está mal, lo avisa en la ventana con su arreglo (lo pone electron/chequeo.ts). */
  avisarControl?: (id: ControlId) => void
  /** La prueba de una clave de internet, sin su valor (la pone electron/ipc/online.ts; la usa el Chequeo). */
  probarClave?: Sondas['clave']
  /** Los trabajos de internet de siempre, para que Ordenar los corra solos con el OK (ipc/ordenar-internet.ts). Los pone cada IPC. */
  internet?: { nombres?: () => Promise<unknown>; mb?: () => Promise<unknown>; tapas?: () => Promise<unknown> }
  /** Archivos "candidatos" (para la escucha A/B): ids negativos que el protocolo `paila://` sabe servir. */
  candidates: Map<number, string>
  registerCandidate: (path: string) => number
}

export function createServices(base: { lib: Library; ffprobe: string; ffmpeg: string; userData: string; version: string }) {
  const { lib, ffprobe, ffmpeg, version } = base
  const rootPath = (rid: number) => lib.roots().find((r) => r.id === rid && r.available)?.path ?? null
  const trackPath = (id: number) => lib.trackPath(id)
  const playlists = new Playlists(lib.db, trackPath)
  // con el nombre oficial (Fase C) cuando lo hay: los títulos "Título - Artista" no salen al revés en la lista
  const wanted = new Wanted(lib.db, officialNames(lib.db))
  const rekordbox = new Rekordbox(lib.db, trackPath, playlists)
  const requests = new Requests(lib.db, playlists, wanted, trackPath)
  const archives = new Archives(lib.db, rootPath)
  return {
    rootPath,
    // copias de resguardo de los tags en la carpeta de datos (no en el temporal de Windows): sobreviven a un reinicio
    changes: new Changes(lib.db, trackPath, ffmpeg, path.join(base.userData, 'resguardo')),
    playlists,
    trash: new Trash(lib.db, rootPath, playlists),
    organizer: new Organizer(lib.db, rootPath),
    replacer: new Replacer(lib.db, rootPath, ffprobe, ffmpeg),
    exporter: new Exporter(lib.db, trackPath, ffmpeg),
    rekordbox,
    wishlist: new Wishlist(lib.db),
    wanted,
    inbox: new Inbox(lib.db, ffprobe, `${base.userData}/inbox-zip`, ffmpeg, wanted),
    space: new Space(lib.db, () => lib.roots()),
    musicbrainz: new MusicBrainz(lib.db, `PAILA/${version} (aplicacion de escritorio para DJs)`),
    improver: new Improver(lib.db),
    playlistOps: new PlaylistOps(lib.db, playlists),
    requests,
    imports: new ListImports(lib.db, requests, playlists, rekordbox.dj),
    inboxAdd: new InboxAdd(lib.db, { rootPath }),
    isrc: new IsrcIndex(lib.db, ffprobe, trackPath),
    archives,
    archiveExtract: new ArchiveExtract(archives, rootPath),
    archiveTrash: new ArchiveTrash(archives, rootPath),
    stems: new StemsSeparate({ db: lib.db, rootPath, roots: () => lib.roots(), setRule: (r, rel, k) => lib.setRule(r, rel, k) }),
  }
}
