// Migraciones desde la v29 (siguen la lista de core/migrations.ts, que llegó al tope de largo): una por versión, en orden.
// Solo se agregan al final. No dependen del orden de otras migraciones salvo que lo digan (se pueden renumerar al unir).

export const MIGRATIONS_2: string[] = [
  // v29: fusionar y limpiar playlists, para el Historial y deshacer (data = lo necesario para volver atrás)
  `CREATE TABLE IF NOT EXISTS playlist_ops (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, undone_at TEXT);`,
  // v30: calidad que decide sola con pistas (22/10/2026, QUALITY_VERSION 3 en core/reanalysis.ts). Solo cambian los archivos
  // sin pérdida, los que tenían corte suave y los dañados (ahora dicen "Dañado" en la etiqueta): el resto (MP3, AAC, OGG…
  // medidos con la v2) ya tiene la nota de la v3 y no hace falta volver a leerlos. Solo datos de análisis. No depende del
  // orden de otras migraciones.
  `
  UPDATE analysis SET quality_v = 3 WHERE quality_v = 2 AND (',' || COALESCE(flags, '') || ',') NOT LIKE '%,soft_cutoff,%'
    AND (',' || COALESCE(flags, '') || ',') NOT LIKE '%,damaged,%'
    AND file_id IN (SELECT id FROM files WHERE NOT (COALESCE(codec, '') IN ('flac', 'alac', 'ape', 'wavpack', 'tta', 'wmalossless')
      OR COALESCE(codec, '') LIKE 'pcm_%' OR (codec IS NULL AND ext IN ('wav', 'aif', 'aiff', 'flac'))));
  `,
  // v31: los que no son MP3 y quedaron "Dañado" se vuelven a medir: un tag viejo de MP3 (ID3v1) pegado al final daba un error
  // falso al terminar (4 FLAC de la Música; core/analysis/analyze.ts, countDecodeErrors; 22/10/2026). Solo datos de análisis
  // (6 FLAC en la base de esta PC). No depende del orden de otras migraciones.
  `
  UPDATE analysis SET quality_v = 2 WHERE quality_v >= 2 AND (',' || COALESCE(flags, '') || ',') LIKE '%,damaged,%'
    AND file_id IN (SELECT id FROM files WHERE ext <> 'mp3' AND COALESCE(codec, '') <> 'mp3');
  `,
  // v32: playlists traídas de Rekordbox (rekordbox.xml) o de un pendrive de CDJ, de a tanda (core/listimport.ts): cada playlist
  // es un pedido de "Traer una lista" con su tanda (`request_import.import_id`), para deshacerlas juntas; `low_to_wanted`: si los
  // de mala calidad también van a la lista «Faltan o suenan mal» (sin fila, sí, como siempre). `dj`: lo de cabina recuperado del pendrive
  // (para deshacerlo). Tabla aparte y no columnas nuevas: se puede volver a correr. No depende del orden de otras migraciones.
  `CREATE TABLE IF NOT EXISTS list_imports (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, label TEXT NOT NULL, origin TEXT NOT NULL, folder_id INTEGER, dj TEXT, created_at TEXT NOT NULL, undone_at TEXT);
  CREATE TABLE IF NOT EXISTS request_import (request_id INTEGER PRIMARY KEY REFERENCES requests(id) ON DELETE CASCADE, import_id INTEGER, low_to_wanted INTEGER NOT NULL DEFAULT 1);
  CREATE INDEX IF NOT EXISTS request_import_by ON request_import (import_id);`,
  // v33: silencios largos al principio y al final (masterplan 3, punto 3; core/analysis/silence.ts): segundos de cada lado y la
  // versión de la medición (sin fila, la pasada liviana de core/silencepass.ts los mide). Tabla aparte y no columnas nuevas: se
  // puede volver a correr. No depende del orden de otras migraciones.
  `CREATE TABLE IF NOT EXISTS silence (file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE, silence_start REAL, silence_end REAL, silence_v INTEGER NOT NULL);`,
  // v34: tracklist automático de sets (MASTERPLAN-3, punto 5). set_prints = la huella entera de un set (los temas guardan
  // solo 120 s; un set de una hora son ~100 KB), con el tamaño y la fecha del archivo para saber si sigue valiendo.
  // set_tracklists = el último tracklist armado (JSON con lo que se corrigió a mano). long_prints = la huella entera de
  // los temas de la carpeta de un set (para reconocerlos aunque el DJ los haya puesto desde la mitad; ~10 KB por tema).
  // Solo datos de PAILA: no toca archivos. No depende del orden de otras migraciones.
  `
  CREATE TABLE IF NOT EXISTS set_prints (file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE, src_size INTEGER NOT NULL,
    src_mtime REAL NOT NULL, seconds REAL NOT NULL, chromaprint TEXT NOT NULL, made_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS set_tracklists (file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE, made_at TEXT NOT NULL,
    entries TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS long_prints (file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE, src_size INTEGER NOT NULL,
    src_mtime REAL NOT NULL, chromaprint TEXT NOT NULL, made_at TEXT NOT NULL);
  `,
  // v35: ZIP y RAR de la biblioteca (MASTERPLAN-3, punto 4; core/archives.ts). archives = cada comprimido que encontró el escaneo
  // (con el tamaño y la fecha: si cambian, se vuelve a listar; `missing_at` si ya no está). archive_entries = lo que hay adentro
  // (`idx` = su lugar en el comprimido) y lo leído de cada tema al analizarlo. archive_extracted = lo que se sacó a una carpeta
  // al lado, de a tanda, para el Historial y deshacer. Solo datos de PAILA: no toca archivos. No depende del orden de otras
  // migraciones.
  `
  CREATE TABLE IF NOT EXISTS archives (id INTEGER PRIMARY KEY, root_id INTEGER NOT NULL, rel_path TEXT NOT NULL, size INTEGER NOT NULL,
    mtime REAL NOT NULL, format TEXT NOT NULL, kind TEXT NOT NULL, sample_pack INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, note TEXT,
    volumes INTEGER NOT NULL DEFAULT 1, solid INTEGER NOT NULL DEFAULT 0, listed_at TEXT NOT NULL, missing_at TEXT, UNIQUE (root_id, rel_path));
  CREATE TABLE IF NOT EXISTS archive_entries (id INTEGER PRIMARY KEY, archive_id INTEGER NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL, audio INTEGER NOT NULL, companion INTEGER NOT NULL, blocked TEXT,
    codec TEXT, sample_rate INTEGER, bits INTEGER, channels INTEGER, kbps INTEGER, duration REAL, artist TEXT, title TEXT, album TEXT,
    track TEXT, year TEXT, genre TEXT, grade TEXT, grade_is TEXT, grade_why TEXT, bpm REAL, musical_key TEXT, read_at TEXT, error TEXT);
  CREATE INDEX IF NOT EXISTS archive_entries_by ON archive_entries (archive_id, idx);
  CREATE TABLE IF NOT EXISTS archive_extracted (id INTEGER PRIMARY KEY, batch INTEGER NOT NULL, archive_id INTEGER, archive_rel TEXT NOT NULL,
    root_id INTEGER NOT NULL, rel TEXT NOT NULL, size INTEGER NOT NULL, mtime REAL NOT NULL, at TEXT NOT NULL, undone_at TEXT, trash_rel TEXT);
  CREATE INDEX IF NOT EXISTS archive_extracted_by ON archive_extracted (batch);
  `,
  // v36: estilo por el sonido y energía a tu oído (MASTERPLAN-3, punto 3). sound_style = lo que oyó Discogs-EffNet (se baja
  // aparte; core/stylepass.ts): los 10 estilos más probables y lo que oye para la energía, con la versión de la escucha.
  // energy_marks = la energía que marcó la persona en un tema (core/energiamarcas.ts), para calibrar la de todos. Solo datos
  // de PAILA: no toca archivos. Tablas aparte: se puede volver a correr. No depende del orden de otras migraciones.
  `
  CREATE TABLE IF NOT EXISTS sound_style (file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE, styles TEXT, moods TEXT,
    style_v INTEGER NOT NULL, made_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS energy_marks (file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE, value INTEGER NOT NULL,
    marked_at TEXT NOT NULL);
  `,
  // v37: comprimidos mandados a la papelera de PAILA cuando todo lo de adentro ya estaba afuera (decisión del 23/10;
  // core/archive/papelera.ts). Una fila por archivo (un rar partido son varias), de a tanda, para el Historial y restaurar.
  // `trash_rel` = dónde quedó en _PAILA/papelera; `restored_at` si volvió; `purged_at` si se vació la papelera. Tabla aparte:
  // se puede volver a correr. No depende del orden de otras migraciones.
  `
  CREATE TABLE IF NOT EXISTS archive_trashed (id INTEGER PRIMARY KEY, batch INTEGER NOT NULL, archive_id INTEGER, root_id INTEGER NOT NULL,
    rel TEXT NOT NULL, size INTEGER NOT NULL, mtime REAL NOT NULL, trash_rel TEXT NOT NULL, at TEXT NOT NULL, restored_at TEXT, purged_at TEXT);
  CREATE INDEX IF NOT EXISTS archive_trashed_by ON archive_trashed (batch);
  `,
  // v38: restos arriba del corte (comparación con Fakin' The Funk, 23/10/2026; QUALITY_VERSION 4 en core/reanalysis.ts). Los
  // archivos sin pérdida se vuelven a medir todos (el corte ahora se busca también en lo que suena la mayor parte del tiempo,
  // que no estaba guardado; y los de corte de golpe en 20 kHz reciben su sello: cut20_trusted o cut20_mp3like, decisión del 23/10). De los con pérdida, solo los que en el espectro guardado (128 franjas de ~172 Hz) tienen un
  // escalón de 20 dB o más por debajo del corte: el resto queda al día sin volver a leerlo. Solo datos de análisis. No depende
  // del orden de otras migraciones.
  `
  UPDATE analysis SET quality_v = 4 WHERE quality_v = 3
    AND file_id IN (SELECT id FROM files WHERE NOT (COALESCE(codec, '') IN ('flac', 'alac', 'ape', 'wavpack', 'tta', 'wmalossless')
      OR COALESCE(codec, '') LIKE 'pcm_%' OR (codec IS NULL AND ext IN ('wav', 'aif', 'aiff', 'flac'))))
    AND NOT (cutoff IS NOT NULL AND json_valid(spectrum) AND json_array_length(spectrum) = 128 AND EXISTS (
      SELECT 1 FROM json_each(analysis.spectrum) j WHERE j.key BETWEEN 70 AND analysis.cutoff / 172.265625 - 8
        AND (json_extract(analysis.spectrum, '$[' || (j.key - 2) || ']') + json_extract(analysis.spectrum, '$[' || (j.key - 1) || ']'))
          - (json_extract(analysis.spectrum, '$[' || (j.key + 1) || ']') + json_extract(analysis.spectrum, '$[' || (j.key + 2) || ']')) >= 40));
  `,
  // v39: lo que PAILA copió o escribió afuera de tu Música (motor único, masterplan 4, 4B.4; core/ops/copy.ts): el pendrive,
  // el celular, los archivos de Traktor, Serato, VirtualDJ y Rekordbox, y las listas .m3u8. Una fila por archivo, de a tanda,
  // para el Historial. `backup` = dónde quedó lo que había antes (si se reemplazó un archivo de otro programa). Tabla aparte:
  // se puede volver a correr. No depende del orden de otras migraciones.
  `
  CREATE TABLE IF NOT EXISTS copies_log (id INTEGER PRIMARY KEY, batch INTEGER NOT NULL, kind TEXT NOT NULL, dest TEXT NOT NULL,
    file_id INTEGER, src TEXT, dst TEXT NOT NULL, size INTEGER NOT NULL, backup TEXT, at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS copies_log_by ON copies_log (batch);
  `,
  // v40: respaldo de archivos por paso (motor único; masterplan 3, punto 1.1; core/ops/backup.ts): antes de una tanda que
  // cambia lo de adentro de archivos de tu Música, una copia verificada de cada uno en una carpeta de respaldos. Una fila por
  // disco y tanda: `ref` = la tanda del Historial (journal.batch_id para tags), `complete` = 0 si se cortó mientras copiaba,
  // `deleted_at` si la persona lo borró desde la app (nunca se borran solos). Tabla aparte: se puede volver a correr.
  `
  CREATE TABLE IF NOT EXISTS backups (id INTEGER PRIMARY KEY, op TEXT NOT NULL, ref INTEGER, root_id INTEGER, dir TEXT NOT NULL,
    files INTEGER NOT NULL, bytes INTEGER NOT NULL, created_at TEXT NOT NULL, complete INTEGER NOT NULL DEFAULT 0, deleted_at TEXT);
  `,
  // v41: índice "resumen" del análisis (escala del 23/10/2026): solo las columnas que cuentan el Resumen de Análisis (cada 4 s)
  // y los pendientes de huellas, calidad, silencios y pasada precisa (ANALYSIS_COUNT en core/queue.ts, que lo pide con INDEXED BY).
  // Cada fila del análisis guarda la huella (~3,5 KB) y recorrer la tabla leía casi una página por tema: con 100.000 temas y
  // huellas, el resumen bajó de ~630 a ~130 ms. Solo un índice: no toca datos. No depende del orden de otras migraciones.
  `
  CREATE INDEX IF NOT EXISTS analysis_resumen ON analysis (file_id, version, analyzed_at, prints_at, error, src_size, src_mtime, grade,
    quality_v, dj_v, bpm, precise_v);
  `,
  // v42: los textos de la nota de calidad también en el otro idioma (pendiente del inglés, 24/10/2026): `textos` = JSON con el
  // idioma (i) y lo que dice ser, lo que es, el porqué y el sonido. Al cambiar de idioma se intercambian con las columnas de siempre
  // (core/textosidioma.ts). Los analizados antes no tienen fila y se traduce lo que se pueda. Tablas aparte y no columnas: así se
  // puede volver a correr (los tests repiten migraciones). No depende del orden de otras migraciones.
  `
  CREATE TABLE IF NOT EXISTS analysis_otro (file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE, textos TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS archive_otro (entry_id INTEGER PRIMARY KEY REFERENCES archive_entries(id) ON DELETE CASCADE, textos TEXT NOT NULL);
  `,
  // v43: respaldo liviano (24/10, decisión del autor: las copias enteras ocupaban 40 GB en una tanda de tags). Cada archivo
  // guarda solo lo que cambia (core/ops/delta.ts): una fila por archivo con dónde quedó (`path`, relativo a la carpeta del
  // respaldo: el cambios.paila de la tanda, y `pos`, dónde empieza adentro; o el cover.jpg copiado), qué es (`kind`: 'cambio' = los pedazos de antes, 'entero' = el archivo de antes entero porque cambiaba casi todo,
  // 'copia' = un cover.jpg copiado tal cual) y las huellas de antes y de después (para deshacer byte a byte solo si el archivo
  // sigue como lo dejó PAILA). `backup_state`, una fila por respaldo nuevo: `kind` 'liviano' (un respaldo sin fila acá es de
  // copias enteras, como los hacía la 0.5.3; siguen sirviendo para deshacer) y `trash_dir` = dónde quedó en la papelera de PAILA
  // si la persona lo "borró" (se recupera de ahí hasta vaciarla; core/ops/backup-trash.ts). Tablas aparte (sin ALTER): se puede
  // volver a correr.
  `
  CREATE TABLE IF NOT EXISTS backup_files (id INTEGER PRIMARY KEY, backup_id INTEGER NOT NULL, file_id INTEGER, rel TEXT NOT NULL,
    path TEXT NOT NULL, pos INTEGER, kind TEXT NOT NULL, old_size INTEGER NOT NULL, old_sha1 TEXT NOT NULL, new_size INTEGER, new_sha1 TEXT,
    bytes INTEGER NOT NULL, at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS backup_files_by ON backup_files (backup_id, file_id);
  CREATE TABLE IF NOT EXISTS backup_state (backup_id INTEGER PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'liviano', trash_dir TEXT);
  `,
  // v44: "Dañado" cuenta tropiezos del decodificador y no palabras de error, ni las de los tags (repaso de criterios del 24/10;
  // QUALITY_VERSION 5 en core/reanalysis.ts), y los huecos se miden con dónde están. Solo los que hoy dicen "Dañado" se vuelven a
  // leer (109 en la Música del autor: 11 dejan de serlo); en los otros la cuenta nueva no da más (0 de 60 en una muestra).
  // Solo datos de análisis: se puede volver a correr. No depende del orden de otras migraciones (se puede renumerar al unir).
  `
  UPDATE analysis SET quality_v = 5 WHERE quality_v = 4 AND (',' || COALESCE(flags, '') || ',') NOT LIKE '%,damaged,%';
  `,
  // v45: el BPM y el tono escritos en el tag de cada tema (core/djtag.ts), tal cual están (null = no tiene), leídos mientras el
  // archivo no cambie (tamaño y fecha). Los usa el paso de Arreglar nombres que borra los que seguro están mal (pedido del
  // 24/10). Tabla aparte: se puede volver a correr. No depende del orden de otras migraciones (se puede renumerar al unir).
  `CREATE TABLE IF NOT EXISTS file_djtag (file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE, size INTEGER NOT NULL,
    mtime REAL NOT NULL, bpm TEXT, music_key TEXT);`,
  // v46: se relee la calidad de toda la Música con el motor 5 (el autor, 24/10: "que relea los 4.700 de fondo"), para que los temas
  // con 1 a 3 cortes queden marcados. La v44 dejó al día sin leerlos a los que no decían "Dañado": vuelven al motor 4 y la
  // relectura los toma de fondo (core/reanalysis.ts; si se corta, retoma sola). Los que la 0.5.4 ya releyó no se repiten: siguen
  // "Dañado" o tienen cortes ("gaps", que solo pone el motor 5). Los pocos que releyó y quedaron limpios (11 en la Música de
  // El autor) se releen otra vez: no hay cómo distinguirlos y es un minuto. Solo datos de análisis: se puede volver a correr.
  // No depende del orden de otras migraciones (se puede renumerar al unir).
  `
  UPDATE analysis SET quality_v = 4 WHERE quality_v = 5 AND (',' || COALESCE(flags, '') || ',') NOT LIKE '%,damaged,%'
    AND (',' || COALESCE(flags, '') || ',') NOT LIKE '%,gaps,%';
  `,
  // v47 (va después de la v46, la relectura de calidad; el autor, 24/10): Separar voz (masterplan 4, 4B.6; core/stems/separar.ts):
  // la acapella y el instrumental que PAILA sacó de un tema, una fila por archivo y una tanda por tema, para el Historial y
  // deshacer a la papelera; y los temas que esperan una versión mejor antes de separarse ("Buscar uno mejor"). Tablas aparte: se puede volver a correr. No depende del orden de otras migraciones.
  `
  CREATE TABLE IF NOT EXISTS stems_made (id INTEGER PRIMARY KEY, batch INTEGER NOT NULL, source_id INTEGER, source_rel TEXT NOT NULL, part TEXT NOT NULL,
    root_id INTEGER NOT NULL, rel TEXT NOT NULL, size INTEGER NOT NULL, mtime INTEGER NOT NULL, model TEXT NOT NULL, at TEXT NOT NULL, undone_at TEXT, trash_rel TEXT);
  CREATE INDEX IF NOT EXISTS stems_made_batch ON stems_made (batch);
  CREATE TABLE IF NOT EXISTS stems_wait (file_id INTEGER PRIMARY KEY, grade TEXT, at TEXT NOT NULL);
  `,
  // v48: las carpetas vacías que se sacaron desde Espacio (core/emptydirs.ts; punto 1 real del 24/10: después de Organizar quedaron
  // 103), una fila por carpeta y una tanda por vez, para el Historial y para volver a crearlas al deshacer. Tabla aparte: se puede
  // volver a correr. No depende del orden de otras migraciones (se puede renumerar al unir).
  `
  CREATE TABLE IF NOT EXISTS empty_dirs_log (id INTEGER PRIMARY KEY, batch INTEGER NOT NULL, root_id INTEGER NOT NULL, rel TEXT NOT NULL,
    at TEXT NOT NULL, restored_at TEXT);
  CREATE INDEX IF NOT EXISTS empty_dirs_log_batch ON empty_dirs_log (batch);
  `,
  // v49: las carpetas vacías que tenían el atributo de "solo lectura" de Windows (las que tuvieron ícono propio, con desktop.ini):
  // se les saca para poder sacarlas (en un disco exFAT, si no, rmdir da EPERM: punto 1 real del 24/10) y se les vuelve a poner al
  // deshacer (core/emptydirs.ts). Tabla aparte (sin ALTER): se puede volver a correr. No depende del orden de otras migraciones.
  `CREATE TABLE IF NOT EXISTS empty_dirs_readonly (log_id INTEGER PRIMARY KEY);`,
  // v50: Duplicados y lo traído de Rekordbox (core/trash-dj.ts; punto 1 real del 24/10): lo que tenía la copia que queda antes de
  // heredar la estrella más alta y la suma de veces tocado del duplicado que fue a la papelera, para devolvérselo al restaurarlo.
  // Tabla aparte: se puede volver a correr. No depende del orden de otras migraciones.
  `CREATE TABLE IF NOT EXISTS trash_dj (log_id INTEGER PRIMARY KEY, kept_id INTEGER NOT NULL, had INTEGER NOT NULL, stars_before INTEGER NOT NULL,
    plays_before INTEGER, stars_after INTEGER NOT NULL, plays_after INTEGER);`,
  // v51: "Los dos" en Traer una lista (uso real del 24/10): la versión pedida, cuando tenés otra, es un tema más del pedido (falta →
  // Faltan o suenan mal) enganchado al tuyo (`of_item`); cuando llega, entra a la playlist al lado. Tabla aparte (sin ALTER): se
  // puede volver a correr. No depende del orden de otras migraciones (se puede renumerar al unir).
  `CREATE TABLE IF NOT EXISTS request_versions (item_id INTEGER PRIMARY KEY REFERENCES request_items(id) ON DELETE CASCADE,
    of_item INTEGER NOT NULL REFERENCES request_items(id) ON DELETE CASCADE);`,
  // v52: al reemplazar un tema por otra versión (Bandeja, Reemplazar), la grilla y los cues del archivo viejo ya no valen (uso real del
  // 24/10): se sacan (core/replace.ts) y se guardan acá, para devolverlos si se deshace el reemplazo. Tabla aparte: se puede volver a
  // correr. No depende del orden de otras migraciones (se puede renumerar al unir).
  `CREATE TABLE IF NOT EXISTS replace_dj (replacement_id INTEGER PRIMARY KEY, data TEXT NOT NULL);`,
  // v53: choques entre herramientas (repaso del 27/10, C4 y orden de confianza; core/changes.ts y core/confianza.ts). De cada
  // cambio pendiente, quién lo propuso y por qué falló la última vez que se aplicó (se muestra aparte, con "Sacarlos"); de lo
  // aplicado, quién lo puso; y lo que una herramienta quiso cambiar sobre un dato que puso otra de más confianza, "para mirar a
  // mano". Tablas aparte (sin ALTER): se puede volver a correr. No depende del orden de otras migraciones (se puede renumerar al unir).
  `
  CREATE TABLE IF NOT EXISTS pending_meta (file_id INTEGER NOT NULL, field TEXT NOT NULL, source TEXT, error TEXT, error_at TEXT, PRIMARY KEY (file_id, field));
  CREATE TABLE IF NOT EXISTS journal_source (journal_id INTEGER PRIMARY KEY, source TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS held_changes (file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE, field TEXT NOT NULL, value TEXT,
    source TEXT NOT NULL, over TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (file_id, field, source));
  `,
  // v54: un tema en la papelera queda anotado donde está de verdad (_PAILA/papelera/…), no en su lugar de antes: ese lugar quedaba
  // "ocupado" para siempre y Organizar movía la copia nueva ahí pero la base la rechazaba (UNIQUE root_id, rel_path; 11 temas el
  // 01/11), y el escaneo podía esconder la copia nueva como si fuera la de la papelera. El lugar de antes sigue en trash_log
  // (orig_rel) y al restaurar se vuelve a poner (core/trash.ts). Se puede volver a correr; no depende del orden de otras.
  `
  UPDATE files SET rel_path = (SELECT t.trash_rel FROM trash_log t WHERE t.file_id = files.id AND t.restored_at IS NULL ORDER BY t.id DESC LIMIT 1)
  WHERE trashed_at IS NOT NULL
    AND EXISTS (SELECT 1 FROM trash_log t WHERE t.file_id = files.id AND t.restored_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM files o WHERE o.root_id = files.root_id AND o.id != files.id
      AND o.rel_path = (SELECT t.trash_rel FROM trash_log t WHERE t.file_id = files.id AND t.restored_at IS NULL ORDER BY t.id DESC LIMIT 1));
  `,
  // v55: "Dejar como está" por tema (MASTERPLAN-5, 3.1; core/estado.ts): lo que la persona decide no tocar en una parte (repetidos,
  // internet, nombres, tapas, carpetas, sonido) deja de contar en el estado de la colección y no vuelve a aparecer. Vive en la base, así
  // que viaja con "Pasar a otra compu". Tabla aparte: se puede volver a correr. No depende del orden de otras migraciones.
  `CREATE TABLE IF NOT EXISTS dejar_como_esta (file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE, grupo TEXT NOT NULL, at TEXT NOT NULL,
    PRIMARY KEY (file_id, grupo));`,
  // v56: las propuestas guardadas y un solo Aplicar (MASTERPLAN-5, etapa 2; core/propuestas.ts y core/aplicar.ts). Lo que va a la
  // papelera y lo que se mueve queda en `propuestas`, con la versión del archivo que se miró (tamaño y fecha); la de cada cambio de
  // tags, en `pending_base`; lo que encontró una búsqueda larga (repetidos, tapas), en `resultados`; y cada Aplicar, en `tandas` con
  // sus partes. Tablas aparte (sin ALTER): se puede volver a correr. No depende del orden de otras migraciones.
  `
  CREATE TABLE IF NOT EXISTS propuestas (id INTEGER PRIMARY KEY, tipo TEXT NOT NULL, file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    antes TEXT NOT NULL, despues TEXT, dato TEXT, size INTEGER, mtime REAL, error TEXT, creada TEXT NOT NULL, UNIQUE (file_id, tipo));
  CREATE TABLE IF NOT EXISTS pending_base (file_id INTEGER NOT NULL, field TEXT NOT NULL, size INTEGER, mtime REAL, PRIMARY KEY (file_id, field));
  CREATE TABLE IF NOT EXISTS resultados (clave TEXT PRIMARY KEY, datos TEXT NOT NULL, at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS tandas (id INTEGER PRIMARY KEY, at TEXT NOT NULL, partes TEXT NOT NULL);
  `,
  // v57: lo que destildaste en Ordenar (MASTERPLAN-5, etapa 3; core/revision-apagados.ts). Sigue en la lista, a la vista y sin
  // tildar: Aplicar lo saltea y la carpeta de cada tema se calcula sin eso. La clave es "c|tema|campo" (un cambio de tags) o
  // "p|tema|tipo" (papelera o mover). Tabla aparte: se puede volver a correr. No depende del orden de otras migraciones.
  `CREATE TABLE IF NOT EXISTS revision_apagados (clave TEXT PRIMARY KEY, at TEXT NOT NULL);`,
  // v58: lo que creó cada tanda (MASTERPLAN-5, etapa 4; core/restos.ts): las carpetas nuevas que hizo Organizar, para sacarlas al
  // deshacer si quedan vacías (y nunca otras). `rel` '' es la marca de "esta tanda ya se anotaba": sin ella, una tanda vieja.
  // Tabla aparte: se puede volver a correr. No depende del orden de otras migraciones.
  `CREATE TABLE IF NOT EXISTS creados (tipo TEXT NOT NULL, batch INTEGER NOT NULL, root_id INTEGER NOT NULL, rel TEXT NOT NULL, at TEXT NOT NULL,
    sacada_at TEXT, PRIMARY KEY (tipo, batch, root_id, rel));`,
  // v59: la fecha de cada archivo antes de que Cambios pendientes lo escriba (decisión del autor del 13/11; core/fechas.ts): `despues`
  // es la que le quedó (en milisegundos, como files.mtime) y `antes` la de antes, exacta (nanosegundos, en texto). Deshacer la devuelve.
  // Tabla aparte: se puede volver a correr. No depende del orden de otras migraciones.
  `CREATE TABLE IF NOT EXISTS fechas (file_id INTEGER NOT NULL, despues REAL NOT NULL, antes TEXT NOT NULL, PRIMARY KEY (file_id, despues));`,
]
