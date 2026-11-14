// Los textos de la recuperación al abrir (core/recovery.ts y lo que resuelven archive/extract.ts y archive/papelera.ts), en
// castellano y en inglés (ver @paila/shared/idioma). El mensaje de cada cosa se guarda en la base (op_journal.message) en el
// idioma de ese momento y solo se muestra (Inicio → "La última vez PAILA se cerró de golpe"): nada lo compara. El nombre de
// cada operación se pone al mostrarlo. Las operaciones del diario ('organizar', 'tags'…) son datos: no se traducen.
import { textos } from '@paila/shared/idioma'

/** Cómo se llama cada operación del diario en el aviso. */
export const OP_NAME: Readonly<Record<string, string>> = textos({
  organizar: { es: 'Organizar carpetas', en: 'Organize folders' }, 'deshacer-organizar': { es: 'Deshacer un organizado', en: 'Undo an organize' },
  limpieza: { es: 'Limpieza de Espacio', en: 'Space cleanup' },
  papelera: { es: 'Mandar a la papelera', en: 'Send to the trash' }, restaurar: { es: 'Restaurar de la papelera', en: 'Restore from the trash' },
  tags: { es: 'Guardar tags', en: 'Save tags' }, 'deshacer-tags': { es: 'Deshacer cambios de tags', en: 'Undo tag changes' },
  reemplazo: { es: 'Reemplazar un tema (o convertirlo)', en: 'Replace a track (or convert it)' }, 'deshacer-reemplazo': { es: 'Deshacer un reemplazo', en: 'Undo a replacement' },
  vaciar: { es: 'Vaciar la papelera', en: 'Empty trash' },
  bandeja: { es: 'Bandeja: pasar a usados/ o no-sirvió/', en: 'Inbox: move to usados/ or no-sirvió/' },
  abrir: { es: 'Sacar de un ZIP o RAR', en: 'Take out of a ZIP or RAR' }, 'deshacer-abrir': { es: 'Deshacer lo sacado de un ZIP o RAR', en: 'Undo what was taken out of a ZIP or RAR' },
  'zip-papelera': { es: 'Mandar un ZIP o RAR a la papelera', en: 'Send a ZIP or RAR to the trash' }, 'zip-restaurar': { es: 'Restaurar un ZIP o RAR de la papelera', en: 'Restore a ZIP or RAR from the trash' },
  copia: { es: 'Copiar afuera de tu Música (pendrive, celular u otro programa)', en: 'Copy outside your Music (USB drive, phone or another app)' },
  separar: { es: 'Separar voz: guardar la acapella y el instrumental', en: 'Separate vocals: save the acapella and the instrumental' }, 'deshacer-separar': { es: 'Deshacer lo separado (a la papelera)', en: 'Undo what was separated (to the trash)' },
})

type S = (n: string) => string
type S2 = (n: string, x: string) => string

export const T = textos({
  noResuelto: {
    es: (n: string, m: string) => `Quedó a medias "${n}" y no se pudo resolver solo (${m}). No se tocó nada más.`,
    en: (n: string, m: string) => `"${n}" was left half done and couldn't be sorted out on its own (${m}). Nothing else was touched.`,
  },
  // la Bandeja (`dir` = la carpeta de destino: usados/ o no-sirvió/, que son nombres de carpetas y no se traducen)
  bandejaAMedias: {
    es: ((n, dir) => `"${n}" no se llegó a pasar a ${dir}/: quedó en la Bandeja (la copia a medias se sacó).`) as S2,
    en: ((n, dir) => `"${n}" never made it to ${dir}/: it stayed in the Inbox (the half-made copy was removed).`) as S2,
  },
  yaEstabaEn: { es: ((n, dir) => `"${n}" ya estaba en ${dir}/: se terminó de anotar.`) as S2, en: ((n, dir) => `"${n}" was already in ${dir}/: PAILA finished noting it down.`) as S2 },
  enLasDos: {
    es: ((n, dir) => `"${n}" quedó en la Bandeja y también en ${dir}/ (es el mismo archivo): sacá uno a mano.`) as S2,
    en: ((n, dir) => `"${n}" ended up both in the Inbox and in ${dir}/ (it's the same file): remove one by hand.`) as S2,
  },
  sigueBandeja: { es: ((n) => `"${n}" no se llegó a mover: sigue en la Bandeja.`) as S, en: ((n) => `"${n}" was never moved: it's still in the Inbox.`) as S },
  niBandejaNi: { es: ((n, dir) => `"${n}" no está ni en la Bandeja ni en ${dir}/.`) as S2, en: ((n, dir) => `"${n}" isn't in the Inbox or in ${dir}/.`) as S2 },
  // mover (organizar, papelera, restaurar, limpieza)
  noSeMovio: { es: ((n) => `No se llegó a mover: "${n}" quedó donde estaba.`) as S, en: ((n) => `It was never moved: "${n}" stayed where it was.`) as S },
  niUnoNiOtro: {
    es: (n: string, a: string, b: string) => `"${n}" no está ni en ${a} ni en ${b}. No se cambió nada en la base: volvé a escanear y fijate si aparece como desaparecido.`,
    en: (n: string, a: string, b: string) => `"${n}" isn't in ${a} or in ${b}. Nothing was changed in PAILA: scan again and see if it shows up as missing.`,
  },
  aLaPapelera: { es: 'a la papelera', en: 'to the trash' },
  aSuLugar: { es: 'de vuelta a su lugar', en: 'back to its place' },
  a: { es: ((d) => `a ${d}`) as S, en: ((d) => `to ${d}`) as S },
  yaSeMovio: { es: ((n, where) => `"${n}" ya se había movido ${where}: se terminó de anotar.`) as S2, en: ((n, where) => `"${n}" had already been moved ${where}: PAILA finished noting it down.`) as S2 },
  // tags
  noSeEncuentra: { es: ((n) => `No se encuentra "${n}".`) as S, en: ((n) => `"${n}" can't be found.`) as S },
  hayCopia: { es: ((b) => ` Hay una copia de resguardo en ${b}.`) as S, en: ((b) => ` There's a backup copy in ${b}.`) as S },
  otraVezPendientes: { es: 'El cambio sigue en Cambios pendientes: podés aplicarlo de nuevo.', en: 'The change is still in Pending changes: you can apply it again.' },
  otraVezHistorial: { es: 'Podés deshacerlo de nuevo desde el Historial.', en: 'You can undo it again from the History.' },
  sinCopia: {
    es: ((n) => `Se cortó mientras se guardaban los tags de "${n}" y no se encontró la copia de resguardo. Escuchalo para ver si suena bien.`) as S,
    en: ((n) => `PAILA stopped while saving the tags of "${n}" and the backup copy wasn't found. Listen to it to check it sounds right.`) as S,
  },
  copiaIncompleta: {
    es: ((n, b) => `La copia de resguardo de "${n}" está incompleta: no se usó. Quedó en ${b}.`) as S2,
    en: ((n, b) => `The backup copy of "${n}" is incomplete: it wasn't used. It was left in ${b}.`) as S2,
  },
  copiaDistinta: {
    es: ((n, b) => `La copia de resguardo de "${n}" no coincide con el original: no se usó. Quedó en ${b}.`) as S2,
    en: ((n, b) => `The backup copy of "${n}" doesn't match the original: it wasn't used. It was left in ${b}.`) as S2,
  },
  sonidoDistinto: {
    es: ((n, b) => `Se restauró "${n}" pero el sonido no coincide con la copia de resguardo. La copia quedó en ${b}.`) as S2,
    en: ((n, b) => `"${n}" was restored but the sound doesn't match the backup copy. The copy was left in ${b}.`) as S2,
  },
  tagsVuelto: {
    es: ((n, again) => `Se cortó mientras se guardaban los tags de "${n}": volvió a como estaba (sonido verificado, idéntico al original). ${again}`) as S2,
    en: ((n, again) => `PAILA stopped while saving the tags of "${n}": it went back to how it was (sound checked, identical to the original). ${again}`) as S2,
  },
  tagsVueltoExacto: {
    es: ((n, again) => `Se cortó mientras se guardaban los tags de "${n}": volvió a como estaba, byte a byte, desde su respaldo. ${again}`) as S2,
    en: ((n, again) => `PAILA stopped while saving the tags of "${n}": it went back to how it was, byte for byte, from its backup. ${again}`) as S2,
  },
  ningunaVersion: {
    es: ((n, b) => `Se cortó mientras se guardaban los tags de "${n}" y el archivo no es ni el de antes ni el de después: no se tocó. Escuchalo para ver si suena bien. Lo de antes quedó guardado en ${b}.`) as S2,
    en: ((n, b) => `PAILA stopped while saving the tags of "${n}" and the file is neither the old one nor the new one: it wasn't touched. Listen to it to check it sounds right. The old data was kept in ${b}.`) as S2,
  },
  noCambio: {
    es: (n: string, renamed: boolean, again: string) => `"${n}" no se llegó a cambiar${renamed ? ' (se le devolvió el nombre de antes)' : ''}. ${again}`,
    en: (n: string, renamed: boolean, again: string) => `"${n}" was never changed${renamed ? ' (it got its old name back)' : ''}. ${again}`,
  },
  // copias hacia afuera (pendrive, celular, archivos de otros programas)
  copiaAMedias: {
    es: ((n) => `La copia de "${n}" quedó a medias: se sacó (lo que había en ese lugar quedó como estaba). Podés volver a copiarlo.`) as S,
    en: ((n) => `The copy of "${n}" was left half done: it was removed (whatever was there before stayed as it was). You can copy it again.`) as S,
  },
  copiaHecha: { es: ((n) => `"${n}" ya se había copiado: se terminó de anotar.`) as S, en: ((n) => `"${n}" had already been copied: PAILA finished noting it down.`) as S },
  copiaNoHecha: { es: ((n) => `"${n}" no se llegó a copiar. Podés volver a copiarlo.`) as S, en: ((n) => `"${n}" was never copied. You can copy it again.`) as S },
  // reemplazos
  noReemplazo: { es: ((n) => `No se llegó a reemplazar "${n}": quedó como estaba.`) as S, en: ((n) => `"${n}" was never replaced: it's as it was.`) as S },
  reemplazoVuelto: {
    es: ((n) => `Se cortó mientras se reemplazaba "${n}": el tema volvió a como estaba (la copia nueva a medio hacer quedó en la papelera). Podés reemplazarlo de nuevo.`) as S,
    en: ((n) => `PAILA stopped while replacing "${n}": the track went back to how it was (the half-made new copy is in the trash). You can replace it again.`) as S,
  },
  noDeshizo: { es: ((n) => `No se llegó a deshacer el reemplazo de "${n}": quedó como estaba.`) as S, en: ((n) => `The replacement of "${n}" was never undone: it's as it was.`) as S },
  deshacerVuelto: {
    es: ((n) => `Se cortó mientras se deshacía el reemplazo de "${n}": quedó como estaba. Podés deshacerlo de nuevo desde el Historial.`) as S,
    en: ((n) => `PAILA stopped while undoing the replacement of "${n}": it's as it was. You can undo it again from the History.`) as S,
  },
  sinOriginal: {
    es: ((n, t) => `No se encuentra el original de "${n}" ni en la papelera ni en ${t}.`) as S2,
    en: ((n, t) => `The original of "${n}" can't be found, neither in the trash nor in ${t}.`) as S2,
  },
  yaDeshecho: { es: ((n) => `El reemplazo de "${n}" ya se había deshecho: se terminó de anotar.`) as S, en: ((n) => `The replacement of "${n}" had already been undone: PAILA finished noting it down.`) as S },
  // vaciar
  vaciando: {
    es: (gone: number, total: number) => `Se cortó mientras se vaciaba la papelera: ${gone} de ${total} archivos ya se habían borrado y quedaron anotados.${gone < total ? ' El resto sigue en la papelera.' : ''}`,
    en: (gone: number, total: number) => `PAILA stopped while emptying the trash: ${gone} of ${total} files had already been deleted and were noted down.${gone < total ? ' The rest is still in the trash.' : ''}`,
  },
  desconocida: { es: ((op) => `Operación desconocida (${op}): no se tocó nada.`) as S, en: ((op) => `Unknown operation (${op}): nothing was touched.`) as S },
  pendiente: {
    es: ((n) => `"${n}" quedó a medias en un disco que no está conectado. Cuando lo conectes, PAILA lo termina de revisar sola (no hace falta cerrarla).`) as S,
    en: ((n) => `"${n}" was left half done on a disk that isn't connected. When you connect it, PAILA finishes checking it on its own (no need to close it).`) as S,
  },
  // lo sacado de un ZIP o RAR (archive/extract.ts)
  yaSacado: { es: ((n) => `"${n}" ya se había sacado del comprimido: se terminó de anotar.`) as S, en: ((n) => `"${n}" had already been taken out of the archive: PAILA finished noting it down.`) as S },
  noSacado: { es: ((n) => `"${n}" no se llegó a sacar del comprimido: podés volver a sacarlo.`) as S, en: ((n) => `"${n}" was never taken out of the archive: you can take it out again.`) as S },
  yaEnPapelera: { es: ((n) => `"${n}" ya estaba en la papelera de PAILA: se terminó de deshacer.`) as S, en: ((n) => `"${n}" was already in PAILA's trash: PAILA finished undoing it.`) as S },
  noMandado: { es: ((n) => `"${n}" no se llegó a mandar a la papelera: sigue en tu Música.`) as S, en: ((n) => `"${n}" was never sent to the trash: it's still in your Music.`) as S },
  niMusicaNiPapelera: { es: ((n) => `"${n}" no está ni en tu Música ni en la papelera de PAILA.`) as S, en: ((n) => `"${n}" isn't in your Music or in PAILA's trash.`) as S },
  // un ZIP o RAR mandado a la papelera (archive/papelera.ts)
  yaEnPapeleraAnotado: { es: ((n) => `"${n}" ya estaba en la papelera de PAILA: se terminó de anotar.`) as S, en: ((n) => `"${n}" was already in PAILA's trash: PAILA finished noting it down.`) as S },
  yaVolvio: { es: ((n) => `"${n}" ya había vuelto a su lugar: se terminó de anotar.`) as S, en: ((n) => `"${n}" was already back in its place: PAILA finished noting it down.`) as S },
  noRestaurado: { es: ((n) => `"${n}" no se llegó a restaurar: sigue en la papelera de PAILA.`) as S, en: ((n) => `"${n}" was never restored: it's still in PAILA's trash.`) as S },
  niPapeleraNiLugar: { es: ((n) => `"${n}" no está ni en la papelera de PAILA ni en su lugar.`) as S, en: ((n) => `"${n}" isn't in PAILA's trash or in its place.`) as S },
})
