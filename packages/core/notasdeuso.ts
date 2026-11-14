// Notas de uso: lo que una persona anota mientras usa PAILA ("esto me resultó raro"). Una línea por nota en
// notas-de-uso/AAAA-MM-DD.jsonl (hora, pantalla, últimas pantallas y texto) y, al lado, la captura de la ventana en PNG.
// Todo queda en la carpeta de datos de esta PC; no se manda a ningún lado.
import fs from 'node:fs'
import path from 'node:path'
import type { NotaDeUso, NotaNueva } from '@paila/shared/types'

export const CARPETA_NOTAS = 'notas-de-uso'
const MAX_ACCIONES = 5

const dos = (n: number) => String(n).padStart(2, '0')
/** AAAA-MM-DD y AAAA-MM-DDTHH:MM:SS en hora local (así se lee el archivo sin pensar en husos). */
export function fechaLocal(d: Date) { return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}` }
export function horaLocal(d: Date) { return `${fechaLocal(d)}T${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}` }

/** Guarda la nota (y la captura, si hay). `carpeta` es la carpeta de notas, no la de datos. */
export function guardarNota(carpeta: string, n: NotaNueva, png: Buffer | null, ahora = new Date()): NotaDeUso {
  fs.mkdirSync(carpeta, { recursive: true })
  const hora = horaLocal(ahora)
  let captura: string | null = null
  if (png?.length) {
    captura = `${fechaLocal(ahora)}_${hora.slice(11).replace(/:/g, '')}.png`
    fs.writeFileSync(path.join(carpeta, captura), png)
  }
  const nota: NotaDeUso = { hora, pantalla: n.pantalla, acciones: n.acciones.slice(-MAX_ACCIONES), texto: n.texto.trim(), captura }
  fs.appendFileSync(path.join(carpeta, `${fechaLocal(ahora)}.jsonl`), JSON.stringify(nota) + '\n')
  return nota
}

/** Todas las notas, la más nueva primero. Una línea rota se salta: no tira abajo la lista. */
export function listarNotas(carpeta: string): NotaDeUso[] {
  if (!fs.existsSync(carpeta)) return []
  const out: NotaDeUso[] = []
  for (const f of fs.readdirSync(carpeta).filter((x) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(x))) {
    for (const linea of fs.readFileSync(path.join(carpeta, f), 'utf8').split('\n')) {
      if (!linea.trim()) continue
      try { const n = JSON.parse(linea) as NotaDeUso; if (typeof n.texto === 'string' && typeof n.hora === 'string') out.push(n) } catch { /* línea a medio escribir */ }
    }
  }
  return out.sort((a, b) => b.hora.localeCompare(a.hora))
}

export const REPO_PEDIDOS = 'https://github.com/epitelio-ar/PAILA'
export const MAIL_PEDIDOS = 'epitelio.ar@gmail.com'

/**
 * El pedido ya escrito para mandar una nota a quien hace PAILA: título y cuerpo con la nota, la pantalla y la versión.
 * Nada más (ni rutas, ni nombres de tus temas, ni la captura). Se abre en GitHub o en el mail; mandarlo lo decide la persona.
 */
export function armarPedido(n: NotaDeUso, version: string, via: 'github' | 'mail' = 'github'): { titulo: string; cuerpo: string; url: string } {
  const primera = n.texto.split('\n')[0].trim()
  const titulo = `[${n.pantalla}] ${primera.length > 70 ? primera.slice(0, 67) + '…' : primera}`
  const cuerpo = `${n.texto}\n\n---\nPantalla: ${n.pantalla}\nVersión de PAILA: ${version}`
  const url = via === 'github'
    ? `${REPO_PEDIDOS}/issues/new?title=${encodeURIComponent(titulo)}&body=${encodeURIComponent(cuerpo)}`
    : `mailto:${MAIL_PEDIDOS}?subject=${encodeURIComponent(`PAILA: ${titulo}`)}&body=${encodeURIComponent(cuerpo)}`
  return { titulo, cuerpo, url }
}
