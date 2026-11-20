// Cómo está escrita en el disco cada carpeta de destino de Ordenar. En Windows y en la Mac "La esquina del infinito" y "La Esquina
// del Infinito" son la misma carpeta: un tema que se manda a la primera cae en la segunda si ya existe. Antes la base anotaba el
// nombre pedido, al reabrir PAILA el escaneo lo corregía con el del disco y deshacer lo tomaba como "cambió de lugar o de nombre
// después" (video, 13/11: 11 de 106 temas no volvían). Ahora el destino se escribe como ya está en el disco, y un tema que solo
// cambiaría de mayúsculas en una carpeta no se mueve (eran los "7 movimientos de ruido" de la corrida supervisada).
import fs from 'node:fs'
import path from 'node:path'
import { visible, type Db } from './db'

/** Una ruta como la comparan Windows y la Mac: sin mirar mayúsculas ni cómo viene escrita una tilde (la Mac puede separarla). */
export const clave = (rel: string) => rel.normalize('NFC').toLowerCase()

/** ¿Es la misma ruta para Windows y la Mac? */
export const mismaRuta = (a: string, b: string) => clave(a) === clave(b)

/**
 * Devuelve una función que reescribe cada carpeta de una ruta (relativa a su carpeta de música) como ya está escrita: primero
 * como la conoce la base (lo que vio el último escaneo), si no como está en el disco (una carpeta sin temas que PAILA conozca), y
 * si no existe todavía, como la pidió la primera vez esta misma vista previa (dos temas que van a "Disco" y "disco" terminan en
 * una sola). El nombre del archivo no se toca: un archivo sí se puede renombrar cambiando solo mayúsculas.
 */
export function carpetasDelDisco(db: Db, rootPath: (rootId: number) => string | null): (rootId: number, rel: string) => string {
  const escritas = new Map<string, string>() // `${rootId}|${clave(carpeta)}` → cómo está escrita
  const anotar = (rootId: number, carpeta: string) => { const k = `${rootId}|${clave(carpeta)}`; if (!escritas.has(k)) escritas.set(k, carpeta) }
  for (const f of db.prepare(`SELECT root_id AS rootId, rel_path AS rel FROM files WHERE ${visible()}`).all() as { rootId: number; rel: string }[]) {
    const partes = f.rel.split('/').slice(0, -1)
    for (let i = 1; i <= partes.length; i++) anotar(f.rootId, partes.slice(0, i).join('/'))
  }
  const listados = new Map<string, string[]>() // carpeta del disco → lo que tiene adentro (se lee una vez)
  const listar = (abs: string) => {
    let l = listados.get(abs)
    if (!l) { try { l = fs.readdirSync(abs) } catch { l = [] } listados.set(abs, l) }
    return l
  }
  return (rootId, rel) => {
    const partes = rel.split('/'), archivo = partes.pop()!
    const root = rootPath(rootId)
    let hecha = '', existe = !!root // si una carpeta no está en el disco, las de adentro tampoco: no se lee más
    for (const parte of partes) {
      const pedida = hecha ? `${hecha}/${parte}` : parte
      let escrita = escritas.get(`${rootId}|${clave(pedida)}`)
      if (!escrita && existe) {
        const lista = listar(path.join(root!, ...hecha.split('/').filter(Boolean)))
        const igual = lista.includes(parte) ? parte : lista.find((n) => clave(n) === clave(parte))
        if (igual) escrita = hecha ? `${hecha}/${igual}` : igual
        else existe = false
      }
      hecha = escrita ?? pedida
      anotar(rootId, hecha)
    }
    return hecha ? `${hecha}/${archivo}` : archivo
  }
}
