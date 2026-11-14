# Lista para compartir (Fase H)

*Repasada el 13/11/2026 con la 0.5.36.*

Qué hay listo para que otros instalen PAILA, qué choca con algo y **qué falta decidir** (lo decide el dueño del proyecto: hacer público el repositorio, firmar y publicar versiones). La lista de dependencias con su licencia se arma sola: `docs/licencias.md` (`npm run licencias`).

## 1. Licencias

PAILA y NAPIA son **AGPL-3.0-or-later**. Lo que viaja con la app:

| Qué | Licencia | Cómo viaja | ¿Choca? |
|---|---|---|---|
| 34 bibliotecas de npm (React, taglib, Essentia, sus dependencias) | MIT, ISC, BSD, Apache-2.0, LGPL-2.1+, GPL-3.0+, AGPL-3.0 | dentro del programa | No: todas compatibles con AGPL-3.0 y aprobadas por OSI |
| **Essentia** (`essentia.js`, BPM y tono) | AGPL-3.0 | dentro | No: es la misma familia de licencia que PAILA. Es la razón por la que PAILA tiene que ser AGPL |
| **node-taglib-sharp** (tags) | LGPL-2.1+ | dentro | No: LGPL se puede combinar con AGPL |
| **Chromaprint** (huella acústica) | MIT (código propio) + LGPL-2.1 (un remuestreador de FFmpeg) | port a TypeScript en `packages/core/analysis/chromaprint.ts` | No. El masterplan lo daba como LGPL; en realidad lo que se portó es la parte MIT, y el remuestreo lo hace el ffmpeg de siempre. El aviso MIT va en AVISOS-DE-TERCEROS |
| **ffmpeg.exe** 6.1.1 (gyan.dev) | GPL-3.0 | programa aparte (`app.asar.unpacked`), se ejecuta, no se enlaza | No con AGPL (son compatibles y además es un programa separado). **Pide ofrecer su código fuente**: ver abajo |
| **ffprobe.exe** 6.1.1 (gyan.dev, el mismo armado que ffmpeg) | GPL-3.0 | programa aparte (`resourcesfprobe`) | No: igual que ffmpeg. En Mac, el de ffprobe-static (4.4 y 4.0.2), ver "Ojo" |
| Electron y Chromium | MIT y los avisos de Chromium | el motor de la ventana | No. Sus avisos van solos en la carpeta del programa (`LICENSE.electron.txt`, `LICENSES.chromium.html`) |
| Íconos, mascota y letra | propios / letras del sistema (Segoe, Consolas) | — | No: PAILA no trae letras ni íconos de otros |

**Herramientas de desarrollo** (383 paquetes: TypeScript, vite, vitest, electron-builder…): no viajan con la app, así que su licencia no cuenta para el instalador. Hay de todo lo común (MIT, ISC, Apache, BSD, BlueOak, CC-BY-4.0 para datos de navegadores, Python-2.0 para `argparse`): nada raro.

### Qué va en el instalador y en la portable
`AVISOS-DE-TERCEROS.txt` en la carpeta del programa (al lado de `PAILA.exe`; en la portable, adentro). Tiene:
1. ffmpeg y ffprobe: de dónde salen, su licencia GPL-3.0, dónde está su código fuente y la oferta de código fuente;
2. la lista de bibliotecas con su licencia;
3. el aviso MIT de Chromaprint;
4. Beat This! y onnxruntime-web (MIT, viajan con PAILA), y los modelos de Essentia, que **no** vienen con PAILA;
5. el texto de cada licencia y el de la GPL-3.0 completa.

`tests/licencias.test.ts` falla si alguien suma una dependencia con una licencia fuera de la lista o si el archivo quedó viejo.

### Ojo (para decidir)
1. ~~ffprobe es viejo y su origen ya no existe.~~ **Hecho en Windows (24/10, con el OK del autor):** `npm run ffprobe:bajar` (`scripts/ffprobe-bajar.mjs`) saca `ffprobe.exe` de `ffmpeg-6.1.1-essentials_build.7z` (GyanD/codexffmpeg, el archivo de gyan.dev), revisado con la huella del .7z y la del programa (ese .7z trae un `ffmpeg.exe` idéntico byte a byte al de ffmpeg-static: es el mismo armado). Queda en `apps/paila/recursos/ffprobe` (no va a git), el instalador lo lleva a `resourcesfprobe`, `dist`/`pack` no arman sin él (`preparar-instalador.mjs`, revisado por huella) y `packages/core/probe.ts` lo busca ahí primero; los ffprobe de ffprobe-static ya no viajan en Windows. Qué cambió en lo que se lee: `docs/pruebas/2026-10-24-armado-github.md`. **Pendiente: en Mac sigue el de ffprobe-static** (4.4 en Apple Silicon, 4.0.2 de Zeranoe en Intel); el paquete queda solo para eso. Lo que decía antes: `ffprobe-static` trae un ffprobe 4.0.2 de 2018, armado por Zeranoe (que cerró en 2020). Funciona, pero: (a) para cumplir la GPL hay que poder dar el código fuente exacto de lo que se reparte, y de ese armado ya no se puede (solo el de FFmpeg 4.0.2 en general); (b) es un programa de 2018 que lee archivos que vienen de cualquier lado. **Propuesta:** usar el ffprobe del mismo armado que el ffmpeg (gyan.dev 6.1.1, que trae los dos) y sacar `ffprobe-static`. Es bajar un programa nuevo: lo tiene que aprobar el dueño del proyecto. Es un cambio chico (dónde se busca ffprobe en `packages/core/probe.ts`) pero hay que pasar el laboratorio (`npm run corpus`) porque cambia lo que se lee de cada archivo.
2. ~~Código fuente de ffmpeg al publicar.~~ **Hecho (24/10):** el armado de GitHub adjunta a cada versión el código fuente de lo GPL que viaja (`scripts/fuentes-gpl.mjs`, ~53 MB): los `ffmpeg-<versión>.tar.xz` de ffmpeg.org de cada versión que va (6.1.1, 6.0, 4.4 y 4.0.2, revisados con su huella), la configuración del armado de gyan.dev con la versión de cada biblioteca (`ffmpeg-6.1.1-gyan-configuracion.txt`), mpv (el de su commit, la receta de shinchiro de esa fecha y el 0.41.0 de Mac), el sockseek con freno (las dos versiones de arriba, el parche y cómo se arma) y un `LEEME-codigo-fuente.txt`. AVISOS-DE-TERCEROS y los AVISO.txt de mpv y sockseek dicen que está ahí. Lo que no va adjunto es el código de cada biblioteca que llevan adentro ffmpeg y mpv (x264, libass…): queda la oferta de pedirlo durante tres años.
3. **SignPath y los modelos.** SignPath pide que todo lo que va firmado sea de código abierto. El instalador y la portable llevan Beat This! (MIT, de código abierto: no choca) pero ninguno de Essentia (CC BY-NC-SA, no comercial, que PAILA hoy no usa). Si algún día se usan los de Essentia, tienen que seguir como descarga aparte.
4. **Las claves de Discogs y AcoustID "de PAILA"** (`claves.local.json`) se meten adentro del instalador al armar. En un repositorio público y con armado automático, esas claves tienen que ir como secretos de GitHub o no ir. El armado de GitHub las arma desde los secretos `DISCOGS_KEY`, `DISCOGS_SECRET`, `ACOUSTID` y `LASTFM` (`scripts/claves-ci.mjs`); sin secretos arma sin claves y cada uno pega las suyas en Configuración (PAILA anda igual, con menos fuentes). **Decidido (22/10): sí se ponen.** En el armado local, desde `claves.local.json` (los valores se pegan a mano; nunca en el chat ni en git). En el armado de GitHub, como secretos de GitHub que carga el dueño del repositorio en la Fase H. Tienen que ser claves **de aplicación**: Discogs = Consumer Key/Secret de una app registrada (no el token personal); AcoustID = clave de aplicación (no la de usuario). **AudD no va**: es paga y por cuenta, cada uno pone la suya (DECISIONES 20/10).

## 2. Beat This! (viaja con PAILA; `models_dir` sirve para otro)

La grilla y los cue points con Beat This! necesitan una **carpeta de modelos**. Desde el 22/10 **viaja siempre con PAILA**, en el instalador y en la portable, en `resources\modelos`: PAILA la usa sola, sin pedir nada. Ocupa unos 230 MB en el disco y suma ~165 MB a la descarga. Tres cosas:
- **Armar el instalador o la portable:** `npm run modelos:armar -- --desde <carpeta de modelos completa>` deja la copia mínima en `apps/paila/recursos/modelos` (solo el modelo, su filtro y lo que usa onnxruntime-web con el procesador y con la placa de video; no los ~4,7 GB de un `npm install`); `extraResources` la lleva a `resources/modelos`. `npm run dist` y `npm run pack` no arman sin ella; si falta, la traen solos de PAILA_MODELOS, de la carpeta principal del proyecto o de PAILA instalada (`scripts/preparar-instalador.mjs`), y si no la encuentran dicen en una línea qué hacer. Lo mismo con el sockseek con freno (PAILA_SOCKSEEK, `npm run sockseek:freno`).
- **La portable** se descomprime en una carpeta temporal cada vez que se abre: con el modelo adentro, el primer arranque tarda más que antes.
- **A mano:** en PAILA → Rekordbox → "Elegir la carpeta de Beat This!…" (sirve si tenés la carpeta en otro lado; gana sobre la del instalador mientras ande). Adentro tiene que haber (~330 MB si se arma con `npm install` entero):

```
<carpeta de modelos>/
  beat-this/beat_this.onnx       (190.649.026 bytes, SHA-256 1337dc6c21257ed6b803418efc320df42b5d8eb296ef16648ef60457cd4b9e55)
  beat-this/mel-filterbank.bin   (262.656 bytes,     SHA-256 1ee975d96f44ccf2c3bfe37825c1c1f0b089f5703c7a12a84b1f0a3bce004533)
  npm/node_modules/onnxruntime-web   (versión 1.30.0)
```

Cómo armarla (en una carpeta nueva y vacía):
1. **El modelo:** de `https://huggingface.co/musetric/beat-this-onnx` bajar `beat_this.onnx` y `mel-filterbank.bin` a `beat-this/`. Es la conversión a ONNX del checkpoint `final0` de Beat This! (CPJKU, Universidad Johannes Kepler de Linz, https://github.com/CPJKU/beat_this), licencia MIT. Comprobar las huellas de arriba (`certutil -hashfile beat_this.onnx SHA256`).
2. **onnxruntime-web:** en `npm/`, `npm install onnxruntime-web@1.30.0` (Microsoft, MIT).

Pendiente para más adelante (no es de esta fase): que PAILA lo baje sola con un botón, verificando las huellas.

## 3. Actualizaciones automáticas

- **Cómo funciona:** al abrir (un minuto después, para no frenar el arranque) PAILA pide `latest.yml` a `https://github.com/epitelio-ar/PAILA/releases/latest/download`. Si hay una versión más nueva, aparece un aviso abajo a la derecha: **Actualizar**, **Ahora no** (avisa la próxima vez) o **No avisar de esta**. Se baja en segundo plano, se comprueba la huella SHA-512 y, si este PAILA está firmado, que el nuevo tenga la misma firma. Después: **Instalar ahora** (cierra, instala sin preguntas y vuelve a abrir) o **Al cerrar PAILA**. Nunca se instala sin que la persona lo pida, y nunca en medio de algo que escribe archivos.
- **La portable** no se reemplaza sola: el aviso abre la página de la versión.
- En Configuración → Actualizaciones: "Buscar versiones nuevas al abrir" (se puede apagar) y "Buscar ahora".
- **Hoy está apagado** (`pailaActualizaciones.activas: false` en `apps/paila/package.json`): Configuración dice "Todavía no hay versiones publicadas". Se prende poniendo `true` en la versión que se publique primero (la 1.0.0). Las versiones de antes no buscan solas: quien tenga una 0.5 instala la 1.0 a mano, y de ahí en adelante se actualiza sola.
- **Con el repo público:** `releases/latest` de GitHub muestra solo la última versión **publicada** (ni borradores ni pre-versiones), así que una versión recién se ofrece cuando se toca "Publish release". Mientras no haya ninguna, GitHub contesta 404 y PAILA lo toma como "no hay versión nueva", sin error. El `publish` de electron-builder (`provider: github`, `releaseType: draft`) sirve para que arme `latest.yml` y el `app-update.yml` que va adentro del programa; electron-builder no sube nada (el armado lo llama con `--publish never` y el borrador lo crea `gh release create --draft`), y PAILA no usa `app-update.yml` (es de electron-updater).
- Se eligió un actualizador propio chico (`packages/core/updates.ts`, ~130 líneas) en vez de `electron-updater` para no sumar dependencias: usa el mismo `latest.yml` que ya arma electron-builder, así que se puede cambiar a electron-updater más adelante sin tocar las versiones publicadas.
- **Probado** con un servidor local (nunca GitHub): `tests/updates.test.ts` y una prueba de punta a punta con la app instalada (bitácora `docs/archivo/pruebas/2026-10-21-compartir.md`). Para repetirla: `PAILA_UPDATE_FEED=http://127.0.0.1:<puerto>/` con `latest.yml` y el instalador en esa carpeta.

## 4. Exportar diagnóstico

Configuración → "Si algo anda mal" → **Exportar diagnóstico…**: muestra cada archivo del zip con su contenido exacto y recién después pregunta dónde guardarlo. Lleva:
- `programa-y-pc.json`: versión de PAILA, Electron y Windows, procesador, memoria, si ffmpeg está;
- `biblioteca.json`: cuántos temas, por formato, nota y colección, y filas por tabla;
- `tiempos.json`: cuánto tardó en abrir y el análisis por formato (mediana y el 90 %);
- `errores-agrupados.json`: errores al leer y analizar, agrupados;
- `ajustes.json`: qué ajustes hay (el valor solo de los que no pueden tener datos);
- `registro-de-errores.txt`: los últimos 500 errores del programa (`<datos>/registro/errores.log`, que empezó a existir con esta fase).

**No lleva** música, nombres de temas, carpetas, playlists ni discos, rutas, claves, el usuario de Windows ni la base. Todo texto pasa por `scrub` (`packages/core/errorlog.ts`), que tapa rutas, lo que va entre comillas, nombres de archivo de audio, correos y cadenas con forma de clave; además se tapan los nombres de las carpetas raíz y de los discos. `tests/diagnostic.test.ts` arma una biblioteca con nombres inventados y comprueba que ninguno se escape.

## 5. Firma con SignPath (preparado, sin activar)

Para que Windows no diga "editor desconocido". **SignPath Foundation** firma gratis proyectos de código abierto. Lo que piden (según sus condiciones, revisadas el 19/10) y cómo está PAILA:

| Piden | PAILA hoy |
|---|---|
| Repositorio público | Sí, desde la 1.0: `epitelio-ar/PAILA` |
| Licencia aprobada por OSI | Sí: AGPL-3.0 |
| Sin partes cerradas ni con licencia no libre en lo que se firma | Sí (ver la sección 1) |
| Armado automático en un servicio de CI (GitHub Actions), sin firmar desde una PC | Listo: `.github/workflows/version.yml` |
| Solo se firma lo propio | Sí: `.signpath/artifact-configuration.xml` firma `PAILA.exe`, el instalador y la portable, nunca ffmpeg ni ffprobe |
| Una página de "política de firma" en el sitio o el README, que diga quién aprueba cada versión | Sí: la sección "Firma de los instaladores" del README |
| Las personas con permiso de publicar, con verificación en dos pasos en GitHub | Sí: prendida en la cuenta del dueño (13/11) |
| El proyecto ya publicado y con algo de uso | La firma se pide después de la 1.0, la primera versión pública |

**Cómo está armado** (`.github/workflows/version.yml`, corre solo a mano desde Actions). Tres trabajos:
- **Windows** (`windows-latest`):
  1. baja ffprobe y mpv (`npm run ffprobe:bajar` y `npm run mpv:bajar`, versiones fijas y con huella) y corre tipos y tests;
  2. consigue lo que no está en el repositorio, siempre de una versión fija: Beat This! (`npm run modelos:armar -- --bajar`: Hugging Face con huella SHA-256, y onnxruntime-web de npm) y el sockseek con freno (`armar.ps1` con .NET 10; `npm run sockseek:freno -- --desde` revisa que diga "-napia"). Los dos quedan guardados entre corridas (caché de GitHub);
  3. arma `claves.local.json` con los secretos (`scripts/claves-ci.mjs`); sin secretos, sin claves;
  4. arma la carpeta del programa (`npm run pack`), prueba que lo que viaja arranque (ffmpeg, ffprobe, mpv, sockseek, el modelo) y saca una captura de PAILA y de NAPIA; **si SignPath está configurado**, firma `PAILA.exe`;
  5. arma el instalador y la portable con esa carpeta (`--prepackaged`) y los firma;
  6. rehace `latest.yml` con la huella del instalador firmado (`scripts/version-firmada.ts`; si no, la actualización lo rechazaría);
  7. junta el código fuente GPL (`scripts/fuentes-gpl.mjs`).
- **Mac** (`macos-15`): llama a `mac.yml` (el mismo armado que se prueba en Mac): tipos, tests, los dos .dmg (Apple Silicon e Intel) sin firma y una captura. Se puede apagar con la entrada "mac".
- **Borrador** (solo si se pide con "publicar"): crea en GitHub Releases un borrador `v<versión>`, marcado en el commit que se armó, con el instalador, la portable, `latest.yml`, los dos .dmg y el código fuente. Publicarlo es a mano.

Sin configurar SignPath, el mismo armado funciona y deja todo sin firmar.

### Lanzar el armado en GitHub

Antes, una sola vez:
1. **Secretos de las claves** (GitHub → Settings → Secrets and variables → Actions → New repository secret), los valores de `claves.local.json` de la PC de armado: `DISCOGS_KEY` (Consumer Key de la app de Discogs), `DISCOGS_SECRET` (Consumer Secret), `ACOUSTID` (clave de aplicación) y, si se usa, `LASTFM`. Los secretos no se ven en el registro de la corrida ni en los pedidos de cambio de otros. Sin ellos, arma igual, sin claves.
2. Que la versión esté subida (`npm run version:subir -- X.Y.Z`, con su entrada en NOVEDADES) y en `main`.

Lanzarlo: Actions → "Armar versión" → Run workflow → rama `main`, con "publicar" marcado si ya es la versión de verdad (sin marcar, arma todo y lo deja para bajar en la corrida, sin borrador). Tarda unos 25–35 minutos la primera vez (la de Mac es la más larga) y menos después, porque el modelo y el sockseek quedan guardados.

Qué tiene que dar:
- todos los trabajos en verde; en el resumen de la corrida, los archivos `PAILA-X.Y.Z-sin-firmar` (o `PAILA-X.Y.Z` con firma), `PAILA-mac-sin-firmar`, `codigo-fuente-gpl` y las capturas `capturas-win` y `capturas-mac`;
- en el paso "Probar la carpeta armada", la versión de ffmpeg y ffprobe (6.1.1-essentials_build-www.gyan.dev los dos), mpv (v0.41.0-…) y sockseek (3.0.6-napia.2), y sin el aviso "no dejó su captura";
- con "publicar": un borrador en Releases con `PAILA-instalador-X.Y.Z.exe`, `PAILA-portable-X.Y.Z.exe`, `latest.yml`, `PAILA-mac-arm64-X.Y.Z.dmg`, `PAILA-mac-x64-X.Y.Z.dmg` y los 11 archivos del código fuente. Antes de publicarlo: bajar el instalador, instalarlo en una PC sin PAILA, ver que abra, que Configuración → Discogs diga que trae clave (si se cargaron los secretos), y escribir la nota.

Si falla:
- **mpv:** shinchiro guarda unos 30 días de versiones. Si la fijada ya no está, `npm run mpv:bajar -- --ultima` en la PC baja la última y dice qué poner en `scripts/mpv-bajar.mjs`; también hay que actualizar `apps/paila/recursos/mpv/AVISO.txt` y `npm run licencias`. El código fuente adjunto sigue solo a la versión nueva.
- **Beat This! o sockseek:** son versiones fijas (Hugging Face por commit, GitHub por etiqueta): si cambió una huella, no se usa y la corrida corta. No "arreglarlo" cambiando la huella sin mirar qué cambió.

Probado en esta PC el 24/10 (sin lanzar nada en GitHub): mpv con su huella, Beat This! con `--bajar`, el sockseek con `armar.ps1` y .NET 10 (93 s), las claves con y sin secretos, el código fuente (11 archivos, 53 MB) y el armado de Windows con los mismos comandos (ver la bitácora `docs/pruebas/2026-10-24-armado-github.md`). Lo que solo se ve en GitHub: el caché, la llamada a `mac.yml`, la subida de archivos y el borrador.

**Para prenderlo, cuando SignPath apruebe el proyecto:**
1. En SignPath: crear el proyecto `PAILA`, la política `release-signing` y las dos configuraciones de `.signpath/artifact-configuration.xml` (slugs `programa` e `instaladores`), y conectar el repositorio de GitHub.
2. En GitHub → Settings → Secrets and variables → Actions: el secreto `SIGNPATH_API_TOKEN` y la variable `SIGNPATH_ORGANIZATION_ID` (y `SIGNPATH_POLICY` si la política se llama distinto).
3. Si se quiere armar al poner una etiqueta `v1.0.0`, descomentar `push: tags` en el workflow.

