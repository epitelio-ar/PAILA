// Una biblioteca de Engine DJ armada a mano para los tests (sin el programa): tests/enginedj.test.ts y tests/enginedb.test.ts.
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { engineDb } from '@paila/core/djexport'

/**
 * Una biblioteca de Engine vacía, como la deja Engine DJ al abrirse por primera vez (visto con Engine 5.1: sin tapas): v3 (4.1
 * en adelante, PerformanceData aparte) o v2 (2.x a 4.0, todo en Track). Solo lo que importa para escribir: las tablas, la fila
 * de Information y los disparadores de Engine que ordenan las playlists, cuidan los números de tema y completan su origen.
 */
export function makeEngine(libDir: string, v: 2 | 3, uuid = 'uuid-de-prueba') {
  fs.mkdirSync(path.join(libDir, 'Database2'), { recursive: true })
  const db = new DatabaseSync(engineDb(libDir))
  const perf = 'trackData BLOB, overviewWaveFormData BLOB, beatData BLOB, quickCues BLOB, loops BLOB, thirdPartySourceId INTEGER, activeOnLoadLoops INTEGER'
  db.exec(`
    CREATE TABLE Information (id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT, schemaVersionMajor INTEGER, schemaVersionMinor INTEGER, schemaVersionPatch INTEGER, currentPlayedIndiciator INTEGER, lastRekordBoxLibraryImportReadCounter INTEGER);
    CREATE TABLE AlbumArt (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT, albumArt BLOB);
    CREATE TABLE Track (id INTEGER PRIMARY KEY AUTOINCREMENT, playOrder INTEGER, length INTEGER, bpm INTEGER, year INTEGER, path TEXT, filename TEXT, bitrate INTEGER, bpmAnalyzed REAL, albumArtId INTEGER, fileBytes INTEGER, title TEXT, artist TEXT, album TEXT, genre TEXT, comment TEXT, label TEXT, composer TEXT, remixer TEXT, key INTEGER, rating INTEGER, albumArt TEXT, timeLastPlayed DATETIME, isPlayed BOOLEAN, fileType TEXT, isAnalyzed BOOLEAN, dateCreated DATETIME, dateAdded DATETIME, isAvailable BOOLEAN, isMetadataOfPackedTrackChanged BOOLEAN, isPerfomanceDataOfPackedTrackChanged BOOLEAN, playedIndicator INTEGER, isMetadataImported BOOLEAN, pdbImportKey INTEGER, streamingSource TEXT, uri TEXT, isBeatGridLocked BOOLEAN, originDatabaseUuid TEXT, originTrackId INTEGER, ${v === 2 ? `${perf}, ` : ''}streamingFlags INTEGER, explicitLyrics BOOLEAN, lastEditTime DATETIME,
      CONSTRAINT C_originDatabaseUuid_originTrackId UNIQUE (originDatabaseUuid, originTrackId), CONSTRAINT C_path UNIQUE (path), FOREIGN KEY (albumArtId) REFERENCES AlbumArt (id) ON DELETE RESTRICT);
    ${v === 3 ? `CREATE TABLE PerformanceData (trackId INTEGER PRIMARY KEY, ${perf}, FOREIGN KEY(trackId) REFERENCES Track(id) ON DELETE CASCADE ON UPDATE CASCADE);
    CREATE TRIGGER trigger_after_insert_Track_insert_performance_data AFTER INSERT ON Track BEGIN INSERT INTO PerformanceData(trackId) VALUES(NEW.id); END;` : ''}
    CREATE TABLE Playlist (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, parentListId INTEGER, isPersisted BOOLEAN, nextListId INTEGER, lastEditTime DATETIME, isExplicitlyExported BOOLEAN,
      CONSTRAINT C_NAME_UNIQUE_FOR_PARENT UNIQUE (title, parentListId), CONSTRAINT C_NEXT_LIST_ID_UNIQUE_FOR_PARENT UNIQUE (parentListId, nextListId));
    CREATE TABLE PlaylistEntity (id INTEGER PRIMARY KEY AUTOINCREMENT, listId INTEGER, trackId INTEGER, databaseUuid TEXT, nextEntityId INTEGER, membershipReference INTEGER,
      CONSTRAINT C_NAME_UNIQUE_FOR_LIST UNIQUE (listId, databaseUuid, trackId), FOREIGN KEY (listId) REFERENCES Playlist (id) ON DELETE CASCADE);
    CREATE TRIGGER trigger_after_insert_Track_check_id AFTER INSERT ON Track WHEN NEW.id <= (SELECT seq FROM sqlite_sequence WHERE name = 'Track') BEGIN
      SELECT RAISE(ABORT, 'Recycling deleted track id''s are not allowed'); END;
    CREATE TRIGGER trigger_after_insert_Track_fix_origin AFTER INSERT ON Track WHEN IFNULL(NEW.originTrackId, 0) = 0 OR IFNULL(NEW.originDatabaseUuid, '') = '' BEGIN
      UPDATE Track SET originTrackId = NEW.id, originDatabaseUuid = (SELECT uuid FROM Information) WHERE track.id = NEW.id; END;
    CREATE TRIGGER trigger_before_insert_List BEFORE INSERT ON Playlist FOR EACH ROW BEGIN
      UPDATE Playlist SET nextListId = -(1 + nextListId) WHERE nextListId = NEW.nextListId AND parentListId = NEW.parentListId; END;
    CREATE TRIGGER trigger_after_insert_List AFTER INSERT ON Playlist FOR EACH ROW BEGIN
      UPDATE Playlist SET nextListId = NEW.id WHERE nextListId = -(1 + NEW.nextListId) AND parentListId = NEW.parentListId; END;
    CREATE TRIGGER trigger_after_delete_List AFTER DELETE ON Playlist FOR EACH ROW BEGIN
      UPDATE Playlist SET nextListId = OLD.nextListId WHERE nextListId = OLD.id; DELETE FROM Playlist WHERE parentListId = OLD.id; END;
    CREATE TRIGGER trigger_before_delete_PlaylistEntity BEFORE DELETE ON PlaylistEntity WHEN OLD.trackId > 0 BEGIN
      UPDATE PlaylistEntity SET nextEntityId = OLD.nextEntityId WHERE nextEntityId = OLD.id AND listId = OLD.listId; END;
    INSERT INTO Information (uuid, schemaVersionMajor, schemaVersionMinor, schemaVersionPatch, currentPlayedIndiciator, lastRekordBoxLibraryImportReadCounter) VALUES ('${uuid}', ${v === 3 ? '3, 0, 2' : '2, 21, 2'}, 1, 0);
    PRAGMA user_version = 4194305;
    INSERT INTO Playlist (title, parentListId, isPersisted, nextListId, lastEditTime, isExplicitlyExported) VALUES ('Mía', 0, 1, 0, '2026-01-01 00:00:00', 1);
  `)
  db.close()
  fs.writeFileSync(path.join(libDir, 'Database2', 'hm.db'), 'historial')
}
