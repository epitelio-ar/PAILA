# Guía de tono y glosario (PAILA y NAPIA)

Las dos apps hablan igual. Esta guía es lo que hay que mirar antes de escribir un texto de interfaz. Los colores y componentes están en `packages/diseno/` (se ven todos en el muestrario: **Ctrl+Mayús+M** dentro de PAILA).

## Cómo se habla
- **Castellano rioplatense, de vos**: "elegí", "mirá", "podés". Nada de "usted" ni de "tú".
- **Frases cortas, con verbos.** Lo que pasó y qué hacer: "Listo: se aplicaron 614 cambios." / "No se pudo escribir el archivo. Probá de nuevo."
- **Sin jerga sin explicar.** Si hay que usar un término técnico, lleva su ⓘ (`<Info tip="…" />`) con una explicación de una o dos frases. Ejemplos de términos que siempre llevan ⓘ: huella acústica, ReplayGain, lossless, BPM, tono (Camelot), kbps.
- **Tranquilo, sin alarmas.** PAILA no rompe nada y se puede deshacer: el tono lo transmite ("Se puede deshacer desde el Historial"). Los avisos rojos son solo para cuando algo falló de verdad.
- **Los números van con punto de miles y coma decimal** (4.705 temas, 51,8 GB) y en letra de ancho fijo (`.num`) cuando están en columnas.
- **Mascota y festejos solo en pantallas vacías y cuando algo terminó bien**, nunca en el medio del trabajo.

## Las palabras fijas
Mismas palabras en las dos apps. Si una pantalla dice otra cosa para lo mismo, se corrige.

| Situación | Se dice | No se dice |
|---|---|---|
| Un tema que está bien en la biblioteca | **Lo tenés** | "Presente", "OK", "Disponible" |
| Está pero con nota D o F, inflado o falso | **En mala calidad** (en la lista corta: "Mala calidad") | "Baja calidad" suelto, "malo", "defectuoso" |
| No está en la biblioteca | **Te falta** (con el tema: "No lo tenés") | "Faltante", "No encontrado" |
| Es otra versión del mismo tema (remix, en vivo, extended) | **Otra versión** | "Variante", "Alternativo" |
| Nota de calidad | **Nota** A+ … F (la mejor es A+) | "Rating", "Score", "Puntaje" |
| Lo que falta o suena mal, para conseguir | **Faltan o suenan mal** (con artículo: "la lista «Faltan o suenan mal»"; hasta el 31/10 se llamó "Lista para conseguir") | "Wishlist", "Lista de deseos", "Lista para conseguir" |
| Lo que llegó de afuera y falta revisar | **Bandeja** | "Inbox", "Entrada" |
| Dónde va lo que se saca | **Papelera** (de PAILA, restaurable) | "Borrar", "Eliminar" (nada se borra de verdad) |
| Lo que va a pasar antes de aplicar | **Vista previa** y **Cambios pendientes** | "Preview", "Staging" |
| Volver atrás | **Deshacer** (desde el **Historial**) | "Revertir", "Rollback" |
| Cuando algo terminó | **Listo** | "Completado exitosamente" |
| Cuando algo falló | **No se pudo …** + qué hacer | "Error:" + código, sin explicación |
| Cuando no hay nada para hacer | "No hay nada para …" | pantallas en blanco |
| Las estadísticas de la Música (pantalla) | **Estadísticas** | "Tu colección" (colección ya es Música, Producción, Inéditos…) |
| La pantalla de exportar e importar con Rekordbox, Traktor, Serato, VirtualDJ y Engine DJ | **Programas de DJ** | "Rekordbox y cabina" (era de cuando solo había Rekordbox) |
| El grupo de la barra que se ve con el interruptor de DJ | **DJ y producción** (igual que el interruptor "Herramientas para DJ y producción") | "Para DJs" |
| El grupo de conseguir mejores versiones, el volumen y los silencios | **Mejorar el sonido** | "Mejorar la calidad" |
| La colección de demos y promos propios | **Inéditos** | "Proyectos" (los proyectos de Ableton son otra cosa) |
| Mover tus temas a carpetas ordenadas | **Organizar carpetas** (la pantalla y la acción) | "el Organizador", "Organizador de carpetas" |

## Colores y su significado (siempre el mismo)
- **Acento** (ámbar en PAILA, violeta en NAPIA): lo principal de la pantalla, lo que se puede apretar, lo elegido.
- **Verde (ok)**: listo, lo tenés, todo bien. **Ámbar (atención)**: mirá esto, en mala calidad, dudoso. **Rojo (error)**: falló, te falta, peligro (borrar de verdad). **Azul (info)**: dato, otra versión.
- **Notas de calidad**: un color fijo por nota, igual en la tabla, el Inicio, los gráficos y la ficha: A+ celeste · A verde · B lima · C amarillo · D naranja · F rojo.
- Los colores **nunca son lo único** que dice algo: la nota y el estado siempre llevan su letra o su texto.

## Cómo se llama cada cosa de la interfaz
- **Botón** principal: una acción por pantalla, con verbo ("Aplicar", "Buscar duplicados"). Secundario (`ghost`): "Cancelar", "Ver más". De peligro (`danger`): lo que cambia o quita cosas de verdad, y siempre con confirmación.
- **Aviso** en la página: dato, listo, atención o error (`<Aviso tone="…">`). **Cartelito** (toast): confirmación corta que se va sola.
- **Ventana**: para decidir algo con vista previa. Se cierra con la ✕ o tocando afuera, salvo mientras está aplicando.
- **Barra de avance**: con porcentaje si se sabe cuánto falta; si no, animada sin porcentaje. Al terminar, llena y verde.

## Cuando una app manda a la otra
Si algo de PAILA se sigue en NAPIA (o al revés), el texto dice **en qué programa estás** y usa las mismas palabras: "Faltan o suenan mal" (PAILA) → "Bajar con NAPIA" → "Bandeja" (PAILA).

## Palabras de NAPIA (cómo va cada tema)
**Buscando** · **Bajando** (con su barrita) · **Bajado** (verde) · **Ya estaba** (azul: se bajó antes con la misma lista y sockseek lo saltea) · **No se encontró** (ámbar: nadie lo tiene, o no en la calidad pedida) · **No se pudo** (rojo: lo encontró pero no respondieron) · **Cortado** (lo cortaste vos). Para frenar se dice **Cortar** (lo que quedó a medio bajar se retoma la próxima vez). Los cortes con otros usuarios de Soulseek no se muestran como error: son normales y sockseek prueba con otro.

## En inglés (English)
El inglés sigue las mismas reglas: **de "you"**, frases cortas con verbos, sin jerga y con su ⓘ, tranquilo. Simple, para alguien con mucha música, no para un ingeniero de sonido. Números con coma de miles y punto decimal (4,705 tracks, 51.8 GB): sale solo con `num()`.

| Castellano | English |
|---|---|
| tema / temas | track / tracks |
| tu Música (la carpeta) · la biblioteca | your Music · the library |
| Lo tenés · No lo tenés · Te falta | You have it · You don't have it · Missing |
| En mala calidad · Otra versión | Poor quality · Other version |
| Nota (A+ … F) · Calidad real · Trucho | Grade (A+ … F) · Real quality · Bogus |
| Faltan o suenan mal · Bandeja | Missing or low quality · Inbox |
| Papelera (de PAILA) · Vaciar papelera | Trash (PAILA's own) · Empty trash |
| Vista previa · Cambios pendientes · Aplicar | Preview · Pending changes · Apply |
| Deshacer · Historial | Undo · History |
| Listo · No se pudo … | Done · Couldn't … (+ what to do) |
| No hay nada para … | Nothing to … |
| Escanear cambios · Análisis | Scan for changes · Analysis |
| Arreglar nombres y tags · Completar desde internet | Fix names and tags · Fill in from the internet |
| Duplicados · Organizar carpetas · Espacio | Duplicates · Organize folders · Space |
| Centro de problemas · Para revisar | Problem center · To review |
| Escuchando · Ficha | Now playing · Track details |
| Discos y tapas · Volumen parejo | Albums and covers · Even volume |
| Llevar la música · Estadísticas | Take your music along · Stats |
| Herramientas para DJ y producción · Modo cabina | DJ and production tools · Booth mode |
| DJ y producción (grupo) · Programas de DJ · Armar un set | DJ and production · DJ software · Build a set |
| Mejorar el sonido (grupo) · Recortar silencios | Improve the sound · Trim silences |
| Traer y llevar (grupo) · Traer una lista | Bring in and take out · Bring in a list |
| Respaldos · Pasar a otra compu | Backups · Move to another computer |
| Para mirar a mano | To check by hand |
| Producción · Inéditos · Sample packs | Production · Unreleased · Sample packs |
| Huella acústica · Pasada precisa | Acoustic fingerprint · Precise pass |
| Estilo: Historieta · Sobrio | Style: Comic · Studio |
| la oreja (PAILA) · la napia (NAPIA) | no se traducen: en inglés las figuritas se llaman **PAILA** y **NAPIA** |
| Configuración → Pantalla · Ctrl+K | Settings → Display · Ctrl+K |
| Mayús · Espacio (teclas) | Shift · Space |
| Aplicar · Cancelar · Ver más · Probar de nuevo | Apply · Cancel · See more · Try again |
| Tanda (de cambios) · Carpeta vigilada | Batch · Watched folder |
| NAPIA: Buscando · Bajando · Bajado · Ya estaba | Searching · Downloading · Downloaded · Already had it |
| No se encontró · No se pudo · Cortado · Cortar | Not found · Couldn't get it · Stopped · Stop |
