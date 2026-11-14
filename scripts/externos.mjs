// Plugin de esbuild para armar un script o un worker que usa el núcleo: deja afuera las dependencias de npm (se cargan
// como siempre, de node_modules) y mete adentro los paquetes de la familia (@paila/…), que son TypeScript sin compilar.
export const externos = {
  name: 'externos',
  setup(build) {
    build.onResolve({ filter: /^[^./]/ }, (a) => (a.kind === 'entry-point' || a.path.startsWith('@paila/') ? undefined : { path: a.path, external: true }))
  },
}
