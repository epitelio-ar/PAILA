// El contrato entre la interfaz y el proceso principal: AppState y la lista de funciones de window.paila (PailaApi).
// Cada función nueva: tipo acá, `handle` en electron/ipc/<área>.ts y una línea en electron/preload.ts.
import type { TidyRule } from '../tidy-profiles'
import type { AdvInspectResult, AnalysisQueueView, OpLogEntry } from './avanzado'
import type { CollectionStats, RecentAlbum } from './stats'
import type { AnalysisDetail, AnalysisInsights, AppState, CollectionKind, FolderAnalysis, Intensity, IntensityInfo, RootInfo, ScanStatus, TrackExtras, TrackField } from './library'
import type { ApplyResult, EditableField, JournalBatch, MbProposal, MbStatus, PendingChange, SavedAction, TagAction, TidyProfileCount, TidyReport, TidyStep } from './tags'
import type { CleanPreview, MergePreview, ExportOptions, ExportPlan, ExportResult, FolderProposal, ImproveProposal, PlaylistKind, PlaylistNode, SmartRules } from './playlists'
import type { DupGroup, JunkReport, OrganizeBatch, OrganizeOptions, OrganizePlan, OrganizeResult, PurgeResult, SavingsReport, ShrinkResult, SpaceNode, TrashBatch, TrashItem, TrashResult, TrashSummary, TrashUsage } from './cleanup'
import type { InboxItem, ReplaceCompare, ReplaceOptions, ReplaceUndoResult, ReplacementEntry, WishGroup, WishStatus } from './quality'
import type { BpmStyle, Combina, CompatReport, ConvertResult, DeviceProfile, DjImportResult, DjTarget, GridEngineInfo, GridPlan, NextSuggestion, RekordboxExportOptions, RekordboxResult, SetCurve, Unreadable } from './dj'
import type { InboxAddPlan, InboxAddResult, InboxApplyResult, InboxPlan, InboxResult, InboxWatchState, WantedCriteria, WantedFormat, WantedItem, WantedQue, WantedStatus } from './wanted'
import type { LibraryStats, TableQuery } from '../tableview'
import type { HistoryDetail, HistoryEntry, HistoryKind, HistoryUndoResult, JobState, RecoveryReport } from './history'
import type { AlbumsSummary, CoverProposal, GainPlan } from './albums'
import type { CarrySource, M3uOptions, M3uResult, PhoneDevice, PhoneOptions, PhonePlan, PhoneResult, ServerCheck } from './carry'
import type { RequestDecision, RequestDetail, RequestItem, RequestPreview, RequestSummary } from './requests'
import type { TablaApi, TraerApi } from './api-traer'
import type { LlevarApi } from './api-llevar'
import type { ArchivosApi } from './api-archivos'
import type { GenerosApi } from './api-generos'
import type { EnergiaApi } from './api-energia'; import type { DiscosApi } from './api-discos'
import type { RecortarApi } from './api-recortar'
import type { SepararApi } from './api-separar'; import type { SonidoApi } from './api-sonido'
import type { NotasApi } from './api-notas'; import type { EstadoApi } from './estado'; import type { AplicarApi } from './api-aplicar'; import type { HistorialApi } from './api-historial'; import type { OrdenarApi } from './revision'
import type { RespaldosApi } from './api-respaldos'
import type { ChequeoApi } from './chequeo'
import type { PantallaApi } from './api-pantalla'
import type { MudanzaApi } from './mudanza'
import type { LearnedReport, LearnedState } from './junk'
import type { DiagnosticPreviewFile, UpdateState } from './share'
import type { DictEntry, DictImport, DiscogsKeyInput, KeyService, KeyTest, NamesStatus, OnlineKeysStatus } from './online'
import type { ListenOptions, SetCandidate, SetTracklist, TrackInSet, TracklistFormat } from './sets'
export interface PailaApi extends DiscosApi, TablaApi, TraerApi, LlevarApi, ArchivosApi, GenerosApi, EnergiaApi, PantallaApi, MudanzaApi, RecortarApi, RespaldosApi, ChequeoApi, SepararApi, NotasApi, EstadoApi, AplicarApi, OrdenarApi, HistorialApi, SonidoApi {
  getState(): Promise<AppState>
  /** Avisa que la biblioteca ya se ve (cuánto tardó en abrir: Exportar diagnóstico y scripts/arranque.ts). */
  uiLista(marcas: Record<string, number>): void
  pickFolder(): Promise<string | null>
  analyzeFolder(path: string): Promise<FolderAnalysis>
  addRoot(path: string, rules: { rel: string; kind: CollectionKind }[]): Promise<RootInfo>
  removeRoot(id: number): Promise<void>
  setRule(rootId: number, rel: string, kind: CollectionKind): Promise<void>
  /**
   * Los temas para la tabla. Biblioteca chica: todas las filas (`rows`). Grande (BIG_LIBRARY temas o más): `rows` = null y
   * `big` dice cuántos son y trae los números de la barra lateral e Inicio; la tabla pide el orden y las filas aparte.
   */
  getTracks(): Promise<{ fields: readonly TrackField[]; rows: unknown[][]; big?: undefined } | { fields: readonly TrackField[]; rows: null; big: { total: number; stats: LibraryStats } }>
  /** Biblioteca grande: los ids a la vista, en orden (filtrados y ordenados en el proceso principal), y las filas desde la posición `from` (la parte que se ve), así la tabla cambia de una vez. */
  tableQuery(q: TableQuery, from: number): Promise<{ ids: number[]; rows: unknown[][] }>
  /** Biblioteca grande: las filas de estos temas (arreglos en el orden de `fields`). */
  tableRows(ids: number[]): Promise<unknown[][]>
  /** null = arrancó; si no, el motivo (otra operación tiene el candado). */
  scanStart(): Promise<string | null>
  scanPause(): Promise<void>
  scanResume(): Promise<void>
  scanCancel(): Promise<void>
  reveal(trackId: number): Promise<void>
  getAnalysis(trackId: number): Promise<AnalysisDetail | null>
  /** Lo que PAILA sabe de un tema y no va en los tags (la marca "vinilo"). */
  trackExtras(trackId: number): Promise<TrackExtras>
  spectrogram(trackId: number): Promise<string | null> // imagen PNG como data URL
  /** Forma de onda del tema (PNG blanco sobre transparente, como data URL): la barra de avance del reproductor. */
  waveform(trackId: number): Promise<string | null>
  /** Tapa chica (240 px, JPG como data URL) para mostrar muchas a la vez; null si el archivo no trae tapa. */
  coverThumb(trackId: number): Promise<string | null>
  /** Los últimos discos que sumaste a la Música (Inicio). */
  recentAlbums(limit: number): Promise<RecentAlbum[]>
  audioUrl(trackId: number): Promise<string>
  /** Cambios pendientes de tags (ver core/changes.ts). Nada se escribe hasta applyChanges. */
  stageChange(trackIds: number[], field: EditableField, value: string | null): Promise<PendingChange[]>
  /** Corre una acción sobre estos temas (en este orden) y devuelve cuántos cambios propuso. */
  runAction(trackIds: number[], action: TagAction): Promise<number>
  /** Tapa embebida como data URL (o null). */
  getCover(trackId: number): Promise<string | null>
  /** Elige una imagen y la deja como cambio pendiente de tapa en estos temas. null = quitar la tapa. Devuelve false si se canceló. */
  setCover(trackIds: number[], mode: 'pick' | 'remove'): Promise<boolean>
  savedActions(): Promise<SavedAction[]>
  saveAction(name: string, action: TagAction): Promise<SavedAction[]>
  deleteSavedAction(name: string): Promise<SavedAction[]>
  playlists(): Promise<PlaylistNode[]>
  createPlaylist(name: string, kind: PlaylistKind, parentId: number | null, rules?: SmartRules): Promise<PlaylistNode[]>
  renamePlaylist(id: number, name: string): Promise<PlaylistNode[]>
  setPlaylistRules(id: number, rules: SmartRules): Promise<PlaylistNode[]>
  deletePlaylist(id: number): Promise<PlaylistNode[]>
  /** Antes de borrar: cuántos pedidos de "Traer una lista" quedarían sin playlist. */ deletePlaylistInfo(id: number): Promise<{ requests: number }>
  playlistTracks(id: number): Promise<number[]>
  addToPlaylist(id: number, trackIds: number[]): Promise<number>
  removeFromPlaylist(id: number, trackIds: number[]): Promise<void>
  moveInPlaylist(id: number, trackId: number, to: number): Promise<void>
  exportPlaylist(id: number): Promise<string | null> // pide dónde guardar; devuelve un mensaje o null si se canceló
  importPlaylist(): Promise<string | null>
  findDuplicates(): Promise<DupGroup[]>
  trashBatches(): Promise<TrashBatch[]>
  trashItems(): Promise<TrashItem[]>
  restoreTrash(batchId: number): Promise<TrashResult>
  /** Cuánto ocupa la papelera, tanda por tanda. */
  trashUsage(): Promise<TrashUsage>
  /** Cuánto ocupa la papelera, de qué (respaldos, temas, lo demás) y si pasa del tope para avisar. Solo mira. */
  trashSummary(): Promise<TrashSummary>
  /** Vaciar papelera: borra DE VERDAD las tandas elegidas. Lo único que borra en PAILA. */
  purgeTrash(keys: string[]): Promise<PurgeResult>
  organizePlan(opts: OrganizeOptions): Promise<OrganizePlan>
  organizeBatches(): Promise<OrganizeBatch[]>
  organizeUndo(batchId: number): Promise<OrganizeResult>
  analyzeFolders(): Promise<FolderProposal[]>
  createPlaylistsFromFolders(dirs: string[]): Promise<{ created: number; tracks: number }>
  pickReplacement(): Promise<string | null>
  compareReplacement(trackId: number, candidatePath: string): Promise<ReplaceCompare>
  applyReplacement(trackId: number, candidatePath: string, opts: ReplaceOptions): Promise<string>
  replacements(): Promise<ReplacementEntry[]>
  undoReplacement(id: number): Promise<ReplaceUndoResult>
  pickExportFolder(): Promise<string | null>
  planExport(playlistId: number, opts: ExportOptions): Promise<ExportPlan>
  runExport(playlistId: number, opts: ExportOptions): Promise<ExportResult>
  openFolder(path: string): Promise<void>
  /** Llevar la música: elegir carpeta (con el título del diálogo), al celular, playlists .m3u8 y el chequeo para servidores. */
  carryPick(title: string): Promise<string | null>
  /** Celulares conectados por cable (MTP), que no tienen letra de disco. */
  carryDevices(): Promise<PhoneDevice[]>
  carryPhonePlan(source: CarrySource, opts: PhoneOptions): Promise<PhonePlan>
  carryPhoneRun(source: CarrySource, opts: PhoneOptions): Promise<PhoneResult>
  carryM3u(playlistIds: number[], opts: M3uOptions): Promise<M3uResult>
  carryServer(): Promise<ServerCheck>
  proposeImprovements(playlistId: number): Promise<ImproveProposal[]>
  applyImprovements(items: { playlistId: number; currentId: number; betterId: number }[]): Promise<{ batchId: number | null; swaps: number }>
  undoImprovements(batchId: number): Promise<number>
  previewCleanPlaylist(playlistId: number): Promise<CleanPreview>
  cleanPlaylist(playlistId: number, dropIds: number[]): Promise<{ batchId: number | null; removed: number }>
  previewMergePlaylists(ids: number[]): Promise<MergePreview>
  mergePlaylists(ids: number[], name: string, removeOriginals: boolean): Promise<{ id: number; added: number; batchId: number }>
  rekordboxDevices(): Promise<DeviceProfile[]>
  rekordboxCompat(deviceId: string): Promise<CompatReport>
  rekordboxCompatPlaylist(deviceId: string): Promise<number>
  rekordboxExport(scope: 'todo' | 'playlists', playlistIds: number[], opts?: RekordboxExportOptions): Promise<RekordboxResult | null>
  /** Elegir un rekordbox.xml exportado por Rekordbox y traer (solo leyendo) grilla, cues, estrellas, color y my tags. null = se canceló. */
  rekordboxImport(): Promise<DjImportResult | null>
  /** Traer los marcadores de Serato que están dentro de los archivos (solo los lee). */
  seratoImport(): Promise<DjImportResult>
  /** Qué motor de grilla hay (con `probe` prueba la placa de video, unos segundos la primera vez). */
  gridEngine(probe: boolean): Promise<GridEngineInfo>
  /** Elegir la carpeta de modelos (beat-this/ y npm/). null = se canceló. */
  gridChooseModels(): Promise<GridEngineInfo | null>
  /** Cuánto tardaría la grilla de una playlist (null = toda la Música). */
  gridPlan(playlistId: number | null, force: boolean, theirs?: boolean): Promise<GridPlan>
  /** Calcula la grilla y los cues sugeridos (proceso en segundo plano 'grid'); `gridSkip`: «Saltear este» (el tema en curso queda sin grilla y sigue el próximo; false si no había ninguno). */
  gridRun(playlistId: number | null, force: boolean, theirs?: boolean): Promise<{ done: number; failed: number; seconds: number }>; gridSkip(): Promise<boolean>
  /** Armado de set: la curva de una playlist y qué tema poner después de uno. */
  setCurve(playlistId: number): Promise<SetCurve>
  setNext(fromId: number, playlistId: number | null, energy: number): Promise<NextSuggestion[]>
  // Tracklist de sets (core/setlists.ts): qué archivos son sets, escuchar uno, corregir y lo que sale
  tracklistSets(): Promise<SetCandidate[]>
  tracklistGet(fileId: number): Promise<SetTracklist | null>
  /** Si hay con qué buscar por internet lo que no está en la biblioteca (la clave de AcoustID; el reconocedor, si está prendido). */
  tracklistInternet(): Promise<{ acoustid: boolean; audd: boolean }>
  tracklistListen(fileId: number, opts: ListenOptions): Promise<SetTracklist | null>
  tracklistEdit(fileId: number, entries: TrackInSet[]): Promise<SetTracklist | null>
  /** Copia el tracklist (texto con minutos) y dice cuántos renglones. */
  tracklistCopy(fileId: number): Promise<number>
  tracklistSave(fileId: number, format: TracklistFormat): Promise<string | null>
  /** El tracklist al comentario del tag del set, en Cambios pendientes. */
  tracklistStageTag(fileId: number): Promise<number>
  /** Guarda (on) o saca los cue points del tracklist (para Rekordbox): cuántos. */
  tracklistCues(fileId: number, on: boolean): Promise<number>
  /** "Combinan para pasar después" (la ficha): tono vecino y BPM a ±6 %, los de mejor nota primero. */
  combinan(trackId: number): Promise<Combina[]>
  djUnreadable(): Promise<Unreadable[]>
  djConvert(target: DjTarget): Promise<ConvertResult>
  /** Rangos de BPM por género (los de fábrica si el usuario no los cambió). */
  bpmStyles(): Promise<{ styles: BpmStyle[]; custom: boolean }>
  /** Guarda los rangos (null = volver a los de fábrica) y vuelve a poner el BPM de cada tema en su rango. Devuelve cuántos cambiaron. */
  setBpmStyles(styles: BpmStyle[] | null): Promise<number>
  inRekordbox(trackIds: number[]): Promise<number[]>
  harmonicSort(playlistId: number): Promise<void>
  /** Sin reglas: las últimas que se eligieron (o el perfil por defecto). */
  tidyAnalyze(rules?: TidyRule[]): Promise<TidyReport>
  /** Cuánto propone cada perfil (en un hilo aparte, después de tidyAnalyze con esas reglas). null: se pidió otra cosa antes de terminar. */
  tidyProfiles(rules: TidyRule[]): Promise<TidyProfileCount[] | null>
  tidyStage(steps: TidyStep[], rules: TidyRule[]): Promise<number>
  /** Acepta (o acepta editada) una propuesta de "para mirar a mano": va a Cambios pendientes. */
  tidyAccept(items: { id: number; field: EditableField | 'filename'; value: string }[]): Promise<number>
  /** Deja como está algo de "para mirar a mano" (no vuelve a aparecer); `reset` muestra de nuevo todo lo que se dejó. */
  tidyKeep(items: { id: number; field: string; from: string | null; origin?: 'oficial' }[], reset?: boolean): Promise<void>
  /** Pasa temas a la colección "Sets y en vivo" (o los devuelve con `back`). No mueve archivos. */
  tidySets(ids: number[], back?: boolean): Promise<number>
  wishlist(maxGrade: 'C' | 'D' | 'F'): Promise<WishGroup[]>
  setWishStatus(key: string, status: WishStatus, note?: string): Promise<void>
  openWishSearch(site: string, artist: string, album: string): Promise<void>
  pickInboxFolder(): Promise<string | null>
  /** La carpeta donde guarda NAPIA, si la Bandeja todavía no la vigila (para ofrecerla). */
  napiaFolder(): Promise<string | null>
  /** Vigilar la carpeta de NAPIA. */
  useNapiaFolder(): Promise<string | null>
  /** La Bandeja vigilada (la vigilancia corre en el proceso principal). */
  inboxState(): Promise<InboxWatchState>
  inboxResults(): Promise<InboxResult[]>
  inboxRescan(): Promise<InboxWatchState>
  inboxRecheck(path: string): Promise<InboxResult>
  setInboxAuto(on: boolean): Promise<boolean>
  /** La simulación de "Reemplazar todos" (no toca nada) y después aplicarla. */
  inboxPlan(): Promise<InboxPlan>
  inboxApply(plan: InboxPlan): Promise<InboxApplyResult>
  /** "Pasar a tu Música": la vista previa de los temas de la Bandeja que no tenías. */
  inboxAddPlan(): Promise<InboxAddPlan>
  /** Pasa a tu Música los elegidos de la vista previa (Historial y deshacer); después escanea y analiza. */
  inboxAddApply(plan: InboxAddPlan, chosen: string[]): Promise<InboxAddResult>
  inboxReveal(path: string): Promise<void>
  onInboxUpdate(cb: (s: InboxWatchState) => void): () => void
  /** "Ver en PAILA" desde NAPIA (`--bandeja=<carpeta>`): la carpeta pedida al abrir (una sola vez) y las que llegan con PAILA abierta. */
  bandejaPedida(): Promise<string | null>
  onIrBandeja(cb: (folder: string) => void): () => void
  /** Faltan o suenan mal por tema. Si se pasan las casillas, además se guardan. */
  /** `playlistId`: solo lo que pide esa playlist (lo que le falta y lo de mala calidad que tiene). */
  wanted(criteria?: WantedCriteria, playlistId?: number | null): Promise<WantedItem[]>
  wantedCriteria(): Promise<WantedCriteria>
  setWantedStatus(key: string, status: WantedStatus, note?: string): Promise<void>
  addMissingWanted(artist: string, title: string, refFileId: number | null): Promise<string>
  exportWanted(format: WantedFormat, onlyNew: boolean, playlistId?: number | null, que?: WantedQue): Promise<{ path: string; count: number; marked: number } | null>
  /** "Bajar con NAPIA": abre NAPIA con la lista cargada (null si no hay nada); `bandeja`: si la Bandeja pasó a vigilar la de NAPIA. */ wantedToNapia(onlyNew: boolean, playlistId?: number | null, que?: WantedQue): Promise<{ path: string; count: number; marked: number; bandeja: string | null } | null>; /** Trae NAPIA adelante (o la abre). */ traerNapia(): Promise<void>; /** NAPIA con esos temas, para buscar una copia mejor (cuántos fueron). */ mejorarConNapia(ids: number[]): Promise<number>
  /** Los nombres de la lista se limpian en un hilo aparte: empieza (true) o termina (false; volver a pedir la lista). */ onWantedLimpios(cb: (limpiando: boolean) => void): () => void
  /** Traer una lista de otro lado: elegir el archivo (CSV, .m3u, .txt) o pegar el texto → vista previa (no guarda nada). */
  pickRequest(): Promise<RequestPreview | null>
  previewRequest(text: string, name?: string): Promise<RequestPreview>
  /** Una lista soltada en la ventana (CSV, .m3u, .txt). */
  previewRequestFile(path: string): Promise<RequestPreview>
  /** Abre Chosic o Exportify para bajar el CSV de una playlist de Spotify (el link queda copiado). */
  openListSite(site: 'chosic' | 'exportify', link: string | null): Promise<void>
  /** Crea la playlist del pedido y suma lo que falta a la lista «Faltan o suenan mal». */
  createRequest(p: { name: string; source: string; items: RequestItem[] }): Promise<RequestDetail>
  /** Confirmar (o no) un probable u otra versión; null = sin decidir. */
  decideRequest(itemId: number, decision: RequestDecision | null): Promise<RequestDetail>
  requests(): Promise<RequestSummary[]>
  requestDetail(id: number): Promise<RequestDetail | null>
  undoRequest(id: number): Promise<number>
  exportRequest(id: number, format: WantedFormat): Promise<{ path: string; count: number; marked: number } | null>
  /** Lo que llegó por la Bandeja entró a la playlist de un pedido. */
  onRequestsChanged(cb: () => void): () => void
  /** Palabras que sobran, aprendidas de la biblioteca (Arreglar nombres). */
  learnedWords(): Promise<LearnedReport>
  setLearnedWord(key: string, state: LearnedState): Promise<LearnedReport>
  inboxInspect(paths: string[]): Promise<InboxItem[]>
  inboxIgnore(path: string): Promise<void>
  pathForFile(file: File): string
  spaceTree(): Promise<SpaceNode>
  spaceJunk(): Promise<JunkReport>
  spaceTrash(items: { rootId: number; rel: string }[]): Promise<{ batchId: number | null; moved: number; failed: { rel: string; error: string }[] }>; spaceEmpty(items: { rootId: number; rel: string }[]): Promise<{ batch: number | null; removed: number; failed: { rel: string; error: string }[] }>
  spaceSavings(): Promise<SavingsReport>
  spaceDuplicateSavings(): Promise<{ groups: number; bytes: number }>
  spaceShrink(): Promise<ShrinkResult>
  mbStatus(): Promise<MbStatus>
  mbRun(retryFailed: boolean): Promise<{ looked: number; found: number; errors: number }>
  mbProposals(): Promise<MbProposal[]>
  /** held: los que quedaron "para mirar a mano" en Arreglar nombres (lo puso a mano la persona u otra herramienta antes). */
  mbStage(items: { fileId: number; fields: string[] }[]): Promise<{ staged: number; held: number }>
  mbCovers(): Promise<{ releases: number; tracks: number; none: number }>
  /** Claves de los servicios de internet (Fase C). Las claves se guardan cifradas y nunca vuelven a la interfaz. */
  onlineKeys(): Promise<OnlineKeysStatus>
  onlineSetKey(service: KeyService, value: DiscogsKeyInput | string | null): Promise<OnlineKeysStatus>
  onlineTestKey(service: KeyService): Promise<KeyTest>
  onlineSetDeezer(on: boolean): Promise<OnlineKeysStatus>
  /** AudD (reconocedor tipo Shazam): apagado de fábrica; manda 15 s de audio de los temas que nada más reconoció. */
  onlineSetAudd(on: boolean): Promise<OnlineKeysStatus>
  /** Buscar nombres oficiales (MusicBrainz, Deezer y, con clave, Discogs y AcoustID). Lo encontrado se ve en el perfil Oficial. */
  namesStatus(): Promise<NamesStatus>
  namesRun(retryErrors: boolean): Promise<unknown>
  /** Diccionario de artistas propio. */
  dictList(): Promise<DictEntry[]>
  dictSet(from: string, to: string): Promise<DictEntry[]>
  dictRemove(from: string): Promise<DictEntry[]>
  /** Pide dónde guardar; devuelve un mensaje o null si se canceló. */
  dictExport(): Promise<string | null>
  /** Pide el archivo; null si se canceló. */
  dictImport(): Promise<DictImport | null>
  /** Pantalla Discos: discos completos (lista oficial), tapas para todo y volumen parejo. Lo que toca archivos va a Cambios pendientes. */
  albumsReport(): Promise<AlbumsSummary>
  albumsPending(): Promise<number>
  albumsRun(retry: boolean): Promise<unknown>
  /** Edición elegida a mano ("musicbrainz:<id>"), "ignorar", o null = que decida PAILA. */
  albumsChoose(key: string, choice: string | null): Promise<AlbumsSummary>
  /** Manda lo que falta de esos discos a la lista «Faltan o suenan mal»; devuelve cuántos temas sumó. */
  albumsToWanted(keys: string[]): Promise<number>
  coversLast(): Promise<CoverProposal[] | null>
  coversScan(): Promise<CoverProposal[]>
  coversStage(keys: string[]): Promise<{ tracks: number; folders: number }>
  gainLast(): Promise<GainPlan | null>
  gainPlan(): Promise<GainPlan>
  /** Los temas listos, incluidos los que tenían el de otro programa mal puesto (el que coincide no se toca). */
  /** onlyWrong: solo los que corrigen el volumen parejo mal puesto por otro programa. */
  gainStage(onlyWrong?: boolean): Promise<number>
  jobs(): Promise<JobState[]>
  cancelJob(kind: string): Promise<void>
  dismissJob(kind: string): Promise<void>
  onJobs(cb: (jobs: JobState[]) => void): () => void
  analysisInsights(): Promise<AnalysisInsights>
  /** Modo avanzado: el inspector de un tema (por número, ruta o pedazo del nombre; `asistentes` suma lo que propondría cada uno), la cola del análisis, el registro de operaciones (con los últimos errores) y reanalizar un tema. Solo leen, salvo reanalizar (marca el análisis vencido: no toca archivos). */
  advInspect(ref: string, asistentes: boolean): Promise<AdvInspectResult>
  advQueue(): Promise<AnalysisQueueView>
  advOpLog(): Promise<{ ops: OpLogEntry[]; errores: { at: string; where: string; msg: string }[] }>
  advReanalyze(id: number): Promise<string>
  /** Intensidad del análisis: la de ahora, cambiarla (en el momento, queda guardada) y enterarse cuando cambia sola. */
  intensity(): Promise<IntensityInfo>
  setIntensity(mode: Intensity): Promise<IntensityInfo>
  onIntensity(cb: (i: IntensityInfo) => void): () => void
  pendingChanges(): Promise<PendingChange[]>
  discardChanges(ids?: number[]): Promise<PendingChange[]>
  applyChanges(ids?: number[]): Promise<ApplyResult>
  changeBatches(): Promise<JournalBatch[]>
  undoBatch(batchId: number): Promise<ApplyResult>
  /** Historial único: todo lo que PAILA hizo sobre archivos, del más nuevo al más viejo. */
  history(): Promise<HistoryEntry[]>
  historyDetail(kind: HistoryKind, id: number): Promise<HistoryDetail>
  /** Deshace una tanda del historial (llama al deshacer de cada módulo). */
  historyUndo(kind: HistoryKind, id: number): Promise<HistoryUndoResult>
  /** Lo que se encontró a medias al abrir (si la vez anterior PAILA se cortó) y qué se hizo. */
  recovery(): Promise<RecoveryReport>
  /** "Entendido": no volver a mostrar el aviso. */
  recoverySeen(): Promise<RecoveryReport>
  /** Volvió un disco con algo a medias y PAILA lo resolvió con la app abierta (`resolved` = cuántas cosas). */
  onRecovery(cb: (report: RecoveryReport, resolved: number) => void): () => void
  /** "Herramientas para DJ y producción": ¿están prendidas? (BPM y tono en la tabla, sección Para DJs, Cabina). Apagadas de fábrica. */
  djTools(): Promise<boolean>
  /** Las prende o las apaga a mano (después no se le vuelven a ofrecer). */
  setDjTools(on: boolean): Promise<boolean>
  /** Si parece que pincha (muchos temas con BPM o tono, carpetas "Sets", un rekordbox.xml): por qué, para ofrecerle prenderlas una sola vez. null = no ofrecer. */
  djToolsOffer(): Promise<string[] | null>
  /** Ya se le ofreció ("Ahora no"): no se vuelve a ofrecer. */
  djToolsOffered(): Promise<void>
  /** Reproductor: los temas de la cola (filas de la tabla, en el orden pedido) y los del álbum de un tema, en orden. */
  playerTracks(ids: number[]): Promise<unknown[][]>
  playerAlbum(id: number): Promise<number[]>
  /** Estadísticas de la colección Música (pantalla Estadísticas). */
  collectionStats(): Promise<CollectionStats>
  /** Actualizaciones (Fase H): estado, buscar, bajar, instalar ahora o al cerrar, saltear una versión, buscar sola al abrir. */
  updates(): Promise<UpdateState>
  updatesCheck(): Promise<UpdateState>
  updatesDownload(): Promise<UpdateState>
  updatesInstall(when: 'ahora' | 'al-cerrar'): Promise<UpdateState>
  updatesSkip(): Promise<UpdateState>
  updatesSetAuto(on: boolean): Promise<UpdateState>
  onUpdates(cb: (s: UpdateState) => void): () => void
  /** "Exportar diagnóstico": lo que va a ir en el zip (para mostrarlo antes) y guardarlo (null si se canceló). */
  diagnosticPreview(): Promise<DiagnosticPreviewFile[]>
  diagnosticSave(): Promise<string | null>
  onScanStatus(cb: (s: ScanStatus) => void): () => void
  /** Un disco se desconectó o volvió (las carpetas de hoy, con el puntito de cada una). */
  onRoots(cb: (roots: RootInfo[]) => void): () => void
}
