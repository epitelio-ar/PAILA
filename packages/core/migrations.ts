// Migraciones de la base: una por versión, en orden (la posición en la lista = el número de versión). Solo se agregan al final: las nuevas, en core/migrations-2.ts.
import { MIGRATIONS_2 } from './migrations-2'
export const MIGRATIONS: string[] = [
  // v1
  `
  CREATE TABLE volumes (
    id INTEGER PRIMARY KEY,
    serial TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL DEFAULT '',
    last_mount TEXT NOT NULL
  );
  CREATE TABLE roots (
    id INTEGER PRIMARY KEY,
    volume_id INTEGER NOT NULL REFERENCES volumes(id),
    rel_path TEXT NOT NULL,
    added_at TEXT NOT NULL,
    UNIQUE (volume_id, rel_path)
  );
  CREATE TABLE rules (
    root_id INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
    rel_prefix TEXT NOT NULL,
    kind TEXT NOT NULL,
    PRIMARY KEY (root_id, rel_prefix)
  );
  CREATE TABLE files (
    id INTEGER PRIMARY KEY,
    root_id INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
    rel_path TEXT NOT NULL,
    size INTEGER NOT NULL,
    mtime REAL NOT NULL,
    kind TEXT NOT NULL,
    ext TEXT NOT NULL,
    codec TEXT, sample_rate INTEGER, bits INTEGER, channels INTEGER, kbps INTEGER, duration REAL,
    artist TEXT, album_artist TEXT, title TEXT, album TEXT, track TEXT, year TEXT, genre TEXT,
    error TEXT,
    probed_at TEXT,
    UNIQUE (root_id, rel_path)
  );
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
  // v2: análisis de calidad, sonido y DJ
  `
  CREATE TABLE analysis (
    file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    src_size INTEGER NOT NULL,
    src_mtime REAL NOT NULL,
    analyzed_at TEXT NOT NULL,
    grade TEXT, says TEXT, is_label TEXT, why TEXT, confidence TEXT, flags TEXT, eff_kbps INTEGER, sound TEXT,
    cutoff INTEGER, cutoff_drop INTEGER, lufs REAL, lra REAL, true_peak REAL, sample_peak REAL, clip_events INTEGER,
    stereo_corr REAL, eff_bits INTEGER, encoder TEXT, vbr_method TEXT, lame_lowpass INTEGER,
    bpm REAL, bpm_source TEXT, music_key TEXT, camelot TEXT, key_strength REAL, energy INTEGER, danceability REAL,
    spectrum TEXT, ms INTEGER, error TEXT
  );
  `,
  // v3: BPM rápido guardado aparte cuando llega el preciso (para avisar si no coinciden)
  `
  ALTER TABLE analysis ADD COLUMN bpm_fast REAL;
  CREATE INDEX analysis_pending_bpm ON analysis (bpm_source);
  `,
  // v4: cambios pendientes y diario (para deshacer)
  `
  CREATE TABLE pending_changes (
    id INTEGER PRIMARY KEY,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    field TEXT NOT NULL,
    before TEXT,
    after TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (file_id, field)
  );
  CREATE TABLE journal (
    id INTEGER PRIMARY KEY,
    batch_id INTEGER NOT NULL,
    file_id INTEGER NOT NULL,
    rel_path TEXT NOT NULL,
    field TEXT NOT NULL,
    before TEXT,
    after TEXT,
    applied_at TEXT NOT NULL,
    undone_at TEXT
  );
  CREATE INDEX journal_batch ON journal (batch_id);
  `,
  // v5: playlists virtuales (comunes, carpetas e inteligentes)
  `
  CREATE TABLE playlists (
    id INTEGER PRIMARY KEY,
    parent_id INTEGER REFERENCES playlists(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    rules TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE playlist_items (
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    PRIMARY KEY (playlist_id, file_id)
  );
  CREATE INDEX playlist_items_file ON playlist_items (file_id);
  `,
  // v6: papelera propia (el archivo se mueve a _PAILA/papelera y la fila queda marcada, así se puede restaurar)
  `
  ALTER TABLE files ADD COLUMN trashed_at TEXT;
  CREATE TABLE trash_log (
    id INTEGER PRIMARY KEY,
    batch_id INTEGER NOT NULL,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    orig_rel TEXT NOT NULL,
    trash_rel TEXT NOT NULL,
    reason TEXT,
    kept_id INTEGER,
    moves TEXT,
    created_at TEXT NOT NULL,
    restored_at TEXT
  );
  CREATE INDEX trash_log_batch ON trash_log (batch_id);
  `,
  // v7: movimientos del organizador de carpetas (para deshacer)
  `
  CREATE TABLE moves_log (
    id INTEGER PRIMARY KEY,
    batch_id INTEGER NOT NULL,
    root_id INTEGER NOT NULL,
    file_id INTEGER,
    from_rel TEXT NOT NULL,
    to_rel TEXT NOT NULL,
    created_at TEXT NOT NULL,
    undone_at TEXT
  );
  CREATE INDEX moves_log_batch ON moves_log (batch_id);
  `,
  // v8: reemplazos de temas (el viejo queda en la papelera y se puede volver atrás)
  `
  CREATE TABLE replacements (
    id INTEGER PRIMARY KEY,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    old_row TEXT NOT NULL,
    old_trash_rel TEXT NOT NULL,
    new_rel TEXT NOT NULL,
    created_at TEXT NOT NULL,
    undone_at TEXT
  );
  `,
  // v9: "Mejorar playlist" (cambios de versión dentro de una playlist, para deshacer)
  `
  CREATE TABLE improve_log (
    id INTEGER PRIMARY KEY,
    batch_id INTEGER NOT NULL,
    playlist_id INTEGER NOT NULL,
    old_file INTEGER NOT NULL,
    new_file INTEGER NOT NULL,
    position INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    undone_at TEXT
  );
  `,
  // v10: temas que ya se exportaron a Rekordbox (para avisar antes de moverlos o reemplazarlos)
  `
  CREATE TABLE rb_exports (
    file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
    exported_at TEXT NOT NULL
  );
  `,
  // v11: lista de deseos y bandeja (archivos ignorados)
  `
  CREATE TABLE wishlist (
    key TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  );
  CREATE TABLE inbox_ignored (
    path TEXT PRIMARY KEY,
    size INTEGER NOT NULL,
    mtime INTEGER NOT NULL
  );
  `,
  // v12: resultados de MusicBrainz (caché: no se vuelve a preguntar por el mismo tema)
  `
  CREATE TABLE mb_lookup (
    file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    result TEXT,
    looked_at TEXT NOT NULL
  );
  `,
  // v13: temas "desaparecidos" (el escaneo no los encontró). Nunca se borran: conservan playlists y análisis,
  // y se reconectan solos si vuelven a aparecer (en el mismo lugar o movidos).
  `
  ALTER TABLE files ADD COLUMN missing_at TEXT;
  `,
  // v14: sacar una carpeta de la biblioteca, o excluir una subcarpeta, ya no borra filas (se perdían playlists, análisis
  // e historial): la carpeta queda marcada y sus temas ocultos. Si se vuelve a agregar o a incluir, todo vuelve.
  `
  ALTER TABLE roots ADD COLUMN removed_at TEXT;
  ALTER TABLE files ADD COLUMN excluded_at TEXT;
  `,
  // v15: "Vaciar papelera" (lo único que borra de verdad). Lo que se borró queda anotado: ya no se puede restaurar ni deshacer.
  `
  ALTER TABLE trash_log ADD COLUMN purged_at TEXT;
  ALTER TABLE replacements ADD COLUMN purged_at TEXT;
  ALTER TABLE moves_log ADD COLUMN purged_at TEXT;
  `,
  // v16: diario de operaciones en curso (core/journal.ts). Antes de mover o escribir un archivo se anota qué se va a hacer;
  // al terminar, la fila se borra en la misma transacción que guarda el resultado. Si PAILA se corta en el medio (luz,
  // cuelgue, cierre forzado), al abrir encuentra la fila y lo termina o lo vuelve atrás (core/recovery.ts).
  `
  CREATE TABLE op_journal (
    id INTEGER PRIMARY KEY,
    op TEXT NOT NULL,
    phase TEXT NOT NULL DEFAULT 'inicio',
    root_id INTEGER,
    file_id INTEGER,
    src_rel TEXT,
    dst_rel TEXT,
    backup TEXT,
    orig_size INTEGER,
    hash TEXT,
    data TEXT,
    started_at TEXT NOT NULL,
    recovered_at TEXT,
    result TEXT,
    message TEXT,
    seen_at TEXT
  );
  `,
  // v17: las dos huellas de cada tema, sacadas de la misma lectura que el análisis. audio_md5 = huella del sonido (vale
  // mientras el archivo tenga audio_size y audio_mtime: guardar tags la usa como "antes" sin volver a decodificar);
  // chromaprint = huella acústica (AcoustID y duplicados por sonido). prints_at = cuándo se calcularon (o se intentó).
  `
  ALTER TABLE analysis ADD COLUMN audio_md5 TEXT;
  ALTER TABLE analysis ADD COLUMN audio_size INTEGER;
  ALTER TABLE analysis ADD COLUMN audio_mtime REAL;
  ALTER TABLE analysis ADD COLUMN chromaprint TEXT;
  ALTER TABLE analysis ADD COLUMN prints_at TEXT;
  CREATE INDEX analysis_audio_md5 ON analysis (audio_md5);
  `,
  // v18: índices para el resumen de la pantalla Análisis (core/insights.ts), que se pide cada 4 s: con 100.000 temas
  // tardaba ~1,1 s porque cada consulta recorría la tabla entera.
  `
  CREATE INDEX analysis_analyzed_at ON analysis (analyzed_at);
  CREATE INDEX analysis_bpm ON analysis (bpm);
  CREATE INDEX analysis_lufs ON analysis (lufs);
  CREATE INDEX analysis_grade ON analysis (grade);
  CREATE INDEX analysis_camelot ON analysis (camelot);
  CREATE INDEX analysis_flags ON analysis (flags) WHERE flags IS NOT NULL;
  `,
  // v19: la lista «Faltan o suenan mal» por tema (core/wanted.ts) y Bandeja vigilada (core/inboxflow.ts). wanted: un tema que
  // conviene conseguir (file_id) o que falta (file_id NULL; ref_file_id = el archivo que suena igual con otro título).
  // inbox_items: lo que la Bandeja ya revisó de cada archivo (mientras no cambie). replacements.batch: "Reemplazar todos"
  // es una sola tanda en el Historial. No depende del orden de otras migraciones (se puede renumerar al unir).
  `
  CREATE TABLE wanted (id INTEGER PRIMARY KEY, file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
    ref_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL, artist TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL,
    reason TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', arrived_path TEXT, replacement_id INTEGER, added_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE UNIQUE INDEX wanted_file ON wanted (file_id) WHERE file_id IS NOT NULL;
  CREATE TABLE inbox_items (path TEXT PRIMARY KEY, size INTEGER NOT NULL, mtime INTEGER NOT NULL, result TEXT NOT NULL, checked_at TEXT NOT NULL);
  ALTER TABLE replacements ADD COLUMN batch TEXT;
  `,
  // v20: nombres oficiales (Fase C). online_cache = lo que respondió cada fuente de internet a cada búsqueda (MusicBrainz,
  // Deezer, Discogs, AcoustID), para no volver a pedirlo; artist_dict = el diccionario de artistas propio (correcciones
  // del usuario, que se aplican solas después). key = el nombre "plegado" (sin mayúsculas ni acentos).
  `
  CREATE TABLE online_cache (source TEXT NOT NULL, query TEXT NOT NULL, status TEXT NOT NULL, data TEXT, looked_at TEXT NOT NULL,
    PRIMARY KEY (source, query));
  CREATE TABLE artist_dict (key TEXT PRIMARY KEY, from_name TEXT NOT NULL, to_name TEXT NOT NULL, origin TEXT NOT NULL, created_at TEXT NOT NULL);
  `,
  // v21: análisis 2.0 (Fase E). quality_v = con qué versión del motor de calidad se puso la nota (NULL = la primera): los
  // temas con una vieja se vuelven a medir en una pasada liviana (core/queue.ts). bpm_base = el BPM en el rango general
  // (70–180); bpm queda en el rango del género del tema (core/analysis/bpmrange.ts), así se puede volver a calcular sin
  // reanalizar cuando el usuario cambia los rangos. dj_v = con qué versión del motor de BPM y tono (NULL = la primera, o
  // ninguna si no hay BPM); precise_v = la pasada precisa en segundo plano (core/precise.ts). No depende del orden de otras migraciones (se puede renumerar al unir).
  `
  ALTER TABLE analysis ADD COLUMN quality_v INTEGER;
  ALTER TABLE analysis ADD COLUMN bpm_base REAL;
  ALTER TABLE analysis ADD COLUMN dj_v INTEGER;
  ALTER TABLE analysis ADD COLUMN precise_v INTEGER;
  `,
  // v22: listas traídas de otro lado (core/requests.ts) y palabras que sobran aprendidas (core/junkwords.ts). requests: un
  // pedido (un CSV de Spotify, un texto pegado, un .m3u) con su playlist; request_items: cada tema del pedido en el orden
  // de la lista, con el tema de la biblioteca que se le encontró y cómo (isrc, ruta, probable, version), lo que decidió la
  // persona y la fila de la lista «Faltan o suenan mal» que creó. file_isrc: el código ISRC leído de los tags de cada archivo
  // (mientras no cambie). junk_words: lo que la persona dijo de cada palabra aprendida ("no es basura", apagada).
  // No depende del orden de otras migraciones (se puede renumerar al unir).
  `
  CREATE TABLE requests (id INTEGER PRIMARY KEY, name TEXT NOT NULL, source TEXT NOT NULL, playlist_id INTEGER REFERENCES playlists(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL, undone_at TEXT);
  CREATE TABLE request_items (id INTEGER PRIMARY KEY, request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE, position INTEGER NOT NULL,
    artist TEXT NOT NULL, title TEXT NOT NULL, album TEXT, duration REAL, isrc TEXT, kind TEXT NOT NULL, file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
    decision TEXT, why TEXT NOT NULL DEFAULT '', wanted_id INTEGER REFERENCES wanted(id) ON DELETE SET NULL, wanted_created INTEGER NOT NULL DEFAULT 0, arrived_at TEXT);
  CREATE INDEX request_items_req ON request_items (request_id, position);
  CREATE TABLE file_isrc (file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE, size INTEGER NOT NULL, mtime REAL NOT NULL, isrc TEXT);
  CREATE TABLE junk_words (word TEXT PRIMARY KEY, state TEXT NOT NULL, updated_at TEXT NOT NULL);
  `,
  // v23: Discos completos (core/albumrun.ts). album_choice = la edición que elegiste a mano para un disco
  // ("musicbrainz:<id>", "discogs:<id>") o "ignorar". key = artista|álbum plegados (core/albums.ts). wanted.album = el disco
  // al que le falta ese tema (motivo "falta_disco"). No depende del orden de otras migraciones.
  `
  CREATE TABLE album_choice (key TEXT PRIMARY KEY, choice TEXT NOT NULL, chosen_at TEXT NOT NULL);
  ALTER TABLE wanted ADD COLUMN album TEXT;
  `,
  // v24: Rekordbox y cabina, nivel pro (Fase F). rb_ids = el TrackID fijo de cada tema en rekordbox.xml (el de Rekordbox
  // si vino de su XML, si no uno de PAILA), así cada exportación usa el mismo y Rekordbox actualiza en vez de duplicar.
  // dj_grid = grilla de golpes por tema y por método (rekordbox, beatthis, degara): tramos en JSON y la energía de cada
  // compás: la de Rekordbox o Serato tal cual vino (tiempo de Rekordbox), la de PAILA en su tiempo (como decodifica
  // ffmpeg; el corrimiento de los MP3 se aplica al exportar). dj_cues igual: source rekordbox/serato tal cual, paila en su tiempo. dj_cues = cue points y loops (de Rekordbox, de Serato o sugeridos por PAILA). dj_meta = lo que se trajo de
  // Rekordbox: estrellas, color, "my tags", comentario y veces tocado. No depende del orden de otras migraciones.
  `
  CREATE TABLE rb_ids (file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE, track_id TEXT NOT NULL UNIQUE, source TEXT NOT NULL);
  CREATE TABLE dj_grid (file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE, method TEXT NOT NULL, bpm REAL NOT NULL,
    segments TEXT NOT NULL, error_ms REAL, variable INTEGER NOT NULL DEFAULT 0, bar_energy TEXT, src_size INTEGER, made_at TEXT NOT NULL,
    PRIMARY KEY (file_id, method));
  CREATE TABLE dj_cues (id INTEGER PRIMARY KEY, file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE, source TEXT NOT NULL,
    kind TEXT NOT NULL, num INTEGER NOT NULL, start REAL NOT NULL, end_at REAL, name TEXT NOT NULL DEFAULT '', color TEXT);
  CREATE INDEX dj_cues_file ON dj_cues (file_id, source);
  CREATE TABLE dj_meta (file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE, stars INTEGER NOT NULL DEFAULT 0, colour TEXT,
    my_tags TEXT, comments TEXT, play_count INTEGER, imported_at TEXT NOT NULL);
  `,
  // v25: reparación (21/10/2026). Con el disco desenchufado, las pasadas marcaban como hechos los temas que no pudieron
  // leer: la precisa dejó 946 temas con precise_v y sin su marca 'dj_precise'. Vuelven a quedar pendientes (y las huellas
  // anotadas sin ninguna huella, y los análisis que quedaron con el error de un archivo que no estaba o de un proceso
  // cerrado). Solo datos de análisis: no toca archivos. Desde ahora un disco que no está pausa el análisis (core/readguard.ts).
  // No depende del orden de otras migraciones (se puede renumerar al unir).
  `
  UPDATE analysis SET precise_v = NULL WHERE precise_v IS NOT NULL AND (',' || COALESCE(flags, '') || ',') NOT LIKE '%,dj_precise,%';
  UPDATE analysis SET prints_at = NULL WHERE prints_at IS NOT NULL AND audio_md5 IS NULL AND chromaprint IS NULL;
  DELETE FROM analysis WHERE error LIKE '%No such file or directory%' OR error LIKE '%El proceso de análisis se cerró%' OR error = 'Detenido';
  `,
  // v26: la marca "vinilo" (decidido el 22/10). "VINYL ONLY" y la cara ("A1", "B2") se sacan del título y del
  // artista en Arreglar nombres, y el dato queda acá: que es de vinilo y la cara, si se sabe. No depende del orden de otras
  // migraciones (se puede renumerar al unir).
  `CREATE TABLE IF NOT EXISTS vinyl (file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE, side TEXT, found_in TEXT NOT NULL, at TEXT NOT NULL);`,
  // v27: la Bandeja pasa a tu Música los temas que no tenías (decisión del 22/10): cada tanda, para el Historial y deshacer
  // (core/inboxadd.ts). rel = dónde quedó en la carpeta de música; src = dónde estaba en la Bandeja (adonde vuelve).
  // No depende del orden de otras migraciones.
  `
  CREATE TABLE IF NOT EXISTS inbox_added (id INTEGER PRIMARY KEY, batch INTEGER NOT NULL, root_id INTEGER NOT NULL, rel TEXT NOT NULL, src TEXT NOT NULL, at TEXT NOT NULL, undone_at TEXT);
  CREATE INDEX IF NOT EXISTS inbox_added_batch ON inbox_added (batch);
  `,
  // v28: grillas que se mueven. dj_tempo = entre qué BPM va cada grilla variable (rango de la tabla); Rekordbox con un solo BPM no es variable; cues con nombres de Rekordbox.
  `CREATE TABLE IF NOT EXISTS dj_tempo (file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE, method TEXT NOT NULL, lo REAL NOT NULL, hi REAL NOT NULL, PRIMARY KEY (file_id, method));
  UPDATE dj_grid SET variable = 0 WHERE method IN ('rekordbox', 'serato') AND (SELECT COUNT(DISTINCT json_extract(value, '$.bpm')) FROM json_each(dj_grid.segments)) < 2;
  UPDATE dj_cues SET name = CASE name WHEN 'Inicio' THEN 'Intro' WHEN 'Entra todo' THEN 'Drop' WHEN 'Salida' THEN 'Outro' ELSE name END WHERE source = 'paila';`,
  ...MIGRATIONS_2] // desde la v29, en core/migrations-2.ts
