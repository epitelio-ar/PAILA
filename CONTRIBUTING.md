# Contributing / Cómo sumar cambios

*English below · [Castellano](#castellano)*

Thanks for wanting to help. PAILA is made for anyone with a lot of music, so ideas and bug reports from people who don't program are just as welcome as code.

- **Bugs and ideas:** open an [issue](https://github.com/epitelio-ar/PAILA/issues/new/choose) with its template. Security problems go through [SECURITY.md](SECURITY.md), never in a public issue.
- **Code:** read [AGENTS.md](AGENTS.md) first (for people and coding agents alike): how the project is built, the product rules, style, languages and how to test. The project docs and the interface are written in Rioplatense Spanish first; every on-screen text goes in a Spanish/English pair.

## Before opening a pull request

1. One topic per pull request, small if possible. For something big, open an issue first so we can talk about it.
2. Follow the product rules in AGENTS.md. The non-negotiable ones: **PAILA doesn't break anything** (every file change goes through the preview and can be undone), sample packs are never renamed or moved, and PAILA doesn't download music.
3. `npm run verificar` must pass (types, build, tests and the lab; `-- --rapido` if you didn't touch the quality analysis). If you changed the interface, include a before/after screenshot (`npm run capturas` and `npm run capturas:comparar`), with **no one's real music** in it: use the demo library (`node scripts/run-ts.mjs scripts/demo.ts <folder>`, made-up tracks).
4. Every bug fix comes with a test that would have caught it.
5. If you add a dependency, check its license (it has to be compatible with AGPL-3.0) and run `npm run licencias`.
6. Never commit keys, databases, music, or paths and names from your own library.

By sending a contribution you agree that it is published under the project's license, [AGPL-3.0-or-later](LICENSE).

---

## Castellano

Gracias por querer ayudar. PAILA es para cualquiera que tenga mucha música, así que las ideas y los errores que avisa gente que no programa valen tanto como el código.

- **Errores e ideas:** abrí un [issue](https://github.com/epitelio-ar/PAILA/issues/new/choose) con su plantilla. Los problemas de seguridad van por [SECURITY.md](SECURITY.md), nunca en un issue público.
- **Código:** leé primero [AGENTS.es.md](AGENTS.es.md) (sirve para personas y agentes de código): cómo está armado, las reglas del producto, el estilo, los idiomas y cómo probar. Los documentos y la interfaz están en castellano rioplatense primero; cada texto de pantalla va en un par castellano/inglés.

### Antes de abrir un pull request

1. Un tema por pull request, chico si se puede. Para algo grande, abrí antes un issue y lo charlamos.
2. Seguí las reglas del producto de AGENTS.es.md. Las que no se negocian: **PAILA no rompe nada** (todo cambio en archivos pasa por la vista previa y se puede deshacer), los sample packs nunca se renombran ni se mueven, y PAILA no descarga música.
3. Tiene que pasar `npm run verificar` (tipos, armado, tests y laboratorio; `-- --rapido` si no tocaste el análisis de calidad). Si cambiaste la interfaz, sumá una captura del antes y el después (`npm run capturas` y `npm run capturas:comparar`), **sin la música real de nadie**: usá la biblioteca de demo (`node scripts/run-ts.mjs scripts/demo.ts <carpeta>`, con temas inventados).
4. Cada arreglo de un error viene con un test que lo habría encontrado.
5. Si sumás una dependencia, mirá su licencia (tiene que ser compatible con AGPL-3.0) y corré `npm run licencias`.
6. Nunca subas claves, bases, música, ni rutas o nombres de tu propia biblioteca.

Al mandar un cambio, aceptás que se publique con la licencia del proyecto, [AGPL-3.0-or-later](LICENSE).
