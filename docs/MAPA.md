# Mapa del código de PAILA (y NAPIA)

Índice para llegar al archivo justo. Cada archivo empieza con 1–2 líneas que dicen qué hace (lo revisa `tests/estilo.test.ts`).
Si agregás, movés o sacás un archivo, actualizá su línea.

## Estructura del repositorio (npm workspaces)
Un repositorio, dos programas y lo que comparten. Lo de `packages/` se importa por nombre (`@paila/core/db`), nunca con `../../`.
- `apps/paila/`: PAILA (`electron/`, `ui/`, `build/` con íconos y dibujo en `build/arte/`). Instalador y portable salen en `apps/paila/dist/`.
- `apps/napia/`: NAPIA, panel de control para sockseek. Se arma en `apps/napia/out/` y el instalador de PAILA la lleva (`PAILA.exe --napia`).
- `packages/core/` (`@paila/core`): el núcleo sin interfaz. `packages/shared/` (`@paila/shared`): contrato (`PailaApi`), tipos y ayudas.
- `packages/diseno/` (`@paila/diseno`): diseño compartido. Los programas lo meten en su armado (van como `devDependencies`).
- Raíz: `tests/` (un solo `npm test`), `scripts/`, `docs/`, `tsconfig.json` (una sola revisión de tipos), `vitest.config.ts`.
- Los comandos se corren desde la raíz: `build` arma NAPIA y PAILA; `dist` y `pack` arman NAPIA y el instalador; `dev` es PAILA, `dev:napia` NAPIA.

Regla general: **la lógica vive en `packages/core/`** (sin interfaz, con tests); `electron/` solo conecta (ventana, diálogos, IPC); `ui/src/` solo muestra.
Una función nueva casi siempre toca, en orden: `packages/core/` → `packages/shared/types/<área>.ts` → `electron/ipc/<área>.ts` + `preload.ts` → `ui/src/`.

**Cómo viaja un pedido:** `ui/src/*.tsx` llama a `window.paila.algo()` → `preload.ts` → IPC → `electron/ipc/<área>.ts` (`ipcMain.handle`) →
`packages/core/` → SQLite (`db.ts`). La lista de funciones es `PailaApi` en `packages/shared/types/api.ts`.

**Textos en dos idiomas:** cada texto que se ve va en un par castellano/inglés con `textos()` (`packages/shared/idioma.ts`). Cuando no entran en el
archivo, van al lado en `<archivo>.textos.ts` (por ejemplo `Tidy.textos.ts`, `grade.textos.ts`, `main.textos.ts`): no se listan uno por uno acá.
Lo que se escribe en los archivos de la persona no se traduce. Detalle en `AGENTS.es.md` ("Textos e idioma").

## `packages/core/` — biblioteca y base
- `db.ts`: SQLite (`node:sqlite`), migraciones, `transaction`, `visible()`/`listed()` (el filtro único de "tema visible"), consultas preparadas y `allRows` (filas como objetos comunes, para consultas grandes que se recorren mucho).
- `migrations.ts` · `migrations-2.ts`: migraciones numeradas (posición = versión; v1…v28 y desde la v29).
  Agregar siempre al final de `migrations-2.ts`, nunca editar las viejas; las nuevas con `IF NOT EXISTS`.
- `library.ts`: clase `Library` (carpetas raíz por disco, reglas de colección, `tracks()`, `trackPath()`); delega en los de abajo.
- `libraryjob.ts`: estado del trabajo largo y pausar/seguir/detener; `idle()` espera al análisis antes de tocar archivos.
- `rootmerge.ts`: unir carpetas (una raíz que contiene a otra), solo en la base.
- `scan.ts`: escaneo incremental; nunca borra y reconecta movidos y renombrados.
- `escaneo-al-abrir.ts`: si PAILA escanea sola al abrir (`escanearAlAbrir`; no sin carpetas, ocupada, en captura o con `PAILA_SIN_ESCANEO_AL_ABRIR=1`).
- `queue.ts`: cola de análisis (qué falta, `isLossless`); `stillThere`: cada pasada lee el tema donde está ahora, por si PAILA lo movió.
- `readguard.ts` · `rootswatch.ts`: qué hace una pasada si no puede leer un tema (`MAX_TRIES`) · vigila qué carpetas están.
- `precise.ts` · `reanalysis.ts` · `silencepass.ts`: pasadas en segundo plano: BPM/tono precisos · rehacer una parte al mejorar el motor · silencios.
- `stylepass.ts`: estilo por el sonido en segundo plano, si se bajó el modelo (`lib.styleModels`): tabla `sound_style` y recalcula la energía.
- `colstats.ts` · `artistcountry.ts` · `insights.ts` · `inicio.ts`: Estadísticas · país del artista (de la caché) · Análisis · Inicio. Solo leen.
- `estado.ts` · `estado-grupos.ts` · `estado-dejar.ts`: **el estado de la colección** (MASTERPLAN-5, etapa 1): cuántos repetidos, sin buscar en internet, nombres rotos, discos con tapa para poner, fuera de su carpeta y suenan mal, contado de la base (si deshacés, vuelve) · una cuenta por parte · "Dejar como está" por tema (`dejar_como_esta`) y la regla de carpetas elegida (`settings` `organizar.regla`). Los repetidos van aparte (leen archivos, con el análisis terminado).
- `propuestas.ts` · `aplicar.ts`: **las propuestas guardadas y un solo Aplicar** (MASTERPLAN-5, etapa 2): lo que va a la papelera o se mueve queda en la base (`propuestas`, con el tamaño y la fecha del archivo que se miró; los cambios de tags, en `pending_base`) · la lista única (`paraAplicar`, papelera y mover con número negativo) y `aplicarTodo`: papelera → nombres y tags → mover (el lugar se recalcula y tiene que ser el que se vio) → tapas → reemplazos (Sonido), una tanda en `tandas`. Si el archivo cambió desde que se miró, no se toca y vuelve con el motivo; `reestampar` cuando lo escribe PAILA misma.
- `revision.ts` · `revision-armar.ts` · `revision-apagados.ts` · `revision-internet.ts`: **Ordenar, la revisión única** (MASTERPLAN-5, etapa 3): leer la lista en grupos con "Para decidir vos" · armarla sola (repetidos seguros, nombres, carpetas sobre cómo van a quedar) y contestar las cartas · lo destildado a la vista · internet una sola vez (el OK guardado, lo seguro tildado y lo dudoso sin tildar). `forma-actual.ts`: la forma que ya tienen tus carpetas (se propone la primera vez).
- `repetidos-guardados.ts` · `covers-guardadas.ts` · `organizer-futuro.ts`: lo que encontraron Duplicados y Tapas queda en la base (`resultados`) y se lee al día (lo que ya se fue, lo que cambió, lo dejado como está, el disco movido) · Organizar sobre cómo van a quedar los temas (con los nombres para aplicar y sin lo que va a la papelera).
- `playerqueue.ts` · `djsignals.ts` · `views.ts`: "seguir por álbum" · señales de que pincha (ofrece herramientas DJ) · vistas guardadas.
- `requestworker.ts` · `requestserver.ts`: vista previa de "Traer una lista" en un hilo aparte (base solo lectura).
- `tableindex.ts` · `tableworker.ts` · `tableserver.ts`: tabla de bibliotecas grandes (desde 20.000 temas) en un hilo con su propia conexión.
- `files.ts` · `volumes.ts` · `collections.ts` · `probe.ts`: recorrido de carpetas · discos por número de serie · colecciones y exclusiones (Inéditos = `proyectos`: demos, promos, wip…) · ffprobe (en Windows, el de gyan.dev de `recursos/ffprobe`; en Mac, ffprobe-static).
- `volumes-mac.ts`: discos en Mac (`/Volumes/<nombre>`, el número propio de cada disco con `diskutil`); lo usa `volumes.ts`.
- `oplock.ts`: candado de operaciones (nada que escriba archivos corre a la vez); `unsafeToClose` y `free()`.
- `jobs.ts`: procesos largos en segundo plano (sobreviven a cambiar de pantalla); `cancelAll` al cerrar; los que usan el mismo servicio de internet (`uses`) esperan en fila (`waiting`).
- `mudanza.ts` · `mudanza-traer.ts`: **Pasar a otra compu**: Exportar todo (un .paila sin claves, con tapas y ventana) · traerlo (`emparejar` por ruta, mayúsculas/acentos, nombre o fecha; `armarTraida`, `ponerTraida`).
- `backup.ts`: respaldo diario de la base. `listdeezer.ts`: ISRC de una lista traída, en Deezer, con caché `online_cache`.

## `packages/core/` — modo avanzado (inspector, cola, registro)
- `inspector.ts`: inspector de un tema (`inspectTrack`, `findTrack`, `openReadOnly`); lo comparten `npm run tema` y la ventana. Solo lee.
- `inspector-historia.ts` · `inspector-texto.ts` · `inspector-base.ts`: historial y asistentes del tema · pantalla de texto · base vieja.
- `advanced.ts`: `analysisQueue` (qué espera cada pasada), `operationLog` (diario + Historial) y `reanalyzeTrack` (no toca archivos).

## `packages/core/` — seguridad de archivos
- `safefs.ts`: `moveNoClobber` (mover sin pisar) y `trashBatch`. `journal.ts`: diario `op_journal`, se anota antes de tocar un archivo.
- `recovery.ts` · `recoverywatch.ts`: al abrir tras un corte (y con la app abierta si vuelve un disco), termina o deshace lo que quedó a medias.
  `recovery-tags.ts`: una escritura de tags a medias (el temporal se saca; si ya había reemplazado al original, vuelve desde el respaldo liviano).
- `ops/` — **motor de operaciones único** (`docs/diseno/motor-operaciones.md`): `types.ts` (pasos), `checks.ts` (chequeos previos de la tanda),
  `run.ts` (`runMoves`/`runMovesAsync`: diario → mover sin pisar → verificar → confirmar). Papelera, Organizar, Espacio y Bandeja mueven con él;
  reemplazo, tags y Vaciar usan sus chequeos (`checkOrThrow`). `copy.ts` (`CopyOut`): lo que se escribe afuera de tu Música (pendrive, celular,
  listas .m3u8, Rekordbox, Traktor, Serato, VirtualDJ, Engine DJ) con diario, copia temporal al lado, verificación y renglón en el Historial (`copies_log`).
  `backup.ts`: **respaldo liviano** de lo que cambia por dentro (tags, tapas, volumen…): vista previa estimada, aviso si pasa del 10 % de lo libre,
  freno si crece de más, un pedazo por archivo en `_PAILA/respaldos` o la carpeta elegida (`backups`, `backup_files`); `changes-backup.ts` lo arma
  para Cambios pendientes. `delta.ts`: lo que cambia entre dos versiones de un archivo (guardar, rearmar, verificar con la huella).
  `metasize.ts`: cuánto ocupan los metadatos de un archivo, leyendo solo los encabezados (para la vista previa). `backup-trash.ts`: la lista
  de respaldos; "borrar" los manda a la papelera de PAILA y de ahí se recuperan hasta vaciarla.
- `audiohash.ts` · `lowpriority.ts`: `pcmHash`, huella del sonido para verificar lo escrito · prioridad baja (`PAILA_PRIORIDAD_NORMAL` en tests).
- `history.ts`: Historial único con deshacer por tanda; las tandas salen de `history-files.ts` (tags, papelera, organizador, limpieza),
  `history-replace.ts` (reemplazos, conversiones), `history-copies.ts` (lo copiado afuera, sin deshacer) y `history-text.ts` (textos). "Vaciar papelera" tiene su renglón y no se deshace.
- `history-cadena.ts` (+ `history-cadena.textos.ts`): **deshacer encadenado** (MASTERPLAN-5, etapa 4): las partes de cada Aplicar en una entrada
  `aplicar`, la huella de cada tanda (temas, lugares, carpetas), la `cadena` (lo que vino después y la toca: se deshace antes, de una, o nada)
  y los puntos de "Volver a como estaba" (uno por Aplicar). `restos.ts`: lo que creó cada tanda (tabla `creados`, v58: las carpetas nuevas de
  Organizar), sacar al deshacer las que quedaron vacías (nunca otras) y mandar a la papelera el cover.jpg que puso PAILA (`tapaAPapelera`).
- `fechas.ts`: la fecha de cada archivo que escribe Cambios pendientes (tabla `fechas`, v59): deshacer se la devuelve, exacta.
- `reloj.ts`: la hora con que se anota cada tanda (`ahora()`): nunca se repite ni va para atrás, así el Historial y la cadena saben qué vino después.
- `trash.ts` · `purge.ts`: papelera propia (restaurable) · Vaciar papelera (el único borrado real, a mano).
- `trash-dj.ts`: el duplicado que va a la papelera le pasa a la copia que queda la estrella más alta y las veces tocado de Rekordbox.

## `packages/core/` — tags y nombres
- `tagio.ts`: leer/escribir tags y tapas (node-taglib-sharp), arreglos de archivos difíciles, verificación por huella, `transplantTags`.
- `asftags.ts`: tags en WMA re-empaquetando con ffmpeg sin recodificar (solo textos y volumen; el audio queda idéntico).
- `mp3fix.ts`: MP3 que la librería de tags no abre (tag mal cerrado, restos antes del audio): se agranda el tag hasta el audio; leer sobre una copia arreglada.
- `id3keep.ts`: guardar nunca borra cuadros ID3v2 que PAILA no tocó (lo carga `tagio.ts`).
- `changes.ts` · `changes-write.ts`: **Cambios pendientes** (`stage` → `apply` → `undo`) · escritura segura de cada archivo (temporal en `_PAILA/escribiendo`
  → verificar → guardar lo que cambia → reemplazar de una vez). `changes-file.ts`: cambiar un tema (renombre + tags, con diario y base).
  `changes-undo.ts`: deshacer byte a byte desde el respaldo liviano (o desde las copias completas de la 0.5.3).
  `changes-meta.ts`: de cada cambio pendiente, quién lo propuso y por qué falló (lo que falla queda aparte, con "Sacarlos").
- `confianza.ts`: orden de confianza para nombres y tags (a mano > oficial > reglas): lo de abajo no pisa lo de arriba, queda "para mirar a mano".
- `tagactions.ts` · `extensions.ts`: acciones masivas puras · extensiones que mienten (`sniff`, `extensionFix`).
- `tidy.ts`: asistente "Arreglar nombres y tags": `tidy()` corre los pasos, `tidyFirst()` abre la pantalla con el perfil elegido y `tidyProfiles()` cuenta los demás; marca "vinilo" (`saveVinyl`).
- `tidyworker.ts` · `tidyserver.ts`: los números de los otros perfiles de nombres en un hilo aparte (base solo lectura; vale el último pedido).
- `tidy-steps.ts` · `tidy-filename.ts` · `tidy-official.ts` · `tidy-learned.ts`: los pasos del asistente, uno por tema de cada archivo.
  `tidy-broken.ts`: tags rotos que se arreglan solos ("05.Que" / "ves", "152_Bee Gees", "Various Artists" con "Artista - Título"); lo llama el paso del nombre del archivo.
- `tidy-djtag.ts`: el paso que borra del tag el BPM y el tono que seguro están mal (`junkBpm`, `junkKey`, `djTagJunk`); no escribe lo de PAILA.
- `names.ts` · `artists.ts` · `versionwords.ts`: reglas de texto · de artistas (feat., canales, vinilo) · lista única de palabras de otra versión.
- `sets.ts`: "Sets y en vivo" (temas largos que son un set).
- `tracklist.ts` · `tracklist-build.ts`: tracklist automático de sets (MASTERPLAN-3, 5): huella en ventanas (`findHits`) · armar el tracklist. Puros.
- `setlists.ts` · `setlists-scan.ts` · `setlists-out.ts`: tracklist con la base (`set_prints`) · escuchar (`scanSet`) · .cue, CSV, tag y cues.
- `musicbrainz.ts`: MusicBrainz y Cover Art Archive (1 pedido/s, caché `mb_lookup`). Solo completa lo vacío.

## `packages/core/` — nombres oficiales (Fase C)
- `online/http.ts` · `online/sources.ts`: pedidos con buenos modales (`Polite`, caché `online_cache`) · fuentes (MusicBrainz, Deezer, Discogs, AcoustID).
- `online/audd.ts` · `online/deezerbpm.ts` · `online/hits.ts`: reconocedor AudD (opcional, apagado) · BPM de Deezer · formato común de las fuentes.
- `official.ts` · `official-findings.ts` · `official-run.ts`: decide qué artista/título proponer · lee la caché · `OfficialSearch` (retomable).
- `online/lastfm.ts`: etiquetas de Last.fm del tema y del artista (con la clave de cada uno; error 6 = no lo conoce).
- `genrewords.ts` · `genres.ts`: **géneros desde internet**: vocabulario cerrado (estilo → género general, otras formas, "!" = solo Discogs) · elegir uno por tema (puro).
- `genres-find.ts` · `genres-run.ts`: propuestas desde la caché (solo vacíos o "Other", el disco manda, la escritura de tu biblioteca, "misma cosa escrita distinto") · `GenreSearch` (Discogs y Last.fm).
- `artistdict.ts` · `junkwords.ts`: diccionario de artistas propio · palabras que sobran, aprendidas por huella (con "No es basura").

## `packages/core/` — ordenar, limpiar, mejorar
- `organizer.ts` · `folderplaylists.ts` · `playlists.ts`: Organizar (choques "(2)", `moves_log`) · Carpetas → Playlists · playlists virtuales.
  `organizer-names.ts`: cómo se escribe la carpeta del artista (el nombre oficial con sus mayúsculas, cruzado con Deezer; si no, la forma
  que más usás) y las colaboraciones de uno o dos temas en la carpeta del primer artista.
- `playlistops.ts` · `improve.ts` · `m3uexport.ts`: fusionar, limpiar y borrar playlists (`playlist_ops`; los pedidos de Traer una lista las siguen) · "Mejorar esta playlist" · .m3u8 para PC.
- `duplicates.ts` · `dupnames.ts` · `dupkeeper.ts`: duplicados en cuatro grupos (las versiones nunca se proponen para tirar) · reglas de nombres ·
  cuál copia se queda (`pickKeeper`: nota, formato, la que satura menos que otra, bitrate, tags, lugar; también para playlists).
- `soundindex.ts` · `soundmatch.ts` · `printmatch.ts`: índice de huellas acústicas · comparar dos huellas (`sameLength`, `standsOut`,
  `sharedFrames`: pedazos que dicen algo) · archivo nuevo vs biblioteca.
- `space.ts` · `replace.ts` · `convert.ts`: Espacio y WAV/AIFF → FLAC verificado · reemplazar un tema por uno mejor (la grilla y los cues viejos se sacan y vuelven al deshacer: `replace_dj`) · convertir WMA/OGG/Opus.
- `emptydirs.ts`: sacar las carpetas vacías desde Espacio (nunca en lo protegido), con Historial y un deshacer que las vuelve a crear.
- `trim.ts` · `trimfile.ts` · `trimmp3.ts` (+ `trim.textos.ts`): **recortar silencios** (propuesta, Cambios pendientes campo `trim`, aplicar con el Reemplazo) ·
  cortar y verificar un MP3, FLAC o WAV sin perder nada, con los tags intactos · MP3 por cuadros sin recodificar (cabecera Xing/LAME). Puros los dos últimos salvo ffmpeg.
- `wishlist.ts` · `wanted.ts`: lista «Faltan o suenan mal» por disco · por tema (tabla `wanted`, `listName`, exportar). PAILA no descarga.
- `albums.ts`: qué es un disco (nunca sueltos, sets ni sample packs). Lo usan las de abajo.
- `albumsources.ts` · `albumcheck.ts` · `albumrun.ts`: **Discos completos**: listas oficiales (`online_cache`) · elegir edición · proceso y `album_choice`.
- `covers.ts` · `coverstore.ts` · `foldercover.ts`: **Tapas para todo** · tapas por contenido en `tapas/` (los cambios guardan la referencia) · cover.jpg.
- `coversimilar.ts`: ¿dos tapas son la misma imagen? (achicadas a 16×16 en color con ffmpeg), antes de preferir la de la carpeta.
- `replaygain.ts`: **Volumen parejo** (ReplayGain 2.0, -18 LUFS): solo el tag, el audio no se toca.
- `listparse.ts` · `listexport.ts`: lector de listas (CSV, texto, .m3u, sockseek) · formatos de sockseek (y `napiaCsv`: con la nota de la copia que tenés, para "Bajar con NAPIA"). Puros: los comparte NAPIA.
- `listmatch.ts` · `isrc.ts` · `requests.ts`: emparejar lista con biblioteca (`sameSong`; un cover se ofrece como otra versión) · ISRC de los tags · "Traer una lista" (`SURE`).
  `requests-update.ts` · `requests-sync.ts`: "Los dos" (`request_versions`) y traer otra vez la misma lista (`sameName`, `updateItems`) · lo que llega por la Bandeja entra a la playlist (`syncArrived`).
- `inbox.ts` · `inboxflow.ts` · `inboxwatch.ts` · `inboxadd.ts`: Bandeja: `identify` · `verify` y Reemplazar todos · vigilancia · Pasar a tu Música.
- `sonido-reemplazos.ts`: Sonido (MASTERPLAN-5, etapa 5): lo que llegó a la Bandeja y es mejor queda propuesto solo (`proponerDeLaBandeja`, propuesta `reemplazo`) y se aplica al final del Aplicar único (`aplicarReemplazos`), como parte de la tanda.
- `peor-primero.ts`: el orden de lo que se ofrece mejorar, de peor a mejor sonido (nota y kbps de verdad; `peorPrimero`).
- `better.ts`: "claramente mejor que tu copia" (`clearlyBetter`), sin saturar más (`saturaMas`) ni durar distinto (`duraDistinto`): la misma vara para la Bandeja (`inboxflow.verify`) y para NAPIA cuando baja un reemplazo.
- `export.ts` · `carry.ts` · `carrydevice.ts` · `mtp.ts`: playlist a pendrive · **Llevar la música** al celular (`decide`) · envío por cable · MTP.
- `serverready.ts`: chequeo "listo para tu servidor" (Plex, Jellyfin, Navidrome). Solo lee.

## `packages/core/` — ZIP y RAR de la biblioteca (MASTERPLAN-3, 4)
- `archives.ts`: el escaneo anota cada .zip y .rar leyendo solo su índice (`syncArchives`, tabla `archive_entries`), sample packs (`samplePack`),
  "ya está afuera" (mismo tamaño y formato, o mismo nombre ±5 %) y escuchar (`prepare`: saca solo ese tema a la caché).
- `archive/read.ts`: `listArchive` (sin descomprimir) y `extractEntries` (ZIP comunes con lector propio; RAR y ZIP raros con libarchive en un hilo).
- `archive/zipread.ts` · `archive/rarread.ts` · `archive/names.ts`: índice del zip · encabezados RAR4/RAR5 y el "mini RAR" (`rarMini`) · nombres y `safeRel`.
- `archive/libarchive.ts` · `archive/worker.ts`: libarchive (BSD) en WebAssembly (libarchive-wasm, MIT); nunca código de unRAR · su hilo (`archive-worker.js`).
- `archive/analyze.ts` · `archive/extract.ts`: leer y analizar de a un tema (`readArchives`) · **Sacar al lado** (vista previa, `_PAILA/abriendo`, motor
  con ops `abrir`/`deshacer-abrir`, Historial `comprimido`, deshacer a la papelera, `recoverExtract`).
- `archive/papelera.ts`: **Mandar el comprimido a la papelera** (solo si todo lo de adentro ya está afuera, nunca un sample pack; un rar partido va entero):
  vista previa, ops `zip-papelera`/`zip-restaurar`, tabla `archive_trashed` (v37), Historial `comprimido-papelera`, `recoverArchiveTrash`.
- `stems/separar.ts`: **Separar voz**, lo que toca archivos: carpeta propia (de fábrica «Acapellas e instrumentales (PAILA)», cuenta como Producción),
  nombres con BPM y tono, guardar por el motor (ops `separar`/`deshacer-separar`, `_PAILA/separando`, tabla `stems_made` v46), Historial `separar`, deshacer
  a la papelera, `recoverStems`, el buscador y la espera de uno mejor (`stems_wait`).
- `stems/modelo.ts` · `stems/correr.ts` · `stems/worker.ts`: bajar el modelo (Inst_HQ_3 de UVR) y onnxruntime-node verificados por huella, sin DirectML
  (`sacarTgz`) · leer, separar y escribir FLAC de 24 bits · su proceso (`stems-worker.js`, de Electron, prioridad baja). Separar en 4
  (opcional, `CUATRO_FILES`): modo `cuatro` del trabajo, con el mismo motor.
- `stems/demucs.ts`: separar en 4 (voz, batería, bajo y resto) con HT-Demucs v4 en ONNX: pedazos de 7,8 s que se pisan un cuarto.

## `packages/core/` — Programas de DJ (antes "Rekordbox y cabina"), nivel pro (Fase F)
- `rekordbox.ts` · `rbxml.ts`: exportar `rekordbox.xml` (TrackID fijo, `pailaWhenMoving`; equipos) · leerlo entero. Puro.
- `pdb.ts` · `anlz.ts`: lectores propios del pendrive de CDJ (`export.pdb`, `ANLZ*`), solo lectura. Puros.
- `listimport.ts`: traer playlists de Rekordbox (XML o pendrive): `readRbXml`, `readPendrive`, `create`; tablas `list_imports`, `request_import`.
- `serato.ts` · `djdata.ts`: marcadores de Serato (solo lee) · `DjData`: `dj_grid`, `dj_cues`, `dj_meta`, `rb_ids`; `rbShift`.
- `rbmoving.ts`: cuántos de los temas que se mueven o se renombran están en Rekordbox (el aviso de Organizar y Arreglar nombres).
- `djexport.ts`: exportar a Traktor, Serato, VirtualDJ y Engine DJ con lo elegido por `Rekordbox.pick` y `marks` (tiempo de Rekordbox).
- `traktor.ts` · `seratofmt.ts` · `virtualdj.ts`: el .nml · crates y marcas de Serato (`encodeMarkers2`, `encodeBeatGrid`) · `database.xml` y MyLists. Puros.
- `enginedj.ts` · `enginedb.ts`: Engine DJ: el formato de cada tema (tono, grilla, pads, loops; referencia: libdjinterop) · una biblioteca por disco (`Engine Library/Database2/m.db`): los temas en la de su disco, las playlists ("PAILA") en la de la compu (`writeEngine`); `createEngineDb` arma la de un disco que no tiene.
- `seratotag.ts`: las marcas de Serato y el TKEY dentro del archivo, campo `serato` de Cambios pendientes (leer, escribir, en palabras).
- `djtag.ts`: el BPM y el tono del tag (TBPM/TKEY, BPM/INITIALKEY, tmpo/initialkey), campos `bpm` y `key` de Cambios pendientes; lo leído queda en `file_djtag`.
- `mpv.ts`: salida "bit perfect": opciones de mpv (WASAPI exclusivo; en Mac, CoreAudio exclusivo), sus salidas y su canal de control (`Mpv`).
- `gridrun.ts` · `setbuilder.ts`: "Grilla y cues" (`gridPlan`, `gridPass`) · armado de set (Camelot, BPM, energía; `combinan`).
- `energia.ts` · `energiamarcas.ts`: energía 1–10 (`trackEnergy`: con el modelo de estilos, calibrada o `energyOf`; `fitEnergy`) · energía a tu oído: temas para marcar, `energy_marks`, `calibrate`, `recomputeEnergy`.

## `packages/core/` — lista para compartir (Fase H; qué falta: `docs/compartir.md`)
- `updates.ts` · `errorlog.ts` · `diagnostic.ts` · `zip.ts`: `latest.yml` e instalador · registro de errores y `scrub` (`alAnotar`: lo mira el Chequeo) · zip del diagnóstico.
- `chequeo.ts` (+ `chequeo.textos.ts`) · `chequeo-sondas.ts`: **el Chequeo** (Configuración): un control por cosa (programas, escribir, lugar, base, MusicBrainz, claves, NAPIA)
  con su arreglo; `Sondas` para probarlo sin internet; `controlDelError` (qué control mirar cuando algo falla al usarse) · las pruebas de verdad (quick_check en un hilo).
- `notasdeuso.ts`: **Notas de uso** (botón Anotar): `guardarNota` escribe `notas-de-uso/AAAA-MM-DD.jsonl` (hora, pantalla, hasta 5 pantallas anteriores, texto) y la captura PNG al lado; `listarNotas` las lee, la más nueva primero. Nada sale de la PC.
- `prueba.ts` · `prueba-informe.ts`: **modo prueba** (pruebas con personas): `RegistroPrueba` (un .jsonl con pantallas y su tiempo, volver, clics, avisos, errores), `VigiaTareas`/`tareasHechas` (las tareas cumplidas, mirando la base) · `resumir` e `informeMarkdown` (tiempo por tarea, trabas). Nada sale de la PC.

## `packages/core/sockseek/` — NAPIA (sin interfaz; tests `napia*.test.ts`)
- `config.ts` · `args.ts`: encontrar sockseek y leer su config (nunca devuelve la cuenta) · la lista y los argumentos que se le pasan.
- `progress.ts` · `run.ts`: leer la salida de sockseek (`Progress`) · correrlo como proceso hijo (`SockseekRun`).
- `firewall.ts` · `firewall-sistema.ts`: el firewall de Windows cruzado con el tipo de red (Privada, Pública, Dominio): casos y arreglo, puros ·
  leerlo (netsh y PowerShell, sin administrador), "Arreglarlo" con el permiso de Windows y `NAPIA_RED_FALSA` (firewall y router inventados, para pruebas).
- `router.ts`: abrir el puerto de escucha en el router (UPnP o NAT-PMP). Sin librerías; la red se cambia en los tests (`Red`).
- `indexcsv.ts` · `carpetas.ts`: el índice de sockseek y los `.incomplete` · dónde queda lo bajado (`Reparto`, `infoDisco`; `limpiarAMedias`: lo que quedó a medio bajar de una fuente lenta).
- `paila.ts` · `yatenes.ts`: la carpeta de la Bandeja de PAILA (base en solo lectura) · "Saltear lo que ya tenés en PAILA" (solo lo que tenés en A/B; lo demás se baja para reemplazarlo; lo marcado "otra versión" no se saltea).
- `otraversion.ts` · `nombres.ts`: lo bajado es otra versión que no pediste (acapella, remix, en vivo: no sirve) · que llegue con el nombre y los tags de la lista (verificado por la huella del sonido).
- `tanda.ts` · `reintento.ts`: bajar en tanda y su historial (`historial.json`) · otra búsqueda para lo que no se encontró.
- `calidad.ts` · `control.ts`: la calidad real de lo bajado (espectro y nota de PAILA; `juzgar`: inflado, sin pérdida falso, dañado o peor que lo pedido; `esMejor`: si viene a reemplazar una copia tuya) · revisar cada tema antes de pasarlo a la carpeta, apartar lo trucho a `<lista>/descartados` y buscar otra fuente sin esos usuarios (`buscarOtrasFuentes`, hasta 3).
- `lentitud.ts`: una fuente muy lenta no frena la lista (`VigiaLentitud`: al ritmo del último minuto le faltan más de 5 minutos; `vigilar`: si es lo único que queda, corta ese sockseek y el tema va a otra fuente, como un intento).
- `enlace.ts` · `enlace-armar.ts`: el archivo `para-paila.json` con que NAPIA le cuenta a PAILA en qué anda · armarlo del avance (truchos, no encontrados, lo último que pasó, qué le falta para bajar).
- `disco.ts` · `disco-correr.ts`: Un disco (DECISIONES 07/11): ediciones y lista oficial de MusicBrainz y Deezer, emparejar la carpeta que llegó · el primer intento, la carpeta entera de una persona (lo bueno se anota en el índice: después, tema por tema solo lo que falta).
- `tramos.ts` · `muestra.ts`: la lista baja de a 25 temas (`ListaEnTramos`; la otra fuente, al terminar cada tramo, no al final de la lista) · un pedazo de lo que baja, revisado mientras baja (`VigiaMuestras`: solo inflado o sin pérdida falso; si es lo único que queda, se corta como una fuente lenta).

## `packages/core/analysis/` — motor de calidad y DJ
- `analyze.ts` · `worker.ts` · `pool.ts`: una sola lectura ffmpeg por tema (`analyzePrints`: solo huellas) · worker · grupo de workers.
- `intensity.ts` · `slots.ts`: intensidad (Tranqui / Normal / A fondo) · cuántos temas a la vez, cambiable sin cortar nada.
- `grade.ts` · `clues.ts` · `fft.ts` · `flicker.ts` · `mp3info.ts` · `decodeerrors.ts`: nota A+…F · pistas de origen · FFT · huecos · LAME · errores
  (tropiezos del decodificador y "overread", no palabras). `gaps.ts`: los cuadros que no se pueden leer, dónde y cuánto (segunda lectura, solo si faltan).
- `silence.ts`: silencios al principio y al final (`SilenceMeter`, `analyzeSilence`).
- `effnet.ts` · `effnetrun.ts`: Discogs-EffNet (estilo por el sonido, UPF, no comercial, se baja aparte): espectrograma de Essentia, pedazos, `soundStyle` (≥ 0,5) · archivos con su huella (`EFFNET_FILES`) y escucharlo en el worker.
- `chromaprint.ts` · `setprint.ts`: huella de AcoustID en TypeScript (`fingerprintSimilarity`) · huella de un set entero.
- `dj.ts` · `bpmrange.ts` · `beats.ts` · `keyfinder.ts`: BPM/tono/energía (Essentia) · rango por género (`foldBpm`) · tempo afinado · tono KeyFinder.
- `beatthis.ts` · `beatrun.ts`: Beat This! (lo de PAILA alrededor del modelo ONNX) · cargarlo (`beatThisMissing`).
- `stems.ts`: Separar voz, lo de PAILA alrededor de MDX-Net: FFT de cualquier largo (2·3·5), STFT como la de torch y el demix en pedazos. Puro.
- `grid.ts` · `gridbase.ts` · `gridbars.ts`: de los golpes a la grilla de Rekordbox (recta o variable según `steadiness`). Puros.
- `gridscan.ts` · `gridworker.ts` · `gridproc.ts` · `cues.ts`: grilla del tema entero (`beatThisGrid`) · su proceso aparte (`out/main/grid-worker.js`) · cómo le habla la app (`GridRunner`: si se cierra o pasa 15 min sin avanzar, saltea el tema) · cues por frases.
- `partes.ts`: candidata de partes del tema por graves; **no entró** (23/10, empata con `cues.ts`): solo para `scripts/partes.ts`. Puro.
- `bench.ts`: banco de BPM y tono contra una referencia (Rekordbox, tags).

## `apps/paila/electron/` — proceso principal
- `arranque.ts` · `main.ts`: entrada del programa (PAILA o, con `--napia`, NAPIA) · ventana, ciclo de vida, análisis; una sola PAILA por carpeta de datos.
- `context.ts` · `preload.ts`: `createServices` y contexto `Ctx` · puente `window.paila` (una línea por función de `PailaApi`).
- `intensity.ts` · `gridengine.ts` · `beatgpu.ts`: intensidad según batería y memoria · motor de la grilla (su proceso de Electron aparte) · Beat This! con WebGPU.
- `updates.ts` · `diagnostic.ts` · `media.ts`: actualizaciones (apagadas hasta la primera versión) · registro de errores · reproductor y espectrogramas.
- `ipc/library.ts` · `tags.ts` · `playlists.ts` · `cleanup.ts` · `history.ts`: carpetas y análisis · tags · playlists · limpieza · Historial.
- `ipc/dj.ts` · `imports.ts` · `sets.ts` · `tabla.ts`: Programas de DJ · traer playlists · tracklist de sets · vistas guardadas y "A Excel".
- `ipc/archives.ts`: ZIP y RAR (`zip:*`): lista, escuchar, leer y analizar (proceso `comprimidos`) y Sacar al lado (`comprimidos-sacar`, con candado).
- `ipc/energia.ts`: energía a tu oído (marcar, ajustar, de fábrica) y el modelo de estilos (bajarlo de la UPF verificado, quitarlo); pone `lib.styleModels`.
- `ipc/requests.ts` · `inbox.ts` · `quality.ts` · `albums.ts`: traer una lista · Bandeja y lista por tema · reemplazo · Discos (`mbFree`).
- `ipc/llevar.ts` · `bitperfect.ts`: exportar a Traktor, Serato, VirtualDJ y Engine DJ · mpv por detrás (`PAILA_MPV`, `PAILA_MPV_AO=null` sin sonido).
- `abrirnapia.ts`: abrir NAPIA (el mismo programa con `--napia`), para "Bajar con NAPIA" y el menú de Mac. Con `--bajar` (desde Sonido), NAPIA baja sola, minimizada.
- `ipc/sonido.ts` (+ `preload-sonido.ts`, `types/api-sonido.ts`): Sonido, una sola historia: el resumen (suena mal, faltan, llegaron), el estado de NAPIA de su enlace (`sonido:napia`), mandarle lo que falta con `--bajar` y los reemplazos en el Aplicar único. Lo registra `ipc/inbox.ts`.
- `ipc/mudanza.ts`: Pasar a otra compu (`mudanza:*`), poner la base traída al abrir y lo que recordaba la ventana.
- `ipc/genres.ts`: géneros desde internet (`genres:*`, proceso `genres`; con otra búsqueda en Discogs espera en fila).
- `ipc/separar.ts`: Separar voz (`separar:*`, procesos `separar` y `separar-modelo`): la cola de a un tema en su proceso aparte (el análisis espera, `separando`), guardar con el candado y bajar el modelo.
- `ipc/recortar.ts`: recortar silencios (`recortar:*`, proceso `recortar`); pone `Changes.trimmer`.
- `ipc/respaldos.ts`: respaldos de archivos por paso (`respaldos:*`): vista previa, lista, borrar a mano y elegir la carpeta.
- `chequeo.ts`: el Chequeo (`chequeo:*`) y sus avisos solos (`chequeo:aviso`: errores de disco lleno o base dañada, claves rechazadas; lo liviano al minuto de abrir).
- `ipc/estado.ts` (+ `preload-estado.ts`): el estado de la colección (`estado:leer`, `estado:dejar`; avisa `estado:cambio` cuando terminan los repetidos). Lo registra `ipc/cleanup.ts`, que le pasa lo que encuentra Duplicados y guarda la regla al Organizar. `EstadoApi` (`types/estado.ts`).
- `ipc/history.ts` (+ `preload-historial.ts`, `types/api-historial.ts`): el Historial, deshacer en cadena (`history:undoCadena`) y "Volver a como estaba" (`history:puntos`, `history:volver`).
- `ipc/aplicar.ts` (+ `preload-aplicar.ts`, `types/api-aplicar.ts`): la lista única (`changes:list`, `changes:discard`, `changes:apply` con `aplicarTodo`), lo último de Duplicados (`dup:ultimo`) y sumar repetidos o lo de Organizar (`propuestas:*`). Lo registra `ipc/tags.ts`.
- `ipc/ordenar.ts` · `ordenar-internet.ts` (+ `preload-ordenar.ts`, `types/revision.ts`): Ordenar (`ordenar:*`): armar en partes (los nombres en el hilo de `tidyworker.ts`), tildar, decidir y, con el OK, la vuelta de internet (nombres oficiales → MusicBrainz → tapas, con los trabajos de siempre que cada IPC pone en `c.internet`); avisa `ordenar:listo`. Lo registra `ipc/tags.ts`.
- `ipc/notas.ts` (+ `preload-notas.ts`): Notas de uso (`notas:*`): saca la captura con `capturePage` al abrir la cajita, guarda y lista; abre la carpeta. `NotasApi` (`types/api-notas.ts`) la suma a `PailaApi`.
- `prueba.ts`: **modo prueba** (`PAILA_PRUEBA=<carpeta>`): datos propios en `<carpeta>/datos`, pone `<carpeta>/Música` con la base vacía, anota los pedidos que fallan, mira la ventana (pantalla por el `data-pagina` de `Anotar.tsx`, clics, avisos) y las tareas; Ctrl+Mayús+F1…F5 marca el comienzo de cada tarea.
- `ipc/online.ts` · `carry.ts` · `advanced.ts` · `estilo.ts` · `idioma.ts`: claves cifradas (también Last.fm; `probarClave` para el Chequeo) y nombres oficiales · Llevar la música · modo avanzado · estilo · idioma (`idioma.json`, la primera vez el de Windows; NAPIA lo lee).
- Los "A pendrive" de `ipc/playlists.ts` y `ipc/carry.ts` también toman el candado; `PAILA_FAKE_PHONE=<carpeta>` simula un celular.

## `packages/shared/` (`@paila/shared`)
- `types/index.ts`: punto de entrada, siempre `@paila/shared/types`. Un archivo por área en `types/` (`library.ts`, `tags.ts`, `history.ts`…).
- `types/api.ts` · `types/api-traer.ts` · `types/api-archivos.ts` · `types/api-generos.ts` · `types/api-pantalla.ts` · `types/api-recortar.ts` · `types/api-respaldos.ts` · `types/chequeo.ts` · `types/api-separar.ts` (+ `types/separar.ts`): `AppState` y `PailaApi` (el contrato) · traer de Rekordbox, A Excel y vistas · ZIP y RAR · géneros · estilo e idioma · recortar silencios · respaldos · el Chequeo · Separar voz.
- Más tipos por pantalla: `types/albums.ts` · `archives.ts` · `carry.ts` · `requests.ts` · `sets.ts` · `wanted.ts` · `online.ts` · `genres.ts` · `junk.ts` · `stats.ts` · `share.ts` · `mudanza.ts`
  · `avanzado.ts` · `trim.ts`.
- `frases-calidad.ts`: la calidad en frases humanas ("suena como un MP3 de 128 aunque diga FLAC"), lo que llegó y lo trucho. `napia-disco.ts`: los tipos de Un disco.
- `napia.ts` · `napia-calidad.ts`: el contrato de NAPIA (`NapiaApi`), aparte del de PAILA: `@paila/shared/napia` · sus tipos de la calidad real (la revisión, la cuenta, la copia tuya; `napia.ts` los reexporta). `firewall.ts`: el firewall en palabras (`textoFirewall`), el mismo texto en NAPIA y en el Chequeo; `firewall-tipos.ts`, sus tipos y `FirewallApi`.
- `profile.ts`: **herramientas para DJ y producción** (una opción, apagada de fábrica; `settings.dj_tools`, `djOfferReasons`).
- `idioma.ts`: **castellano o inglés**: `textos()` (pares por pantalla), `num`, `fecha`, `cant`/`plural`, `lista`; el idioma lo deja el preload (`pailaIdioma`).
- `tidy-profiles.ts` · `eta.ts` · `oreja.ts` · `novedades.ts`: perfiles de nombres · `EtaMeter` · la oreja-termómetro · lee `docs/NOVEDADES.md`.
- `playqueue.ts` · `tablecsv.ts` · `trackinfo.ts` · `tableview.ts`: cola del reproductor · tabla a .csv · qué se muestra de un tema · filtrar y ordenar.
- `teclas.ts` · `menumac.ts`: atajos según el sistema (`teclas()`: "Ctrl" se lee "Cmd" en Mac; `esMac`; `escribiendo()`: si el foco está en un campo de texto, los atajos de una letra no se disparan) · el menú de arriba en Mac (PAILA y NAPIA).

## `apps/paila/ui/src/` — interfaz React
- `App.tsx` · `main.tsx` · `arranque.ts`: arma la ventana (barra de arriba, lateral, página elegida, paneles) · arranque · marcas de tiempo del arranque.
  El estado vive en `hooks/`.
- `hooks/`: `useLibrary.ts` · `useChanges.ts` · `usePlaylists.ts` · `useTableView.ts` · `useBigTable.ts` · `useSelection.ts` ·
  `useWindowEvents.ts` · `useSavedViews.ts` · `useDensidad.ts` · `useEstado.ts` (el estado de la colección, un pedido compartido; `dejarComoEsta`).
- `Sidebar.tsx` · `nav.ts`: barra lateral y mapa de pantallas. Pantalla nueva: `nav.ts` (`PageKey`) y la tabla de pantallas de `App.tsx`.
- `profile.tsx` · `DjOffer.tsx`: herramientas para DJ en toda la interfaz (`useProfile`) y la oferta de una vez.
- `atajos.ts` · `AtajosAyuda.tsx` · `CommandPalette.tsx` · `palette-buscar.ts`: mapa de atajos (si agregás uno, se anota ahí; también «Saltar al contenido» y el foco al cambiar de pantalla) · ayuda Ctrl+/ · Ctrl+K · cómo busca y ordena Ctrl+K.
- `conTeclado.ts`: un renglón que se abre con clic también se abre con Tab y Enter. La regla `tests/estilo-botones.test.ts` exige que todo `<div>`/`<span>` con `onClick` lo use (o `role=button`).
- `listaLink.ts`: cuándo lo pegado en «Traer una lista» es un link de Spotify (un CSV entero no lo es).
- `avanzado.ts` · `Inspector.tsx` · `ColaAnalisis.tsx` · `RegistroOps.tsx`: modo avanzado, apagado de fábrica (`NAV_AVANZADO` en `nav.ts`).
- `Player.tsx` · `PlayerQueue.tsx` · `audioout.tsx` · `Escuchando.tsx`: reproductor, su cola, salida de audio y la pantalla grande.
- `bitperfect.tsx` · `playerprefs.ts`: salida "bit perfect" (`MpvMotor`, se maneja como el `<audio>`) · lo que el reproductor recuerda y sus atajos.
- Inicio y análisis: `Home.tsx` · `Estado.tsx` (+ `Estado.lista.ts`: la tarjeta del estado de la colección con un solo botón, «Ver cuáles» y «Dejar como está»; reemplazó a Primeros pasos y sus marcas el 02/11) · `RecoveryNotice.tsx` · `Progress.tsx` · `Intensity.tsx` · `ProblemCenter.tsx` · `Stats.tsx` · `Silencios.tsx` (recortar silencios, desde el Centro de problemas).
- Primera vez: `Wizard.tsx` (elegir carpeta) · `Recorrido.tsx` (el recorrido con la oreja).
- Nombres y tags: `Tidy.tsx` · `AvisoRekordbox.tsx` (el aviso de temas de Rekordbox que cambian de lugar o de nombre, también en Organizar) · `LearnedWords.tsx` · `Online.tsx` · `OfficialNames.tsx` · `Genres.tsx` · `MultiEdit.tsx` · `ChangesBar.tsx`.
- Confirmar y resultado, iguales en todas las pantallas que tocan archivos: `Confirmar.tsx` (`ConfirmarBoton`, `Resultado`).
- Orden y limpieza: `Organize.tsx` · `Comprimidos.tsx` (ZIP y RAR) · `Duplicates.tsx` · `Cleanup.tsx` (Papelera, con el desglose de respaldos y temas) · `papelera.ts` (cuánto ocupa la papelera, para la barra lateral y la tarjeta de mantenimiento del Inicio; `warn` si pasa de 5 GB o el 5 % del disco) · `Space.tsx` · `treemap.ts` · `History.tsx` (+ `HistoryVolver.tsx`: "Volver a como estaba el día…"; `historialCadena.tsx`: el botón y la pregunta del deshacer en cadena) · `FolderPlaylists.tsx`.
- Ordenar: `Ordenar.tsx` (la pantalla) · `OrdenarCarpetas.tsx` + `ordenarRegla.ts` (la pregunta de las carpetas, el editor en bloques y los ejemplos) · `OrdenarInternet.tsx` (la pregunta de internet y "Internet: X de Y") · `OrdenarDecidir.tsx` · `OrdenarGrupos.tsx` · `OrdenarArbol.tsx` + `arbolCarpetas.ts` ("Cómo va a quedar").
- Discos y volumen: `Albums.tsx` · `AlbumsComplete.tsx` · `AlbumsCovers.tsx` · `AlbumsGain.tsx` · `Volume.tsx`.
- Sonido: `Sonido.tsx` (+ `Sonido.textos.ts`: suena mal → NAPIA → llegó → aplicar, en una pantalla) · `NapiaBanda.tsx` (el estado de NAPIA, arriba en Sonido, Faltan y Bandeja).
- Conseguir y traer: `Requests.tsx` · `Inbox.tsx` · `InboxPlan.tsx` · `Wishlist.tsx` · `WantedList.tsx` · `Replace.tsx` · `ABPlayer.tsx`.
- Programas de DJ: `Rekordbox.tsx` (+ `ExportarDj.tsx`: Traktor, Serato, VirtualDJ y Engine DJ) · `RekordboxPro.tsx` · `TraerRekordbox.tsx` · `SetBuilder.tsx` (+ `EnergiaMarcas.tsx`: Tu energía) · `Tracklist.tsx` · `BpmRanges.tsx` · `SepararVoz.tsx` (+ `.textos.ts`; `separar-soltar.ts`: lo que se suelta en la barra lateral).
- Llevar la música: `Carry.tsx` · `CarryPhone.tsx` · `CarryServer.tsx`. Playlists: `Playlists.tsx` (piezas de la barra lateral) · `PlaylistsPage.tsx` (la pantalla con todas, con tapas) · `playlistsUso.ts` (fijadas y últimas usadas de la barra) · `PlaylistTools.tsx` · `ViewTools.tsx`.
- Configuración: `Settings.tsx` · `Respaldos.tsx` (dónde van, cuáles hay, mandarlos a la papelera y recuperarlos) · `IdiomaChooser.tsx` (idioma; guarda y recarga) · `Mudanza.tsx` (Pasar a otra compu; también en la bienvenida) · `SettingsShare.tsx` (actualizaciones y diagnóstico; `NOVEDADES.md` va metido en el armado) · `UpdateNotice.tsx`.
  · `Chequeo.tsx` (el Chequeo; `ControlFila`) · `AvisoChequeo.tsx` (el aviso que aparece solo cuando algo falla al usarse).
  · `Anotar.tsx` (el botón Anotar de la barra de arriba y Ctrl+Mayús+N: la cajita y el recorrido de pantallas) · `NotasDeUso.tsx` (Configuración → Notas de uso: la lista y Abrir la carpeta).
- Tabla y ficha: `TrackTable.tsx` · `Detail.tsx` · `Tapas.tsx` · `thumbs.ts` · `tempo.ts` · `camelot.ts` · `problems.ts` · `format.ts` · `eta.ts`.
- Estilo historieta y oreja: `EstiloChooser.tsx` · `sellos.tsx` · `Termometro.tsx` · `tramos.ts` · `EmptyState.tsx`.
- Ayudas: `icons.tsx` (reexporta los de `@paila/diseno`) · `toast.tsx` (`toast(texto, tipo)`) · `jobs.tsx` · `global.d.ts`.
- `styles/`: `index.css` junta todo (variables y componentes vienen de `@paila/diseno/estilos.css`); el resto por tema: `base.css` · `layout.css` ·
  `table.css` · `pages.css` · `escuchar.css` · `marco.css` · `recorrido.css` · `listas.css` · `avanzado.css`.

## `scripts/`
- `textos.ts` · `textos-sueltos.ts` (`npm run textos [archivo]`): textos sin su par en inglés; la regla de `estilo.test.ts` (pendientes: `tests/idioma-pendientes.ts`).
- `tema.ts` (`npm run tema <archivo>`): el inspector de un tema en la terminal, solo lectura. Test: `tests/inspector.test.ts`.
- `turnos.mjs` (+ `turnos.d.mts`): avisos de turno entre sesiones. Lo usan `verificar.mjs`, `corpus.ts`, `escala.ts` e `intensidad.ts`.
- `verificar.mjs` (`npm run verificar`, `-- --rapido`): tipos → armado → tests → laboratorio, esperando a lo pesado de otras sesiones.
- `corpus.ts` · `corpus-turno.ts` (`npm run corpus`): laboratorio de archivos difíciles; compara con la corrida anterior del mismo tipo.
- `capturas.ts` · `capturas-comparar.ts` · `captura.mjs` · `png.ts`: capturas de todas las pantallas · compararlas · una suelta · PNG sin librerías.
- `medir-texto.ts`: cuántas palabras, botones y ⓘ tiene cada pantalla (en total y sin desplazar), con una copia de la base y solo mirar.
- `usabilidad.ts`: hace las tareas de la prueba de usabilidad (repetidos, nombres, pendrive, lista de Spotify, Rekordbox) desde el Inicio y mide clics, desplazamientos, palabras y botones, con una captura por paso.
- `pantallas.ts` · `teclado.ts`: recorren todas las pantallas en varios tamaños de ventana (y en inglés) midiendo el botón principal, cortes, encimados y tiempos · las tareas del kit solo con teclado (Tab, Escape, Ctrl+K).
- `prueba-personas.ts` (`npm run prueba -- armar|reiniciar|acceso`) · `prueba-personas-armar.ts`: la música de prueba desordenada (copiada de tu Música, con `LEEME.txt`), "Empezar de nuevo" y los accesos del escritorio. `prueba-personas-recorrido.ts`: recorrido de punta a punta en modo prueba. `prueba-informe.ts` (`npm run prueba:informe`): informe por persona con fotos del video.
- `demo.ts`: arma la biblioteca de demostración inventada (audio sintético, base escaneada, playlists) con la que se sacan las capturas públicas de `docs/capturas/`. `capturas-readme.mjs`: rehace esas capturas del README (seis pantallas, en castellano e inglés) con una copia de los datos de la demo.
- `video/`: el video (`docs/video`): `cuadros.mjs` (capturas de la app real, solo mirar) · `ver.mjs` (vista previa de las páginas, con la música) · `grabar.cjs` (graba el teaser o el tutorial cuadro por cuadro con `ir(t)` de su página, con su música) · `foto.cjs` (foto de una página entera) · `medir-musica.ts`.
- `conducir.ts` · `app-ruta.mjs` (+ `app-ruta.d.mts`): maneja la app compilada desde afuera, oculta · dónde están la app y Electron.
- `run-ts.mjs` · `externos.mjs` (+ `externos.d.mts`): corre un script TypeScript con el núcleo (esbuild) · plugin: mete `@paila/…`, deja afuera npm.
- `subir-version.mjs` (`npm run version:subir -- X.Y.Z`): sube PAILA y NAPIA juntas; exige la entrada en `docs/NOVEDADES.md`.
- `licencias.ts` (`npm run licencias`): arma `AVISOS-DE-TERCEROS.txt` y `docs/licencias.md`. `version-firmada.ts`: rehace `latest.yml` tras firmar.
- `preparar-instalador.mjs` · `modelos-beat-this.mjs` · `sockseek-freno.mjs`: lo primero de `dist`/`pack` · Beat This! (`--bajar`: de Hugging Face y npm) · sockseek con freno.
- `mpv-bajar.mjs` (`npm run mpv:bajar`): mpv fijo y revisado por huella a `apps/paila/recursos/mpv` (no va a git; su `AVISO.txt` sí).
- `notas-version.mjs`: la nota de cada versión en GitHub Releases, sacada de las novedades (castellano e inglés); la usa el armado. `vista-redes.cjs`: la imagen para redes del repo público (`docs/capturas/redes.png`).
- `ffprobe-bajar.mjs` (`npm run ffprobe:bajar`): el ffprobe de gyan.dev 6.1.1 (mismo armado que ffmpeg), revisado por huella, a `apps/paila/recursos/ffprobe` (no va a git) · `ffprobe-comparar.ts`: qué leen distinto dos ffprobe.
- `claves-ci.mjs` · `fuentes-gpl.mjs`: del armado de GitHub: `claves.local.json` desde los secretos · el código fuente de ffmpeg, mpv y sockseek que se adjunta a cada versión.
- **Mac** (solo corren en una Mac; las usa `.github/workflows/mac.yml`): `armar-mac.mjs` (`npm run dist:mac`: los dos .dmg, Apple Silicon e Intel,
  con el ffmpeg de cada uno) · `mpv-mac.mjs` (`npm run mpv:mac`: el mpv.app oficial, fijo y con huella, a `apps/paila/recursos/mpv-mac/<arch>`).
- `iconos/` (`motor.cjs` · `pagina.js` · `orejas.cjs`): arma íconos y figuritas desde `apps/*/build/arte/`; lo llaman los `make-icon.cjs`.
- Corridas supervisadas (sobre una copia de la base; bitácoras en `docs/pruebas/`): `listas.ts` · `palabras.ts` · `duplicados.ts` · `calidad.ts` ·
  `silencios.ts` · `recortes.ts` + `recortes-muestra.ts` (recortar silencios: vista previa y muestra en Música-copia) · `tracklist.ts` · `discos.ts` (+ `discos-muestra.ts`) · `generos.ts` · `volumen.ts` · `llevar.ts` · `bandeja.ts` · `rekordbox-idavuelta.ts` ·
  `traer-rekordbox.ts` (+ `pendrive-de-prueba.ts`) · `comprimidos.ts` · `estilo-sonido.ts` · `energia.ts` · `partes.ts` (punto 3 condicional) ·
  `llevar-dj.ts` (Traktor, Serato y VirtualDJ) · `engine-dj-prueba.ts` (Engine DJ de verdad: exportar y medir con golpes) · `ftf.ts` (+ `ftf-espectros.ts`: comparar la calidad con Fakin' The Funk) · `stems-prueba.ts` (Separar voz: SDR contra acapellas oficiales).
- NAPIA de punta a punta: `napia-calidad.ts` (la calidad real: abre NAPIA compilada, baja una lista a D:\PAILA-trabajo con sockseek de verdad o, con `--falso`, archivos truchos del laboratorio; con `--lentas`, también fuentes lentísimas; capturas y borra lo bajado).
- Grilla: `grilla.ts` · `grilla-revisar.ts` · `grilla-vivo.ts` · `grilla-tiempos.ts`. Banco de BPM y tono: `banco.ts` + `banco-motores.ts`.
- Ensayo general del punto 1 (los pasos de "tu Música" enteros sobre Música-copia; `docs/pruebas/2026-10-24-ensayo-punto-1.md`): `ensayo.ts`
  (duplicados, nombres, organizar, deshacer una tanda) + `ensayo-base.ts` · `ensayo-discos.ts` (discos, tapas, volumen, BPM y tono del tag) ·
  `ensayo-oficial.ts` (buscar nombres oficiales) · `ensayo-grillas.ts` (grillas en la app, rekordbox.xml, traer el de Rekordbox) · `ensayo-verificar.ts`
  (la copia contra el original, archivo por archivo).
- Repaso de criterios (lo que PAILA decide sola, contra la vista previa de la Música real; `docs/pruebas/2026-10-24-repaso-criterios.md`): `repaso.ts`
  (simular en la copia de la base los pasos de Duplicados y Nombres sin tocar archivos, Organizar con lo que conviene mirar, el segundo Organizar,
  "Dañado" con la cuenta vieja y la nueva, títulos con otras mayúsculas en Deezer y la tapa de Deezer de antes y de ahora).
- Seguridad de archivos: `motor-corrida.ts` (+ `motor-comparar.ts`: corrida supervisada del motor único) · `aplicar-corrida.ts` (corrida supervisada del Aplicar único, MASTERPLAN-5 etapa 2) · `ordenar-supervisada.ts` (corrida supervisada de Ordenar en vista previa, sobre copias de la base; etapa 3) · `ordenar-aplicar-400.ts` (Ordenar aplicado sobre Música-copia, comparado con el original y deshecho; etapa 3) · `deshacer-corrida.ts` (la del deshacer encadenado, etapa 4: cuatro Aplicar, la cadena, volver y comparar; también arma una carpeta de prueba) · `corte.ts` (+ `corte-base.ts`) · `disco-vuelve.ts` (el disco que vuelve con la app abierta) · `vaciar.ts` · `vaciar-app.ts` · `papelera-app.ts` · `etiquetas.ts`.
- Mediciones (con el aviso de `turnos.mjs`): `escala.ts` (100.000 temas sintéticos) · `intensidad.ts` (modos) · `arranque.ts` (cuánto tarda en abrir) · `medir-muestra.ts` (qué tan certera es la muestra de NAPIA con temas reales, solo lectura).

## `docs/capturas/`
Capturas públicas para el README (`<pantalla>.es` y `.en`, PNG o JPG si pesa mucho), sacadas con `scripts/demo.ts` y `npm run captura`; solo biblioteca inventada, nada de nadie.

## `tests/` (vitest)
Un archivo por módulo de `packages/core/`, con audio sintético hecho con ffmpeg (**nunca tocar la biblioteca real**). `estilo.test.ts` = reglas de estilo.
`real-library.test.ts` lee la biblioteca real solo en lectura (`PAILA_LIBRARY`). `esperar-medicion.ts` frena los tests mientras otra sesión mide.
`engine-base.ts` arma a mano una biblioteca de Engine DJ (para `enginedj.test.ts` y `enginedb.test.ts`).
`errores-conocidos.test.ts` = errores de `docs/PENDIENTES.md` sin arreglar (`it.fails`/`it.todo`). `fixtures/` = archivos de prueba.

## `packages/diseno/` (`@paila/diseno`)
Diseño de la familia (Fase G): cada app importa `@paila/diseno/estilos.css` y elige acento con `data-app="paila|napia"`. Tono: `docs/GLOSARIO.md`.
- `tokens.css` · `componentes.css` · `estilos.css` · `base.css`: tokens (`--bg`, `--panel`… siguen como alias) · componentes · junta todo · base de NAPIA.
- `historieta.css` · `identidad.css` · `muestrario.css`: estilo historieta (`data-estilo`) · identidad del salto estético · solo del muestrario.
- `src/` (`index.ts` exporta todo): `Boton.tsx` · `Nota.tsx` · `Caja.tsx` · `Barra.tsx` · `Ventana.tsx` · `Info.tsx` (ⓘ) · `Rico.tsx` (frase traducida con **negrita** y {huecos}) ·
  `Pestanas.tsx` · `Campo.tsx` · `PantallaVacia.tsx` · `Cabecera.tsx` · `Graficos.tsx` · `Avance.tsx` · `Festejo.tsx` · `Icono.tsx`.
- `src/cabina.ts` · `src/estilo.ts`: modo cabina (alto contraste, `data-cabina`; Ctrl+Mayús+C) · estilo de la ventana (`useEstilo`).
- `src/Muestrario.tsx`: pantalla oculta de desarrollo con todos los componentes en todos sus estados (en PAILA: Ctrl+Mayús+M).

## `apps/napia/` — NAPIA (panel de control para sockseek)
- `electron/`: `main.ts` (ventana y datos propios; `NAPIA_USER_DATA`, `NAPIA_SOCKSEEK_FALSO`) · `ajustes.ts` (pedidos que no bajan nada) ·
  `ipc.ts` (la bajada: pedidos `napia:*`, tanda, puerto, router; `desdePaila`) · `enlace.ts` (lo que lee PAILA, cada 2 s) · `disco.ts` (Un disco) · `correr.ts` (correr sockseek y la vuelta de otra fuente) ·
  `calidad.ts` (la revisión de calidad en un proceso aparte con prioridad baja: `out/main/calidad-worker.js`) · `preload.ts` (`window.napia`).
- `ui/src/`: `App.tsx` · `main.tsx` · `Preparar.tsx` · `Entrada.tsx` · `Opciones.tsx` · `Bajada.tsx` · `Historial.tsx` · `Reintentar.tsx` ·
  `UnDisco.tsx` (Un disco: artista, disco y la edición) · `Puerto.tsx` · `Calidad.tsx` (la calidad real: cada tema y el resumen, con su ⓘ) · `Firewall.tsx` (el permiso de Windows: arriba si está mal, y en la guía de la conexión) · `textos.ts` · `napia.css`.
- `sockseek-freno/`: sockseek con freno (`freno.patch`, `armar.ps1`, `LEEME.md`); el `.exe` no va al repo, lo deja `npm run sockseek:freno`.
  Para Mac, `armar.sh osx-arm64|osx-x64 <salida>` (lo deja en `apps/napia/recursos/sockseek-mac/<arch>`; lo corre GitHub).
- `build/`: el dibujo original en `arte/` → `make-icon.cjs` arma figurita, ícono y logo.

## Instalador (`apps/paila/package.json`) y `.github/workflows/`
- Un solo instalador para las dos: `extraResources` lleva `apps/napia/out` a `resources/napia`, Beat This! a `resources/modelos` y mpv a `resources/mpv`.
- `build/instalador.nsh`: casilla de NAPIA y accesos directos (`/SIN-NAPIA` la saca). `dist` y `pack` nunca publican (`--publish never`).
- `check.yml`: en cada cambio a `main` o pull request: tipos, tests, armado y OSV-Scanner, en Windows.
- `version.yml` (solo a mano, con el repo público): en Windows baja mpv, Beat This! y arma el sockseek con freno, pone las claves de los secretos (`scripts/claves-ci.mjs`), arma en dos vueltas con firma (SignPath, `.signpath/artifact-configuration.xml`) y junta el código fuente GPL (`scripts/fuentes-gpl.mjs`); llama a `mac.yml` para los .dmg; con "publicar", un borrador en Releases con todo. Cómo lanzarlo: `docs/compartir.md`, sección 5.
- `mac.yml` (solo a mano o subiendo una rama `mac/<algo>`; nunca solo con los cambios a `main`): tipos, tests y los dos .dmg sin firma de
  Apple, en una Mac de GitHub; abre la app armada y le saca una captura. Los minutos de Mac se pagan aparte: no corre en cada cambio
  (`[sin armar]` en el mensaje del commit: solo tipos y tests). El .dmg sale en LZMA (`hdiutil convert`, en `armar-mac.mjs`).
- `ISSUE_TEMPLATE/`: plantillas de issues (error, idea), en castellano e inglés.
- En el instalador, lo de Windows va en `build.win` (sockseek.exe, mpv.exe) y lo de Mac en `build.mac` (mpv.app y sockseek de cada procesador).

## En la raíz
- `README.md` · `AGENTS.md`: la página de GitHub y la guía para quien programe, en inglés; en castellano, `README.es.md` y `AGENTS.es.md` (se cambian juntas). `docs/NOVEDADES.md`: qué cambió en cada versión (la app muestra la de la instalada).
- `SECURITY.md` (cómo avisar una vulnerabilidad) · `CONTRIBUTING.md` (cómo sumar cambios), en los dos idiomas.

## Tablas de la base (resumen)
Las migraciones (`migrations*.ts`) son la fuente completa. Familias principales:
- Biblioteca: `volumes`, `roots`, `rules`, `files` (`trashed_at`, `missing_at`, `excluded_at`), `analysis` (`quality_v`), `silence`, `file_isrc`.
- Cambios y seguridad: `pending_changes`, `journal`, `op_journal` (diario en curso), `trash_log`, `moves_log`, `replacements` (`batch`), `improve_log`, `backups`, `backup_files` y `backup_state` (respaldo liviano, v40 y v43).
- Playlists y cabina: `playlists`, `playlist_items`, `rb_exports`, `rb_ids`, `dj_grid`, `dj_cues`, `dj_meta`.
- Internet: `online_cache` (también listas de temas y tapas de Discos), `mb_lookup`, `artist_dict`, `album_choice`, `junk_words`.
- Listas y Bandeja: `wishlist`, `wanted`, `inbox_items`, `inbox_ignored`, `requests`, `request_items`, `list_imports`, `request_import`.
- Sets: `set_prints`, `set_tracklists`, `long_prints`. ZIP y RAR: `archives`, `archive_entries`, `archive_extracted`. Estilo y energía: `sound_style`, `energy_marks` (v36). Separar voz: `stems_made`, `stems_wait` (v46). Ajustes: `settings` (también las claves, cifradas).

## Reglas que el código hace cumplir
Nada se borra de verdad (papelera y `_PAILA`) · todo cambio en archivos pasa por vista previa y se puede deshacer ·
los sample packs (`kind = 'produccion'`) nunca se renombran, mueven ni reemplazan · mover o escribir archivos exige pausar el análisis ·
las rutas relativas se guardan con `/`.

## Escala (medido con 100.000 temas, `docs/archivo/pruebas/2026-10-escala.md` y `docs/pruebas/2026-10-23-escala.md`)
- Desde 20.000 temas la tabla se filtra, ordena y pagina en un hilo del proceso principal: la interfaz recibe solo los ids y filas a la vista.
- El resumen de Análisis usa los índices de la migración v18 y una sola pasada de conteos; esa pasada y los conteos de pendientes (huellas, calidad, silencios, pasada precisa) leen el índice "resumen" de la v41 (`ANALYSIS_COUNT`, con `INDEXED BY`).
- Las filas de `node:sqlite` son objetos lentos para JavaScript: las consultas grandes que se recorren mucho usan `allRows` (db.ts). La caché de internet se consulta solo por claves guardadas (`OnlineCache.known`).
- Todo el texto de la interfaz está en castellano dentro de los componentes; para traducir (Fase 9) habrá que extraerlo a un diccionario.
