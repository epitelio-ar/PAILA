// El idioma de PAILA (castellano o inglés, ver @paila/shared/idioma): vive en userData/idioma.json, al lado de la base, de
// donde lo lee también NAPIA. La primera vez se toma el de Windows. La ventana lo pide al abrir (preload) y, al cambiarlo, recarga.
import fs from 'node:fs'
import path from 'node:path'
import { app, ipcMain } from 'electron'
import { esIdioma, idiomaDelSistema, ponerIdioma, type Idioma } from '@paila/shared/idioma'

const archivo = () => path.join(app.getPath('userData'), 'idioma.json')

/** El guardado (o PAILA_IDIOMA=es|en); si nunca se eligió, el de Windows, que queda guardado (después no cambia solo). */
export function leerIdioma(): Idioma {
  if (esIdioma(process.env.PAILA_IDIOMA)) return process.env.PAILA_IDIOMA // capturas y pruebas: no se guarda
  try { const i = (JSON.parse(fs.readFileSync(archivo(), 'utf8')) as { idioma?: unknown }).idioma; if (esIdioma(i)) return i } catch { /* primera vez */ }
  const i = idiomaDelSistema(app.getPreferredSystemLanguages())
  guardar(i)
  return i
}

function guardar(i: Idioma) {
  try { fs.writeFileSync(archivo(), JSON.stringify({ idioma: i })) } catch { /* sin disco: vale hasta cerrar */ }
}

/** `alCambiar`: lo que guardó la base con palabras (la nota, los errores) pasa al idioma nuevo antes de que la ventana recargue. */
export function registerIdioma(alCambiar?: (i: Idioma) => void) {
  ponerIdioma(leerIdioma())
  // lo pide el preload al abrir (sin esperar): la pantalla tiene que saber el idioma antes de dibujar el primer texto
  ipcMain.on('idioma:get', (e) => { e.returnValue = leerIdioma() })
  ipcMain.handle('idioma:set', (_e, i: unknown) => {
    if (!esIdioma(i)) return
    guardar(i)
    ponerIdioma(i)
    alCambiar?.(i)
  })
}
