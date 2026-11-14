// `npm run textos [archivo…]`: lista los textos sueltos (sin traducir) de las pantallas, archivo por archivo, con su renglón.
// Sin archivos: un resumen de cuántos quedan en cada uno. `--podar`: saca de tests/idioma-pendientes.ts las que ya quedaron
// en pares. Ver scripts/textos-sueltos.ts y la regla en tests/estilo.test.ts.
import fs from 'node:fs'
import { archivosDePantalla, textosSueltos } from './textos-sueltos'

const args = process.argv.slice(2)
const podar = args.includes('--podar')
const pedidos = args.filter((a) => a !== '--podar')
const todos = archivosDePantalla('.')
const elegidos = pedidos.length ? todos.filter((f) => pedidos.some((p) => f.endsWith(p.split('\\').join('/')))) : todos
const cuantos = new Map<string, number>()
let total = 0
for (const f of elegidos) {
  const s = textosSueltos(fs.readFileSync(f, 'utf8'), f)
  cuantos.set(f, s.length)
  total += s.length
  if (!s.length) continue
  if (pedidos.length) { console.log(`\n${f}`); for (const x of s) console.log(`  ${x.linea}: ${x.texto}`) }
  else if (!podar) console.log(`${String(s.length).padStart(5)}  ${f}`)
}
console.log(`\n${total} textos sueltos en ${elegidos.length} archivos.`)

if (podar) {
  const lista = 'tests/idioma-pendientes.ts'
  const antes = fs.readFileSync(lista, 'utf8')
  const sacadas: string[] = []
  const despues = antes.split('\n').filter((l) => {
    const m = /^ {2}'([^']+)',$/.exec(l)
    const listo = !!m && (!todos.includes(m[1]) || cuantos.get(m[1]) === 0 || (!cuantos.has(m[1]) && !textosSueltos(fs.readFileSync(m[1], 'utf8'), m[1]).length))
    if (listo) sacadas.push(m![1])
    return !listo
  }).join('\n')
  fs.writeFileSync(lista, despues)
  console.log(sacadas.length ? `Saqué de la lista de pendientes: ${sacadas.join(', ')}` : 'Ninguna pantalla nueva terminada.')
}
