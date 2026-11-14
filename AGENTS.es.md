# Guía para programar en PAILA (personas y agentes de código)

*[English](AGENTS.md) · Castellano*

PAILA es una app de escritorio, libre (AGPL-3.0-or-later), para **cualquiera que tenga mucha música acumulada**: ver la calidad real de cada archivo, arreglar tags y carpetas, armar playlists, encontrar duplicados y hacer lugar. Las funciones para DJs (BPM y tono, grilla, Rekordbox) son una parte, no el centro. NAPIA es su hermana: un panel para usar sockseek (el programa que baja de Soulseek).

Esta guía sirve para cualquier agente (Claude Code, Codex, Copilot, Cursor…) o persona que programe. No depende de ninguna PC en particular.

## Antes de tocar nada
- `docs/MAPA.md`: una línea por archivo. Buscá ahí y leé solo el pedazo que necesitás: **cada archivo empieza con 1–2 líneas que dicen qué hace**.
- Qué está hecho y qué sigue: los issues del repositorio y las novedades de cada versión (`docs/NOVEDADES.md`).
- Muchos comentarios citan bitácoras (`docs/pruebas/…`, `docs/archivo/…`), el kit de las pruebas con personas (`docs/prueba-personas/`) y planes (`MASTERPLAN-n`, `docs/DECISIONES.md`) que no están en este repositorio: son del repositorio de desarrollo y no se publican porque tienen datos de una biblioteca real. Quedan como referencia de dónde salió cada decisión.
- `docs/GLOSARIO.md`: las palabras de la interfaz (se dice igual en toda la app).

## Reglas del producto (no negociables)
1. **PAILA no rompe nada.** Nada se borra de verdad: hay una papelera propia (`_PAILA`) y el único borrado real es "Vaciar papelera", a mano.
2. **Todo cambio en archivos pasa por "Cambios pendientes"**: vista previa, aplicar con resguardo y verificación, y deshacer desde el Historial.
   - **Todo lo que escribe archivos va por el motor único** (`packages/core/ops/`): los chequeos previos de la tanda (`checks.ts`), el diario, verificar y confirmar (`run.ts`), lo que va afuera de tu Música (`copy.ts`) y el respaldo de lo que cambia por dentro (`backup.ts`).
   - En pantalla, se confirma con `ConfirmarBoton` y se muestra el resultado con `Resultado` (`apps/paila/ui/src/Confirmar.tsx`).
   - Una función nueva no arma su propio camino.
3. **Los sample packs nunca se renombran ni se reorganizan** (`kind = 'produccion'`).
4. Se excluyen solas las carpetas `PIONEER` (exportación USB de Rekordbox) y los proyectos de Ableton.
5. **PAILA no descarga música.**
6. Pensada para compartir: **nada atado a una PC** (ni rutas, ni letras de disco, ni nombres de usuario). Los discos se reconocen por número de serie.
7. Privacidad: lo que sale a internet es solo artista, título, duración o la huella acústica (y 15 s de audio con AudD, que está apagado de fábrica). Las claves se guardan cifradas y nunca vuelven a la interfaz ni a los registros.

## Cómo está armado
Electron 43 + React 19 + TypeScript (electron-vite 5), SQLite integrado de Node (`node:sqlite`), ffmpeg de `ffmpeg-static` y ffprobe del mismo armado (gyan.dev 6.1.1, `npm run ffprobe:bajar`; en Mac, `ffprobe-static`), nunca del PATH, BPM y tono con `essentia.js`. Un repositorio con npm workspaces:

- `apps/paila`: la app (`electron/` = proceso principal, `ui/src/` = interfaz, `build/` = íconos, instalador y avisos de licencias).
- `apps/napia`: NAPIA. El instalador de PAILA la lleva adentro (`PAILA.exe --napia`).
- `packages/core` (`@paila/core/…`): **toda la lógica, sin interfaz y con tests**.
- `packages/shared` (`@paila/shared/…`): el contrato entre procesos (tipos y `PailaApi`).
- `packages/diseno` (`@paila/diseno`): tokens, componentes e íconos compartidos.
- `tests/`, `scripts/` y `docs/` en la raíz.

Los paquetes se importan por nombre (`@paila/core/db`), nunca con `../../`.

**Una función nueva casi siempre toca, en este orden:** `packages/core/` → `packages/shared/types/<área>.ts` → `apps/paila/electron/ipc/<área>.ts` + `apps/paila/electron/preload.ts` → `apps/paila/ui/src/`. Un pedido viaja: interfaz `window.paila.algo()` → preload → IPC → función de `packages/core/` → base.

## Comandos
```bash
npm install
npx install-electron          # Electron baja su programa aparte
npm run ffprobe:bajar         # en Windows: el ffprobe que viaja con PAILA (gyan.dev 6.1.1, revisado por huella)
npx tsc --noEmit -p tsconfig.json
npm test                      # incluye las reglas de estilo (tests/estilo.test.ts) y las de licencias
npm run build                 # arma NAPIA y PAILA
npm run corpus                # laboratorio de archivos difíciles (antes de unir cambios en packages/core)
npm run verificar             # todo junto y en orden: tipos, armado, tests y laboratorio (-- --rapido: el laboratorio rápido)
npm run tema -- <archivo>      # todo lo que PAILA ve y decide de un tema (solo lee; --json, --base <copia.db>)
npm run textos -- <archivo>    # los textos sueltos (sin su par en inglés) de una pantalla; sin archivo, cuántos quedan en cada una
npm run capturas              # recorre TODAS las pantallas de PAILA y NAPIA (sobrio, historieta y cabina) en capturas/<fecha>
npm run capturas:comparar -- <antes> <después>   # compara dos carpetas de capturas y arma una lámina (lamina.html)
npm run turnos                # quién está usando qué (copia de la Música, medición, laboratorio, verificación)
npm run version:subir -- X.Y.Z # sube la versión de PAILA y NAPIA (antes, su entrada en docs/NOVEDADES.md)
npm run dist                  # instalador y portable en apps/paila/dist (no publica nada)
npm run licencias             # rearma AVISOS-DE-TERCEROS.txt y docs/licencias.md
```
npm solo corre los scripts de instalación aprobados en `allowScripts` de `package.json`.

Abrir la app armada: `node_modules/electron/dist/electron.exe apps/paila`.

Variables para desarrollo y pruebas:
| Variable | Qué hace |
|---|---|
| `PAILA_USER_DATA=<carpeta>` | Usa otra carpeta de datos (otra base). **Siempre para probar con datos reales: con una copia de la base.** |
| `PAILA_SNAPSHOT=x.png` | Abre la ventana oculta, guarda una captura y cierra. `PAILA_SNAPSHOT_JS` corre algo antes. |
| `PAILA_SLOW_WALK=200` | Hace lento el recorrido de carpetas (para ver el avance). |
| `PAILA_LIBRARY=<carpeta>` | Biblioteca real para `tests/real-library.test.ts` (**solo lectura**). |
| `PAILA_CORPUS=<carpeta>` | Dónde está el laboratorio de `npm run corpus`. |
| `PAILA_UPDATE_FEED=http://127.0.0.1:<puerto>/` | Prende las actualizaciones contra un servidor de prueba (nunca contra GitHub). |
| `PAILA_MEDICION=1` | Para medir velocidad (ver "Trabajo pesado"). |
| `PAILA_IDIOMA=es|en` | Abre en ese idioma sin cambiar lo guardado. |
| `NAPIA_RED_FALSA=<archivo.json>` | NAPIA y el Chequeo de PAILA usan un firewall, un tipo de red y un router inventados (ver `packages/core/sockseek/firewall-sistema.ts`): "Arreglarlo" y "Abrir la configuración de red" no tocan nada. Ejemplos en `docs/pruebas/2026-10-24-chequeo/`. |

## Ver qué hace PAILA por dentro (para agentes y gente que programa)
- **Un tema:** `npm run tema -- "<ruta, número o pedazo del nombre>"` imprime todo lo que PAILA ve y decide: tags, calidad y por qué, BPM, tono, grilla, huellas, playlists, duplicados, historial y qué propondría cada asistente. Abre la base en solo lectura (`--base <copia.db>`, o `PAILA_USER_DATA`, o la de la PC): nunca escribe. `--json` para otro programa; `--sin-asistentes` si la biblioteca es enorme. Es el mismo inspector de la app (Modo avanzado).
- **Pantallas:** `npm run build` y después `npm run capturas` deja una captura de cada pantalla de PAILA y NAPIA, en sobrio, historieta y cabina, en `capturas/<fecha>/` (con una copia de la base y la app en modo solo mirar). Después de tocar la interfaz: una corrida antes y otra después, y `npm run capturas:comparar -- capturas/<antes> capturas/<después>` arma `lamina.html` con el antes, el después y dónde cambió cada pantalla. Opciones: `--solo paila|napia`, `--modos sobrio,cabina`, `--pantallas home,settings`, `--idiomas es,en` (de fábrica los dos; el inglés va en `<modo>.en/`).
- **Modo avanzado (apagado de fábrica):** Configuración → Pantalla, o Ctrl+K → "Prender el modo avanzado". Suma a la barra lateral el inspector de un tema, la cola del análisis, el registro de operaciones y el muestrario de diseño; con un tema elegido, Ctrl+K ofrece "Reanalizar el tema elegido". Solo muestra: no cambia cómo trabaja PAILA.

## Probar sin romper la música de nadie
- **La biblioteca de alguien es sagrada.** Leerla está bien; escribirla, nunca sin permiso. Para probar cambios de punta a punta (aplicar nombres, organizar, convertir, reemplazar), usá una **copia** de la carpeta de música y una **copia** de la base (`%APPDATA%\PAILA\paila.db`) con `PAILA_USER_DATA`, cambiando en esa copia la carpeta raíz para que apunte a la copia de la música. Después, compará los resultados contra el original.
- Los tests hacen sus archivos con ffmpeg (sintéticos); nunca usan la biblioteca real salvo `real-library.test.ts`, en lectura.
- **Corridas supervisadas:** toda función que toque muchos temas (organizar, arreglar nombres, internet, duplicados, convertir) se prueba primero con una vista previa sobre una biblioteca real, revisando cada propuesta buscando lo chico ("Balvin" en vez de "J Balvin"). Se anota en `docs/pruebas/` y cada error encontrado queda con su test.

## Estilo
Lo revisa `tests/estilo.test.ts` en cada `npm test`:
- cada archivo de código empieza con un comentario que dice qué hace;
- ningún archivo pasa de 350 líneas (la meta es menos de 300: el que crece se parte por tarea);
- `packages/core/` no escribe en la consola (avisa con `onProgress`, `onWarn` o un error en castellano);
- el filtro de "tema visible" va siempre con `visible()` o `listed()` de `packages/core/db.ts`;
- la interfaz usa los íconos de `@paila/diseno`, sin emoji;
- **ningún texto suelto en una pantalla**: cada uno va en un par castellano/inglés (ver "Textos e idioma"). `npm run textos -- <archivo>` dice cuáles faltan.

Además:
- Las migraciones de la base (`packages/core/migrations.ts`) se agregan al final, nunca se editan las viejas.
- Las rutas relativas se guardan con `/`.
- Los textos de la interfaz están en castellano rioplatense, simple. Cada término técnico lleva una explicación corta (ⓘ, componente `Info`). Pensá en cualquiera con mucha música, no solo en DJs.
- Comentarios y nombres siguen el estilo del archivo que estás tocando.

## Textos e idioma
PAILA y NAPIA hablan castellano rioplatense e inglés (Configuración → Pantalla → Idioma; la primera vez, el de Windows). La base está en `@paila/shared/idioma`:
```ts
import { textos, cant, num, fecha } from '@paila/shared/idioma'
const T = textos({
  titulo: { es: 'Duplicados', en: 'Duplicates' },
  hay: { es: (n: number) => `Hay ${cant(n, 'tema', 'temas')}`, en: (n: number) => `There are ${cant(n, 'track', 'tracks')}` },
})
// en la pantalla: {T.titulo} · {T.hay(3)} · num(1234.5) · fecha(d)
```
- Los pares van al principio del archivo de la pantalla o, si no entra (350 líneas), en uno aparte al lado (`Duplicates.textos.ts`). TypeScript exige los dos idiomas y los mismos datos.
- Negrita y partes que no son texto (un ⓘ, un botón): `<Rico texto={T.aviso} partes={{ info: <Info tip={T.avisoTip} /> }} />` con `'Tenés **3 temas** sin tapa {info}'` (de `@paila/diseno`).
- Números y fechas con `num`, `fecha`, `fechaHora`; plurales con `cant` / `plural`; listas con `lista` ("A, B y C"). Nada de `'es-AR'` a mano.
- El inglés, igual de simple que el castellano: sin jerga y con su ⓘ. El castellano no cambia al pasarlo.
- **Lo que PAILA escribe en los archivos no se traduce** (tags, carpetas como "Instrumentales y Acapellas" o "Varios Artistas"): eso no usa `textos()`.
- La regla (`tests/estilo.test.ts`) revisa todas las pantallas menos las de `tests/idioma-pendientes.ts`, que se están pasando: una pantalla nueva nace con sus textos en pares. Si hace falta dejar algo igual en los dos idiomas, `// idioma-ok` en ese renglón o el de arriba.
- `PAILA_IDIOMA=en` abre PAILA o NAPIA en inglés sin cambiar lo guardado (capturas, pruebas).

## Dependencias y licencias
- Antes de sumar una dependencia, mirá su licencia: lo que viaja con la app tiene que ser compatible con AGPL-3.0 y aprobado por OSI (lista en `scripts/licencias.ts`). Nada con partes "no comercial" dentro del instalador: va como descarga opcional.
- Después de cambiar dependencias: `npm run licencias` (si no, falla `tests/licencias.test.ts`).
- Las versiones van fijas o con tope (`package-lock.json` al día). OSV-Scanner revisa avisos de seguridad en GitHub.
- El modelo de Beat This! y onnxruntime-web (MIT) viajan siempre, en el instalador y en la portable. `npm run modelos:armar -- --desde <carpeta de modelos>` arma la copia mínima; `dist`/`pack` la traen solos si la encuentran (`scripts/preparar-instalador.mjs`): ver `docs/compartir.md`.

## Trabajo pesado y sesiones en paralelo
- Si varias sesiones trabajan a la vez, cada una en su rama o copia de trabajo. En una copia de trabajo (`git worktree`), `node_modules/@paila` puede apuntar al código de otra carpeta: verificá que los tests usen el de tu rama.
- **Mediciones de velocidad:** antes de medir, crear `%TEMP%\paila-medicion.lock` con una línea (quién, qué mide, hasta qué hora), correr con `PAILA_MEDICION=1` y borrarlo al terminar. Mientras exista, nadie corre trabajo pesado (`npm test` ya espera solo).
- Decodificar mucho audio a la vez traba la PC: si ya hay otro `ffmpeg` trabajando, esperá.

## Cosas que ya se aprendieron
- PowerShell 5.1 falla con rutas de más de 260 caracteres; Node y bash no.
- En bash, las rutas con "ú" u otros acentos pueden romperse al pasarlas a programas de Windows: para copiar carpetas con acentos usá PowerShell.
- `PAILA_SNAPSHOT` con la ventana oculta no corre animaciones: una pantalla abierta con `PAILA_SNAPSHOT_JS` puede salir vacía. Apagalas primero: `document.head.insertAdjacentHTML('beforeend','<style>*{animation:none!important;transition:none!important}</style>')`. La primera apertura con una carpeta de datos nueva también puede salir vacía: repetí.

## Antes de dar algo por terminado
`npm run verificar` (tipos, armado, tests y laboratorio; con `-- --rapido` si no tocaste el análisis de calidad); si es interfaz, verla funcionando con una copia de la base. Si tocaste el instalador, `npm run dist` y probarlo en una carpeta de prueba. Actualizá `docs/MAPA.md` si agregaste o moviste archivos. Si cambiás esta guía, cambiá también `AGENTS.md` (la de inglés).

## Si algo falla en la PC de alguien
Configuración → "Si algo anda mal" → **Exportar diagnóstico** arma un zip sin datos personales (versión, sistema, conteos, tiempos y errores, con las rutas y los nombres tapados). Lo que lleva está en `packages/core/diagnostic.ts`; el registro de errores, en `<datos>/registro/errores.log`.
