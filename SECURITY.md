# Security / Seguridad

*English below · [Castellano](#castellano)*

## Reporting a vulnerability

If you find a security problem in PAILA or NAPIA (for example, a file that makes the app run code, write outside the folders you chose, or leak a key or a path), **please don't open a public issue**.

1. Go to the repository's **Security** tab → **Report a vulnerability** ([direct link](https://github.com/epitelio-ar/PAILA/security/advisories/new)). Only the maintainer can see it.
2. Tell us what version you use (Settings → Updates shows it), what you did, and what happened. A small file or steps that reproduce it help a lot. Don't attach music you can't share, or keys.
3. You'll get an answer within **7 days**. Once there's a fix, it ships in a new version and the report is published with credit to you (unless you prefer not to be named).

## Supported versions

Only the **latest version** published in [Releases](https://github.com/epitelio-ar/PAILA/releases) gets security fixes. PAILA warns you when there's a new one.

## What counts

- Yes: running code from a music file, a playlist, a tag, a ZIP/RAR or a list; writing, moving or deleting outside what the preview showed; leaking keys, paths or library names (including in Export diagnostic); problems in the update check or in how a new version is verified.
- Not a vulnerability: what someone downloads with NAPIA from Soulseek (that's the responsibility of whoever downloads it), or problems in third-party programs (report those to their projects: [ffmpeg](https://ffmpeg.org/security.html), [sockseek](https://github.com/fiso64/sockseek), [mpv](https://github.com/mpv-player/mpv), [Electron](https://github.com/electron/electron/security)). If PAILA uses them in an unsafe way, it does count.

---

## Castellano

### Cómo avisar una vulnerabilidad

Si encontrás un problema de seguridad en PAILA o NAPIA (por ejemplo, un archivo que hace que la app corra código, escriba fuera de las carpetas que elegiste o deje ver una clave o una ruta), **no abras un issue público**.

1. Andá a la pestaña **Security** del repositorio → **Report a vulnerability** ([enlace directo](https://github.com/epitelio-ar/PAILA/security/advisories/new)). Solo lo ve quien mantiene el proyecto.
2. Contá qué versión usás (Configuración → Actualizaciones la muestra), qué hiciste y qué pasó. Un archivo chico o los pasos para repetirlo ayudan mucho. No adjuntes música que no puedas compartir, ni claves.
3. Vas a tener respuesta en **7 días** como mucho. Cuando esté el arreglo, sale en una versión nueva y el aviso se publica con tu nombre (salvo que prefieras que no).

### Versiones con arreglos

Solo la **última versión** publicada en [Releases](https://github.com/epitelio-ar/PAILA/releases) recibe arreglos de seguridad. PAILA avisa cuando hay una nueva.

### Qué cuenta

- Sí: correr código desde un archivo de música, una playlist, un tag, un ZIP/RAR o una lista; escribir, mover o borrar fuera de lo que mostró la vista previa; dejar ver claves, rutas o nombres de la biblioteca (también en Exportar diagnóstico); problemas en la búsqueda de versiones nuevas o en cómo se verifica una versión nueva.
- No es una vulnerabilidad: lo que alguien baja con NAPIA de Soulseek (es responsabilidad de quien lo baja), ni los problemas de programas de terceros (se avisan en sus proyectos: [ffmpeg](https://ffmpeg.org/security.html), [sockseek](https://github.com/fiso64/sockseek), [mpv](https://github.com/mpv-player/mpv), [Electron](https://github.com/electron/electron/security)). Si PAILA los usa de forma insegura, sí cuenta.
