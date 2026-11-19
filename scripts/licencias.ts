// Licencias de terceros (Fase H): arma `apps/paila/build/AVISOS-DE-TERCEROS.txt` (viaja en el instalador y la portable) y
// el reporte `docs/licencias.md` (lo que viaja con la app y lo de desarrollo, por separado). Uso: `npm run licencias`.
// Lo revisa tests/licencias.test.ts: que los dos estén al día con package-lock.json y que nada choque con AGPL-3.0.
import fs from 'node:fs'
import path from 'node:path'

// se corre desde la raíz del repositorio (npm run licencias, npm test)
const ROOT = process.cwd()
export const AVISOS = path.join(ROOT, 'apps/paila/build/AVISOS-DE-TERCEROS.txt')
export const REPORTE = path.join(ROOT, 'docs/licencias.md')
export const REPO = 'https://github.com/epitelio-ar/PAILA'

/** Lo que va metido adentro del armado de la interfaz (electron-vite): está como devDependency pero viaja igual. */
const BUNDLED_ROOTS = ['react', 'react-dom', '@tanstack/react-virtual']

/**
 * Licencias que pueden viajar con PAILA (AGPL-3.0-or-later): todas aprobadas por OSI (lo pide SignPath) y compatibles.
 * GPL-3.0 solo como programa aparte (ffmpeg/ffprobe se ejecutan, no se enlazan); LGPL-2.1+ se puede llevar a GPL/AGPL.
 */
export const OK_SHIPPED = new Set(['MIT', 'ISC', 'BSD', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'LGPL-2.1-or-later', 'AGPL-3.0', 'AGPL-3.0-or-later', 'GPL-3.0-or-later'])

export interface Pkg { name: string; version: string; license: string; dev: boolean; bundled: boolean; dir: string | null; homepage: string | null }

/** La carpeta node_modules donde están las dependencias (en una copia de trabajo, la de la carpeta principal). */
function modulesDir(): string {
  for (let d = ROOT; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, 'node_modules', 'react', 'package.json'))) return path.join(d, 'node_modules')
    if (path.dirname(d) === d) throw new Error('No encuentro node_modules: corré npm install.')
  }
}

const licenseOf = (j: { license?: unknown; licenses?: { type: string }[] }) =>
  typeof j.license === 'string' ? j.license : j.licenses?.map((l) => l.type).join(' OR ') ?? 'sin dato'

/** Todos los paquetes de package-lock.json, marcando cuáles viajan con la app (`dev` = false o metidos en el armado). */
export function packages(): Pkg[] {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8')) as { packages: Record<string, { version?: string; license?: string; dev?: boolean; link?: boolean; dependencies?: Record<string, string> }> }
  const nm = modulesDir()
  const top = Object.entries(lock.packages).filter(([k, v]) => k.startsWith('node_modules/') && !k.slice(13).includes('node_modules/') && !v.link)
  const byName = new Map(top.map(([k, v]) => [k.slice(13), v]))
  const bundled = new Set<string>()
  const walk = (n: string) => { if (bundled.has(n) || !byName.has(n)) return; bundled.add(n); for (const d of Object.keys(byName.get(n)!.dependencies ?? {})) walk(d) }
  BUNDLED_ROOTS.forEach(walk)
  return top.map(([k, v]) => {
    const name = k.slice(13)
    const dir = fs.existsSync(path.join(nm, name, 'package.json')) ? path.join(nm, name) : null
    const j = dir ? JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) : {}
    const repo = typeof j.repository === 'string' ? j.repository : j.repository?.url
    return {
      name, version: v.version ?? j.version ?? '?', license: v.license ?? licenseOf(j),
      dev: !!v.dev && !bundled.has(name), bundled: bundled.has(name), dir,
      homepage: (j.homepage ?? repo ?? null)?.replace(/^git\+/, '').replace(/\.git$/, '') ?? `https://www.npmjs.com/package/${name}`,
    }
  }).sort((a, b) => a.name.localeCompare(b.name))
}

/** Los textos de licencia (y NOTICE, que pide Apache-2.0) que trae el paquete. */
function licenseTexts(dir: string | null): string[] {
  if (!dir) return []
  return fs.readdirSync(dir).filter((f) => /^(licen[cs]e|copying|notice)(\.(md|txt))?$/i.test(f)).sort()
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n').trim())
}

/**
 * Lo primero del README del ffmpeg para Windows de ffmpeg-static (b6.1.1). Va escrito acá y no leído de node_modules: en
 * Mac, npm baja el ffmpeg de Mac y el aviso tiene que salir igual en las dos (tests/licencias.test.ts).
 */
const WIN_FFMPEG = `FFmpeg 64-bit static Windows build from www.gyan.dev

Version: 6.1.1-essentials_build-www.gyan.dev

License: GPL v3

Source Code: https://github.com/FFmpeg/FFmpeg/commit/e38092ef93`

/** Los programas de ffmpeg que viajan aparte (GPL-3.0): de dónde salen y dónde está su código fuente. */
function ffmpegNotice(): string {
  const head = WIN_FFMPEG
  return `1. FFMPEG Y FFPROBE (programas aparte, GPL-3.0)
------------------------------------------------
PAILA usa dos programas de FFmpeg para leer y convertir audio: ffmpeg.exe y ffprobe.exe, los dos del mismo armado. Van
al lado de PAILA: ffmpeg.exe en resources\\app.asar.unpacked\\node_modules\\ffmpeg-static y ffprobe.exe en
resources\\ffprobe. PAILA los ejecuta como programas separados (no los enlaza) y no los modifica.

FFmpeg es software libre bajo la GNU General Public License versión 3 (GPL-3.0), porque estas versiones se armaron con
--enable-gpl --enable-version3. Tenés derecho a su código fuente. El texto de la licencia está al final de este archivo.

ffmpeg.exe (paquete ffmpeg-static, ${REPO_FF.ffmpeg}):
${head.split('\n').map((l) => `  ${l}`).join('\n')}
  Código fuente de FFmpeg: https://ffmpeg.org/download.html (versión 6.1.1: https://ffmpeg.org/releases/ffmpeg-6.1.1.tar.xz)
  Configuración del armado y bibliotecas incluidas: https://www.gyan.dev/ffmpeg/builds/

ffprobe.exe: del mismo armado que ffmpeg.exe (gyan.dev 6.1.1 "essentials": el mismo código fuente y la misma
  configuración), sacado de ffmpeg-6.1.1-essentials_build.7z (https://github.com/GyanD/codexffmpeg/releases/tag/6.1.1).

En Mac (PAILA para Mac, en prueba): ffmpeg y ffprobe son los armados para macOS que reparte el paquete ffmpeg-static
(versión b6.1.1: ${REPO_FF.ffmpeg}/releases/tag/b6.1.1), también GPL-3.0; ffmpeg y ffprobe son del mismo armado.
Van en PAILA.app/Contents/Resources/app.asar.unpacked/node_modules (ffprobe, en la carpeta del paquete ffprobe-static).
  Apple Silicon: ffmpeg y ffprobe 6.0. Intel: ffmpeg y ffprobe 6.1.1 (armado de evermeet.cx). Código fuente de FFmpeg 6.0:
  https://ffmpeg.org/releases/ffmpeg-6.0.tar.xz (la 6.1.1, arriba).
  Cómo se arman los de Intel: https://evermeet.cx/ffmpeg/

Código fuente junto a cada versión: en ${REPO}/releases, cada versión de PAILA trae adjunto el código fuente
exacto de los programas de FFmpeg que viajan con ella (ffmpeg-<versión>.tar.xz de ffmpeg.org, uno por versión de arriba) y
cómo se armaron ffmpeg.exe y ffprobe.exe de Windows, con la versión de cada biblioteca que llevan adentro
(ffmpeg-6.1.1-gyan-configuracion.txt). Qué es cada archivo: LEEME-codigo-fuente.txt, en la misma versión.
Oferta de código fuente: además, durante al menos tres años desde cada versión publicada de PAILA, el código fuente
completo de esos programas (también el de las bibliotecas que llevan adentro) se puede pedir en ${REPO}/issues.`
}
/** mpv (la salida "bit perfect"): el aviso de su carpeta (apps/paila/recursos/mpv/AVISO.txt), que dice versión y código fuente. */
function mpvNotice(): string {
  const aviso = fs.readFileSync(path.join(ROOT, 'apps/paila/recursos/mpv/AVISO.txt'), 'utf8').replace(/\r\n/g, '\n').trim().split('\n').slice(2).join('\n')
  return `1b. MPV (programa aparte, GPL-3.0)
----------------------------------
Va al lado de PAILA, en resources\\mpv (con su licencia completa en LICENCIA-mpv-GPL-3.0.txt).

${aviso}`
}
/** El sockseek con freno de NAPIA (GPL-3.0 y AGPL-3.0): su aviso completo va en su carpeta, con las licencias. */
const SOCKSEEK = `1c. SOCKSEEK CON FRENO (programa aparte de NAPIA, AGPL-3.0 y GPL-3.0)
---------------------------------------------------------------------
NAPIA busca y baja por Soulseek con sockseek.exe, que va en resources\\napia\\recursos\\sockseek. Es una versión
modificada (3.0.6-napia.2) de sockseek 3.0.6 (https://github.com/fiso64/sockseek, AGPL-3.0) armada con una versión
modificada de Soulseek.NET 10.0.2 (https://github.com/jpdillingham/Soulseek.NET, GPL-3.0 con términos adicionales); no la
mantienen ni la avalan sus autores. Qué cambia, sus licencias completas y el aviso de Soulseek.NET: AVISO.txt y los demás
.txt de esa carpeta. Código fuente: las dos versiones, el parche (apps/napia/sockseek-freno en ${REPO}) y cómo se arma
van adjuntos a cada versión de PAILA en ${REPO}/releases (sockseek-napia-fuente.tar.gz).`
const REPO_FF = { ffmpeg: 'https://github.com/eugeneware/ffmpeg-static', ffprobe: 'https://github.com/joshwnj/ffprobe-static' }

const MIT = (autor: string) => `  Copyright (c) ${autor}

  Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
  documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
  rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
  persons to whom the Software is furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
  Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
  WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
  COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
  OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`

const NOT_INCLUDED = `4. BEAT THIS! (VIAJA CON PAILA) Y LO QUE NO VIENE
---------------------------------------------------
Beat This! (la grilla y los golpes de Rekordbox) viaja en el instalador y en la portable, en la carpeta resources\\modelos
del programa. Quien prefiera otro modelo puede elegir su carpeta en PAILA (ver docs/compartir.md en el repositorio).
Son cuatro cosas, las cuatro con licencia MIT:

- Beat This! (beat_this.onnx, ~191 MB, y mel-filterbank.bin): los pesos del modelo "final0" de la Universidad Johannes
  Kepler de Linz (CPJKU), https://github.com/CPJKU/beat_this. Foscarin, Schlüter y Widmer, "Beat this! Accurate beat
  tracking without DBN postprocessing", ISMIR 2024. La conversión a ONNX es de musetric,
  https://huggingface.co/musetric/beat-this-onnx, que conserva la licencia MIT de los pesos.

${MIT('2024 Institute of Computational Perception, JKU Linz, Austria')}

- onnxruntime-web 1.30.0 y onnxruntime-common 1.30.0 (el programa que corre el modelo, con el procesador y con la placa
  de video): Microsoft, https://github.com/microsoft/onnxruntime

${MIT('Microsoft Corporation')}

No viene con PAILA: los modelos de aprendizaje de Essentia (Discogs-EffNet y otros) son CC BY-NC-SA 4.0
(solo uso no comercial). PAILA no los trae ni los usa hoy. Si algún día se usan, van como descarga opcional, nunca en el
instalador.`

const CHROMAPRINT = `3. CÓDIGO ADAPTADO DE OTROS PROYECTOS
-------------------------------------
- Chromaprint (huella acústica de AcoustID): packages/core/analysis/chromaprint.ts es un port a TypeScript del algoritmo
  de Chromaprint 1.6, https://github.com/acoustid/chromaprint. El código propio de Chromaprint es MIT; la parte LGPL-2.1
  de Chromaprint (el remuestreador que viene de FFmpeg) no se copió: PAILA remuestrea con el ffmpeg de arriba.

  Copyright (C) 2010-2016 Lukas Lalinsky

  Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
  documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
  rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
  persons to whom the Software is furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
  Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
  WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
  COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
  OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`

/** libarchive dentro de libarchive-wasm (abrir los RAR y los ZIP raros, core/archive/libarchive.ts): el paquete no trae los textos. */
const LIBARCHIVE = `4c. LIBARCHIVE (ABRIR LOS RAR Y LOS ZIP DE LA BIBLIOTECA)
---------------------------------------------------------
PAILA descomprime los RAR (y los ZIP con métodos raros) con libarchive 3.7.7, https://www.libarchive.org, compilado a
WebAssembly en el paquete libarchive-wasm 1.2.0 (MIT, Copyright (c) ofk, https://github.com/ofk/libarchive-wasm).
El lector de RAR de libarchive está escrito de cero a partir del formato: no usa el código de unRAR, cuya licencia no
deja repartirlo con programas libres. Los índices de los ZIP y los RAR los lee código propio de PAILA
(packages/core/archive/zipread.ts y rarread.ts, escritos a partir de la descripción pública de los formatos).

libarchive (licencia BSD de 2 cláusulas):

  Copyright (c) 2003-2018 Tim Kientzle and the libarchive authors. All rights reserved.

  Redistribution and use in source and binary forms, with or without modification, are permitted provided that the
  following conditions are met:
  1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following
     disclaimer in this position and unchanged.
  2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the
     following disclaimer in the documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE AUTHOR(S) "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
  THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE
  AUTHOR(S) BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT
  NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
  HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR
  OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

En el mismo armado vienen tres bibliotecas de compresión:
- zlib 1.3.1 (licencia zlib), Copyright (C) 1995-2024 Jean-loup Gailly and Mark Adler, https://zlib.net. "This
  software is provided 'as-is', without any express or implied warranty. Permission is granted to anyone to use this
  software for any purpose, including commercial applications, and to alter it and redistribute it freely", siempre que
  no se tergiverse su origen, las versiones cambiadas lo digan y no se quite este aviso.
- liblzma 5.6.4 (de XZ Utils; BSD Zero Clause), https://tukaani.org/xz/.
- bzip2 1.0.8 (licencia tipo BSD), Copyright (C) 1996-2019 Julian R Seward, https://sourceware.org/bzip2/. Se puede
  redistribuir en forma binaria conservando este aviso; el nombre del autor no se usa para promocionar productos.`

/** La letra de los títulos (packages/diseno/letras/): Anton, SIL Open Font License 1.1. */
function letraNotice(): string {
  const ofl = fs.readFileSync(path.join(ROOT, 'packages/diseno/letras/OFL-Anton.txt'), 'utf8').replace(/\r\n/g, '\n').trim()
  return `4b. LETRA DE LOS TÍTULOS
------------------------
- Anton (https://github.com/googlefonts/AntonFont), viaja dentro de la interfaz de PAILA y NAPIA. Licencia SIL Open Font
  License 1.1 (OFL-1.1), que permite usarla, empaquetarla y redistribuirla con programas libres o no.

${ofl}`
}

/** El texto de AVISOS-DE-TERCEROS.txt. */
export function avisos(list = packages()): string {
  const shipped = list.filter((p) => !p.dev)
  const libs = shipped.map((p) => {
    const texts = licenseTexts(p.dir)
    return `== ${p.name} ${p.version} (${p.license})${p.bundled ? ', dentro de la interfaz' : ''}\n${p.homepage}\n\n${texts.length ? texts.join('\n\n') : `(el paquete no trae el texto; licencia ${p.license})`}`
  }).join('\n\n\n')
  // la GPL-3.0 entera: la misma que trae ffmpeg-static, guardada junto a mpv (así sale igual armando en Windows o en Mac)
  const gpl = fs.readFileSync(path.join(ROOT, 'apps/paila/recursos/mpv/LICENCIA-mpv-GPL-3.0.txt'), 'utf8').replace(/\r\n/g, '\n').trim()
  return `AVISOS DE TERCEROS — PAILA y NAPIA
==================================

PAILA y NAPIA son software libre bajo la GNU Affero General Public License versión 3 o posterior (AGPL-3.0-or-later).
Código fuente: ${REPO} (el archivo LICENSE tiene el texto completo).

Este archivo lista lo que hicieron otros y viaja con PAILA, con su licencia. Electron y Chromium (el motor de la
ventana) tienen sus avisos en LICENSE.electron.txt y LICENSES.chromium.html, en la carpeta del programa.
Se arma solo con \`npm run licencias\`; no editarlo a mano.


${ffmpegNotice()}


${mpvNotice()}


${SOCKSEEK}


2. BIBLIOTECAS QUE VIAJAN DENTRO DE PAILA (${shipped.length})
--------------------------------------------
${shipped.map((p) => `- ${p.name} ${p.version}: ${p.license}`).join('\n')}


${CHROMAPRINT}


${NOT_INCLUDED}


${letraNotice()}


${LIBARCHIVE}


5. TEXTOS DE LAS LICENCIAS DE LAS BIBLIOTECAS
---------------------------------------------

${libs}


6. GNU GENERAL PUBLIC LICENSE, VERSIÓN 3 (FFmpeg)
-------------------------------------------------

${gpl}
`
}

/** Licencias que no están en la lista de las que pueden viajar (vacío = todo en orden). */
export const clashes = (list: Pkg[]) => list.filter((p) => !p.dev && !OK_SHIPPED.has(p.license))

/** El reporte para leer: tablas por grupo y conteo de licencias de desarrollo. */
export function reporte(list = packages()): string {
  const shipped = list.filter((p) => !p.dev)
  const dev = list.filter((p) => p.dev)
  const count = (ps: Pkg[]) => [...ps.reduce((m, p) => m.set(p.license, (m.get(p.license) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1])
  const row = (p: Pkg) => `| ${p.name} | ${p.version} | ${p.license} |`
  const bad = clashes(list)
  return `# Licencias de las dependencias

Se arma solo con \`npm run licencias\` (junto con \`apps/paila/build/AVISOS-DE-TERCEROS.txt\`); no editar a mano. Qué quiere decir cada cosa y qué falta decidir: \`docs/compartir.md\`.

**Choques con AGPL-3.0 o con SignPath (licencias fuera de la lista de \`scripts/licencias.ts\`):** ${bad.length ? bad.map((p) => `${p.name} (${p.license})`).join(', ') : 'ninguno'}.

## Viajan con la app (${shipped.length})
Las dependencias de PAILA en el instalador y la portable, más lo que se mete adentro de la interfaz al armar. Aparte: ffmpeg y ffprobe (GPL-3.0, programas separados), Electron/Chromium (MIT y los avisos de Chromium) y la letra Anton de los títulos (OFL-1.1, packages/diseno/letras/).

${count(shipped).map(([l, n]) => `${l}: ${n}`).join(' · ')}

| Paquete | Versión | Licencia |
|---|---|---|
${shipped.map(row).join('\n')}

## Solo para desarrollo (${dev.length})
Herramientas para armar y probar (TypeScript, vite, electron-builder, vitest…). No viajan con la app.

${count(dev).map(([l, n]) => `${l}: ${n}`).join(' · ')}

| Paquete | Versión | Licencia |
|---|---|---|
${dev.map(row).join('\n')}
`
}

// npm run licencias: escribe los dos archivos.
if (process.argv[1] && /licencias/.test(path.basename(process.argv[1]))) {
  const list = packages()
  fs.writeFileSync(AVISOS, avisos(list).replace(/\n/g, '\r\n'))
  fs.writeFileSync(REPORTE, reporte(list))
  const bad = clashes(list)
  process.stdout.write(`AVISOS-DE-TERCEROS.txt y docs/licencias.md al día (${list.filter((p) => !p.dev).length} viajan, ${list.filter((p) => p.dev).length} de desarrollo).\n`)
  if (bad.length) { process.stdout.write(`Ojo, licencias para revisar: ${bad.map((p) => `${p.name} (${p.license})`).join(', ')}\n`); process.exitCode = 1 }
}
