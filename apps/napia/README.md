# NAPIA

Panel de control para **sockseek** (el programa que baja de Soulseek), para usarlo sin escribir comandos. NAPIA no baja nada: le arma la lista a sockseek, lo corre y muestra cómo va. La cuenta de Soulseek queda en la configuración de sockseek; NAPIA no la pide ni la guarda.

1. **Qué bajar:** un CSV (Exportify, Chosic, TuneMyMusic, Spotify), un texto con un "Artista - Tema" por renglón, o lo que exporta PAILA desde la lista «Faltan o suenan mal».
2. **Dónde y cómo:** la carpeta (por defecto `Música\NAPIA`, una subcarpeta por lista, sin el día: «80s Mood»; si la volvés a bajar, lo nuevo se suma ahí; la primera vez muestra el disco y el espacio y pregunta) y la calidad. Lo que está bajando y los archivos de sockseek (índice, `.incomplete`) quedan en los datos de NAPIA: a la carpeta solo llega música terminada. Las acciones al terminar de la config de sockseek no corren.
3. **Bajar:** avance tema por tema, lo que no se encontró, cortar, y al terminar "Abrir PAILA" para que la Bandeja revise lo bajado.

**El puerto:** es por donde los demás usuarios pueden llamarte para mandarte los temas. Cerrado igual se baja; abierto, se baja de más gente. NAPIA se lo pide al router (UPnP o NAT-PMP) mientras sockseek baja y lo cierra al terminar; si el router no lo deja, explica cómo abrirlo a mano.

**El router trabado:** con el puerto cerrado, cada búsqueda hace que sockseek abra miles de conexiones a la vez, y muchos routers se traban (y el internet con ellos). NAPIA usa el **sockseek con freno** (`sockseek-freno/`, en su carpeta de datos) y, si no lo tiene, avisa. Mientras baja, se da cuenta si el router se trabó.

Se instala con PAILA (casilla tildada de fábrica en el instalador) y usa su mismo motor: `PAILA.exe --napia`.

- Armar: `npm run build -w napia` (o `npm run build` en la raíz, que arma las dos).
- Abrir en desarrollo: `node_modules/electron/dist/electron.exe apps/napia` (o `apps/paila --napia`).
- Probar sin Soulseek: `NAPIA_EXTRA_ARGS='--no-config --user x --pass y --mock-files-dir "<carpeta con audios>"'` (sockseek "baja" de esa carpeta), o `NAPIA_SOCKSEEK_FALSO=tests/fixtures/sockseek-falso.mjs` (un sockseek de mentira; con `FALSO_PUERTO_CERRADO=1` imita el puerto cerrado).
- La calidad real (cada tema bajado se revisa; lo trucho va a `<lista>/descartados` y se busca otra fuente): `node scripts/run-ts.mjs scripts/napia-calidad.ts --falso` (con archivos truchos del laboratorio) o `… napia-calidad.ts <lista.txt>` (de verdad, a `D:\PAILA-trabajo`; borra lo bajado al terminar).
- La lógica (sin interfaz, con tests) está en `packages/core/sockseek/`; ver `docs/MAPA.md`.
