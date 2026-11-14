# Guide to working on PAILA (people and coding agents)

*English · [Castellano](AGENTS.es.md)*

PAILA is a free desktop app (AGPL-3.0-or-later) for **anyone with a lot of music piled up**: see the real quality of each file, fix tags and folders, build playlists, find duplicates and free up space. The DJ features (BPM and key, beat grid, Rekordbox) are one part, not the center. NAPIA is its sibling: a panel for using sockseek (the program that downloads from Soulseek).

This guide is for any agent (Claude Code, Codex, Copilot, Cursor…) or person who writes code. It doesn't depend on any particular computer. The project's own docs, comments and code names are in Spanish (Rioplatense); the app speaks Spanish and English.

## Before touching anything
- `docs/MAPA.md`: one line per file. Look there and read only the piece you need: **every file starts with 1–2 lines saying what it does**.
- What's done and what's next: the repository's issues and each version's release notes (`docs/NOVEDADES.en.md`).
- Many comments cite logs (`docs/pruebas/…`, `docs/archivo/…`), the kit for tests with people (`docs/prueba-personas/`) and plans (`MASTERPLAN-n`, `docs/DECISIONES.md`) that aren't in this repository: they belong to the development repository and aren't published because they hold data from a real library. They stay as a pointer to where each decision came from.
- `docs/GLOSARIO.md`: the interface words (the same across the whole app), with their English version.

## Product rules (non-negotiable)
1. **PAILA doesn't break anything.** Nothing is really deleted: there's its own trash (`_PAILA`) and the only real deletion is "Empty trash", by hand.
2. **Every change to files goes through "Pending changes"**: preview, apply with a backup and a check, and undo from the History.
   - **Everything that writes files goes through the single engine** (`packages/core/ops/`): the batch's prechecks (`checks.ts`), the journal, checking and confirming (`run.ts`), what goes outside your Music (`copy.ts`) and the backup of what changes inside files (`backup.ts`).
   - On screen, confirm with `ConfirmarBoton` and show the result with `Resultado` (`apps/paila/ui/src/Confirmar.tsx`).
   - A new feature doesn't build its own path.
3. **Sample packs are never renamed or reorganized** (`kind = 'produccion'`).
4. `PIONEER` folders (Rekordbox USB export) and Ableton projects are excluded automatically.
5. **PAILA doesn't download music.**
6. Made to be shared: **nothing tied to one computer** (no paths, drive letters or user names). Drives are recognized by serial number.
7. Privacy: what goes out to the internet is only artist, title, duration or the acoustic fingerprint (and 15 s of audio with AudD, which is off by default). Keys are stored encrypted and never come back to the interface or the logs.

## How it's built
Electron 43 + React 19 + TypeScript (electron-vite 5), Node's built-in SQLite (`node:sqlite`), ffmpeg from `ffmpeg-static` and ffprobe from the same build (gyan.dev 6.1.1, `npm run ffprobe:bajar`; on Mac, `ffprobe-static`), never from the PATH, BPM and key with `essentia.js`. One repository with npm workspaces:

- `apps/paila`: the app (`electron/` = main process, `ui/src/` = interface, `build/` = icons, installer and license notices).
- `apps/napia`: NAPIA. PAILA's installer carries it inside (`PAILA.exe --napia`).
- `packages/core` (`@paila/core/…`): **all the logic, without an interface and with tests**.
- `packages/shared` (`@paila/shared/…`): the contract between processes (types and `PailaApi`) and the languages (`idioma.ts`).
- `packages/diseno` (`@paila/diseno`): shared tokens, components and icons.
- `tests/`, `scripts/` and `docs/` at the root.

Packages are imported by name (`@paila/core/db`), never with `../../`.

**A new feature almost always touches, in this order:** `packages/core/` → `packages/shared/types/<area>.ts` → `apps/paila/electron/ipc/<area>.ts` + `apps/paila/electron/preload.ts` → `apps/paila/ui/src/`. A request travels: interface `window.paila.something()` → preload → IPC → function in `packages/core/` → database.

## Commands
```bash
npm install
npx install-electron          # Electron downloads its binary separately
npm run ffprobe:bajar         # on Windows: the ffprobe that ships with PAILA (gyan.dev 6.1.1, checked by hash)
npx tsc --noEmit -p tsconfig.json
npm test                      # includes the style rules (tests/estilo.test.ts) and the license rules
npm run build                 # builds NAPIA and PAILA
npm run corpus                # lab of tricky files (before merging changes in packages/core)
npm run verificar             # everything together and in order: types, build, tests and lab (-- --rapido: the quick lab)
npm run tema -- <file>        # everything PAILA sees and decides about a track (read-only; --json, --base <copy.db>)
npm run textos -- <file>      # the loose texts (without their English pair) of a screen; with no file, how many are left in each
npm run capturas              # goes through ALL the screens of PAILA and NAPIA (studio, comic and booth) into capturas/<date>
npm run capturas:comparar -- <before> <after>   # compares two screenshot folders and builds a sheet (lamina.html)
npm run turnos                # who's using what (music copy, measurement, lab, verification)
npm run version:subir -- X.Y.Z # bumps the version of PAILA and NAPIA (first, its entry in docs/NOVEDADES.md)
npm run dist                  # installer and portable in apps/paila/dist (publishes nothing)
npm run licencias             # rebuilds AVISOS-DE-TERCEROS.txt and docs/licencias.md
```
npm only runs the install scripts approved in `allowScripts` in `package.json`.

Open the built app: `node_modules/electron/dist/electron.exe apps/paila`.

Variables for development and testing:
| Variable | What it does |
|---|---|
| `PAILA_USER_DATA=<folder>` | Uses another data folder (another database). **Always, to test with real data: with a copy of the database.** |
| `PAILA_SNAPSHOT=x.png` | Opens the window hidden, saves a screenshot and closes. `PAILA_SNAPSHOT_JS` runs something first. |
| `PAILA_SLOW_WALK=200` | Slows down the folder walk (to see the progress). |
| `PAILA_LIBRARY=<folder>` | Real library for `tests/real-library.test.ts` (**read-only**). |
| `PAILA_CORPUS=<folder>` | Where the `npm run corpus` lab is. |
| `PAILA_UPDATE_FEED=http://127.0.0.1:<port>/` | Turns on updates against a test server (never against GitHub). |
| `PAILA_MEDICION=1` | For speed measurements (see "Heavy work"). |
| `PAILA_IDIOMA=es\|en` | Opens in that language without changing the saved one. |
| `NAPIA_RED_FALSA=<file.json>` | NAPIA and PAILA's health check use a made-up firewall, network type and router (see `packages/core/sockseek/firewall-sistema.ts`): "Fix it" and "Open network settings" touch nothing. Examples in `docs/pruebas/2026-10-24-chequeo/`. |
| `PAILA_ELEGIR=<path>;<path>` | The "Move to another computer" dialogs pick these paths, in order, without asking (tests that drive the app from outside). |

## Seeing what PAILA does inside (for agents and people who code)
- **One track:** `npm run tema -- "<path, number or part of the name>"` prints everything PAILA sees and decides: tags, quality and why, BPM, key, beat grid, fingerprints, playlists, duplicates, history and what each assistant would propose. It opens the database read-only (`--base <copy.db>`, or `PAILA_USER_DATA`, or this computer's): it never writes. `--json` for another program; `--sin-asistentes` if the library is huge. It's the same inspector as in the app (Advanced mode).
- **Screens:** `npm run build` and then `npm run capturas` leaves a screenshot of every PAILA and NAPIA screen, in studio, comic and booth styles, in `capturas/<date>/` (with a copy of the database and the app in look-only mode). After touching the interface: one run before and one after, and `npm run capturas:comparar -- capturas/<before> capturas/<after>` builds `lamina.html` with the before, the after and where each screen changed. Options: `--solo paila|napia`, `--modos sobrio,cabina`, `--pantallas home,settings`, `--idiomas es,en` (both by default; English goes in `<mode>.en/`).
- **Advanced mode (off by default):** Settings → Display, or Ctrl+K → "Turn on advanced mode". Adds to the sidebar the inspector for a track, the analysis queue, the operations log and the design showcase; with a track selected, Ctrl+K offers "Re-analyze the selected track". It only shows: it doesn't change how PAILA works.

## Testing without breaking anyone's music
- **Someone's library is sacred.** Reading it is fine; writing to it, never without permission. To test changes end to end (applying names, organizing, converting, replacing), use a **copy** of the music folder and a **copy** of the database (`%APPDATA%\PAILA\paila.db`) with `PAILA_USER_DATA`, changing the root folder in that copy so it points to the copy of the music. Then compare the results against the original.
- Tests make their own files with ffmpeg (synthetic); they never use the real library except `real-library.test.ts`, read-only.
- **Supervised runs:** every feature that touches many tracks (organizing, fixing names, internet, duplicates, converting) is first tested with a preview on a real library, reviewing each proposal looking for the small stuff ("Balvin" instead of "J Balvin"). It's written down in `docs/pruebas/` and every error found gets its test.

## Style
`tests/estilo.test.ts` checks it on every `npm test`:
- every code file starts with a comment that says what it does;
- no file goes over 350 lines (the goal is under 300: the one that grows gets split by task);
- `packages/core/` doesn't write to the console (it reports with `onProgress`, `onWarn` or an error);
- the "visible track" filter always goes through `visible()` or `listed()` from `packages/core/db.ts`;
- the interface uses the icons from `@paila/diseno`, no emoji;
- **no loose text on a screen**: each one goes in a Spanish/English pair (see "Texts and language"). `npm run textos -- <file>` tells you which ones are missing.

Also:
- Database migrations (`packages/core/migrations.ts`) are added at the end; old ones are never edited.
- Relative paths are stored with `/`.
- The interface texts are in simple Rioplatense Spanish and in equally simple English. Every technical term gets a short explanation (ⓘ, the `Info` component). Think of anyone with a lot of music, not only DJs.
- Comments and names follow the style of the file you're touching (in Spanish).

## Texts and language
PAILA and NAPIA speak Rioplatense Spanish and English (Settings → Display → Language; the first time, Windows' language). The base is in `@paila/shared/idioma`:
```ts
import { textos, cant, num, fecha } from '@paila/shared/idioma'
const T = textos({
  titulo: { es: 'Duplicados', en: 'Duplicates' },
  hay: { es: (n: number) => `Hay ${cant(n, 'tema', 'temas')}`, en: (n: number) => `There are ${cant(n, 'track', 'tracks')}` },
})
// on the screen: {T.titulo} · {T.hay(3)} · num(1234.5) · fecha(d)
```
- The pairs go at the top of the screen's file or, if it doesn't fit (350 lines), in a separate file next to it (`Duplicates.textos.ts`). TypeScript requires both languages and the same data.
- Bold and parts that aren't text (an ⓘ, a button): `<Rico texto={T.aviso} partes={{ info: <Info tip={T.avisoTip} /> }} />` with `'Tenés **3 temas** sin tapa {info}'` (from `@paila/diseno`).
- Numbers and dates with `num`, `fecha`, `fechaHora`; plurals with `cant` / `plural`; lists with `lista` ("A, B and C"). No hand-written `'es-AR'`.
- English as simple as the Spanish: no jargon and with its ⓘ. The Spanish doesn't change when a screen is converted.
- **What PAILA writes into files is not translated** (tags, folders like "Instrumentales y Acapellas" or "Varios Artistas"): that doesn't use `textos()`.
- The rule (`tests/estilo.test.ts`) checks every screen except those in `tests/idioma-pendientes.ts`, which are being converted: a new screen is born with its texts in pairs. If something has to stay the same in both languages, `// idioma-ok` on that line or the one above.
- `PAILA_IDIOMA=en` opens PAILA or NAPIA in English without changing the saved language (screenshots, tests).

## Dependencies and licenses
- Before adding a dependency, check its license: what ships with the app has to be compatible with AGPL-3.0 and OSI-approved (list in `scripts/licencias.ts`). Nothing with "non-commercial" parts inside the installer: that goes as an optional download.
- After changing dependencies: `npm run licencias` (otherwise `tests/licencias.test.ts` fails).
- Versions are pinned or capped (`package-lock.json` up to date). OSV-Scanner checks security advisories on GitHub.
- The Beat This! model and onnxruntime-web (MIT) always ship, in the installer and in the portable. `npm run modelos:armar -- --desde <models folder>` builds the minimal copy; `dist`/`pack` bring it in on their own if they find it (`scripts/preparar-instalador.mjs`): see `docs/compartir.md`.

## Heavy work and parallel sessions
- If several sessions work at the same time, each one on its own branch or working copy. In a working copy (`git worktree`), `node_modules/@paila` may point to code in another folder: check that the tests use your branch's.
- **Speed measurements:** before measuring, create `%TEMP%\paila-medicion.lock` with one line (who, what it measures, until what time), run with `PAILA_MEDICION=1` and delete it when done. While it exists, nobody runs heavy work (`npm test` already waits on its own).
- Decoding a lot of audio at once bogs down the computer: if another `ffmpeg` is already working, wait.

## Things already learned
- PowerShell 5.1 fails with paths longer than 260 characters; Node and bash don't.
- In bash, paths with "ú" or other accents can break when passed to Windows programs: to copy folders with accents, use PowerShell.
- `PAILA_SNAPSHOT` with the window hidden doesn't run animations: a screen opened with `PAILA_SNAPSHOT_JS` may come out empty. Turn them off first: `document.head.insertAdjacentHTML('beforeend','<style>*{animation:none!important;transition:none!important}</style>')`. The first launch with a new data folder can also come out empty: try again.

## Before calling something done
`npm run verificar` (types, build, tests and lab; with `-- --rapido` if you didn't touch the quality analysis); if it's interface, see it working with a copy of the database. If you touched the installer, `npm run dist` and try it in a test folder. Update `docs/MAPA.md` if you added or moved files. If you change this guide, change `AGENTS.es.md` too.

## If something fails on someone's computer
Settings → "If something goes wrong" → **Export diagnostics** builds a zip without personal data (version, system, counts, timings and errors, with paths and names hidden). What it includes is in `packages/core/diagnostic.ts`; the error log, in `<data>/registro/errores.log`.
