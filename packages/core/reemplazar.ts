// Reemplazar un archivo por su temporal de una vez (en Windows y en la Mac un renombre no queda a medias). Un antivirus o el
// indexador de Windows que justo está leyendo uno de los dos lo puede trabar un instante: se reintenta unas veces. Lo usan la
// escritura de tags (core/changes-write.ts) y el cover.jpg de la carpeta (core/foldercover.ts).
import fs from 'node:fs'

export function reemplazar(tmp: string, file: string) {
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return } catch (e) {
      if (i >= 8 || !['EPERM', 'EBUSY', 'EACCES'].includes((e as NodeJS.ErrnoException).code ?? '')) throw e
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (i + 1))
    }
  }
}
