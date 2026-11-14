# Novedades de PAILA

Qué cambió en cada versión, en pocas palabras. La de arriba es la más nueva. PAILA muestra la de la versión que tenés en **Configuración → Actualizaciones → Qué hay de nuevo**.

<!-- Para sumar una versión: una sección "## X.Y.Z · día/mes/año: título corto" arriba de todo, con puntos simples
     (sin jerga; si hace falta una palabra técnica, explicarla). Después: npm run version:subir -- X.Y.Z -->

## 1.0.0 · 13/11/2026: la primera versión pública

- **PAILA ya es pública y de código abierto** (licencia AGPL-3.0): se baja desde github.com/epitelio-ar/PAILA, y cualquiera puede ver cómo está hecha.
- **Se actualiza sola:** cuando salga una versión nueva, PAILA te avisa y se pone al día, sin que tengas que bajar nada a mano. Qué cambió en cada una está en Configuración → Actualizaciones.
- **Cada versión trae su huella** (SHA256): sirve para comprobar que el instalador que bajaste es el original y nadie lo tocó.
- **NAPIA viene incluida y es opcional:** una casilla del instalador, tildada de fábrica, que podés destildar. PAILA anda entera sin NAPIA.
- Todo lo de la 0.5.36: las pestañas nuevas, Ordenar con un solo Aplicar, internet una sola vez, deshacer sin restos, Sonido de un vistazo y Un disco en NAPIA.
- **Todavía sin firma oficial:** Windows muestra "Windows protegió su PC" la primera vez. Tocá "Más información" y después "Ejecutar de todas formas". La firma se pide ahora que PAILA es pública.

## 0.5.36 · 13/11/2026: PAILA repensada, con Ordenar y Sonido de un vistazo

- **Pestañas nuevas:** Inicio · Tu música · Ordenar · Sonido · Llevar · DJ. Cada cosa está donde la buscarías. Las herramientas para DJ tienen su pestaña propia, y Llevar junta el pendrive y el celular.
- **Ordenar, una sola revisión:** PAILA arma sola lo que se puede arreglar sin riesgo: repetidos idénticos, nombres prolijos y carpetas. Te muestra todo junto y tocás un solo Aplicar. Lo que destildás queda a la vista, y lo dudoso lo decidís ahí mismo, en "Para decidir vos".
- **Las carpetas se arman con bloques, sin códigos:** elegís entre tres formas (por disco, por artista o por género) con dos temas tuyos de ejemplo, o armás la tuya. PAILA propone la forma que ya tienen tus carpetas. Los temas quedan sin número en el nombre del archivo: el orden lo sigue dando el número de pista que leen los programas de música.
- **Internet, una sola vez:** das el OK y PAILA completa sola nombres oficiales, discos, años y tapas. Lo dudoso bajó de 472 temas a 8. Un tema puede tener varios géneros: en las listas se ve el principal, y todos aparecen en la ficha del tema.
- **Deshacer, de verdad sin restos:** al aplicar se sacan las carpetas que quedan vacías, y al deshacer vuelven, junto con la fecha original de cada archivo. Deshacer algo viejo deshace también lo que vino después, en orden.
- **Sonido de un vistazo:** una sola pantalla para lo que suena mal o falta, con NAPIA arriba. Lo que se ofrece mejorar va del peor sonido al mejor, y las copias mejores se proponen ahí y en la barra de arriba.
- **NAPIA baja un disco entero:** escribís artista y disco, y si hay varias ediciones (original, remasterizada, de lujo) te las muestra con año y cantidad de temas para que elijas vos. Cuando termina de bajar, queda minimizada.
- **PAILA escanea tus carpetas sola al abrir,** y queda un botón chico para hacerlo a mano.
- **Más simple:** Herramientas (Estadísticas, Espacio, ZIP y RAR) agrupadas y cerradas, Tracklist solo en DJ, un ⓘ en cada término técnico, y "Rajatabla" ahora se llama "Estricto".
- **Arreglado:** un Opus disfrazado de .mp3 se marca como incompatible, y una carpeta de género ya no se toma como si fuera un disco.

## 0.5.35 · 01/11/2026: lo que se mueve queda en orden, y lo que tocás se entiende

- **Arreglado: Organizar ya no deja temas a medio mover.** Si un tema nuevo iba al lugar de uno que mandaste a la papelera (pasa al reemplazar con lo que trae NAPIA), Organizar lo movía pero no lo anotaba. Ahora lo de la papelera ya no ocupa su lugar de antes. Los 11 temas que quedaron así se terminan de anotar solos al abrir esta versión. Y si alguna vez algo no se puede anotar, el archivo vuelve a donde estaba.
- **Organizar, repensado:** la vista previa se calcula sola, sin botón. Separa los temas que cambian de carpeta de los que solo cambian de nombre. Y podés destildar **«Cambiar también el nombre de los archivos»**: cada tema va a su carpeta y conserva su nombre, así Rekordbox no pierde tantos temas. La regla con códigos queda en «Personalizar».
- **Proponer y aplicar, de punta a punta:** arriba se ve una sola cosa por vez: lo que está listo para aplicar, el avance mientras aplica y después «Listo», con Deshacer. Ya no quedan cartelitos para cerrar. Lo que proponés o aplicás sale solo de la lista de donde vino.
- **Los avisos aparecen abajo a la derecha** y ya no tapan Aplicar.
- **Completar desde internet, en tres partes plegadas:** nombres oficiales, géneros, y álbum y año. Cada una dice en qué está, y queda abierta la que falta. Si corregís un nombre, vuelve a buscarlo con el nombre nuevo.
- **Organizar te avisa si hay cambios sin aplicar**, para no tener que ordenar dos veces.
- **Abajo a la izquierda, ordenado:** Historial, Papelera y Configuración con su nombre (el engranaje ya no parece el brillo). Tus discos aparecen en renglones, con su nombre y su letra. Si tocás uno, te dice cuál es y cuánto espacio le queda, y te deja abrirlo o expulsarlo sin riesgo.
- **En Análisis, la barra sigue a la pasada que corre** (por ejemplo, la precisa) y ya no queda clavada en 100 %.

## 0.5.34 · 01/11/2026: NAPIA no hace esperar a lo trucho, y lo que tocás responde

- **NAPIA baja cada lista de a 25 temas.** Si un tema llega trucho, lo busca en otro usuario apenas termina esa tanda de 25, no al final de la lista. Con una lista larga, antes podía esperar horas.
- **Mientras baja un tema, NAPIA ya escucha un pedazo.** Si ese pedazo suena trucho (un MP3 inflado o un FLAC que por dentro es un MP3) y es lo único que queda bajando, lo corta y prueba otro usuario, sin esperar a que termine. Mientras haya otros temas bajando, lo deja terminar y decide con el archivo entero.
- **Lo que parece tocable, ahora hace algo.** En la cola, el tema que suena abre su ficha. En Escuchando, la tapa y el título abren la ficha, y el artista y el disco te llevan a la biblioteca con esos temas. En Análisis, cada nota (A, B… F) muestra los temas que la tienen. En la ficha, el título hace sonar el tema. En Separar voz, tocar una fila la hace sonar.
- **Escuchando, más limpio:** la barra de abajo ya no repite los controles ni la línea de tiempo, y tocarla no te saca de la pantalla. Escuchando ya no tapa las pestañas.
- **En NAPIA, cada fila tiene su botón:** «Ver la tuya», «Buscar de otra forma» (solo ese tema) o «Ver en PAILA».
- **Ordenar dice lo justo:** en vez de "cambiaste 1.091 temas", dice cuántos quedaron fuera de su carpeta y cuántos solo cambiarían de nombre (por ejemplo, porque Completar desde internet les puso el número de pista).

## 0.5.33 · 01/11/2026: NAPIA reconoce la versión y retoma sola

- **Para repasar:** si después de hacer un paso entran temas nuevos, o cambiás nombres después de ordenar, ese paso se marca con un **!** amarillo en su pestaña y en su parte, y dice qué cambió. Si deshacés Organizar, se destilda.

- **NAPIA compara por el sonido lo que baja**, como Shazam. Si viene a reemplazar un tema tuyo, tiene que ser el mismo audio. Si es un en vivo, un remix u otro tema, lo descarta y prueba otra fuente. Para los temas que no tenés, le pregunta a AcoustID si es de verdad ese tema.
- **NAPIA se acuerda de la tanda.** Si se cierra mientras baja (a mano, al instalar una versión nueva o porque se apagó la compu), al abrirla sigue sola donde quedó, sin repetir lo ya bajado. Si la habías parado con Parar, no arranca sola.

## 0.5.32 · 01/11/2026: pestañas que avanzan

- **Arriba, PAILA se ordena en pestañas** que van de izquierda a derecha, en el orden que conviene: **Conocer → Limpiar → Nombres y datos → Ordenar → Mejorar el sonido → Usar**. Primero está **Tu música**, con tus temas y tus playlists.
- **La barra de la izquierda muestra las partes de la pestaña en la que estás**, numeradas y en orden. Por ejemplo, en Nombres y datos: 1 Completar desde internet, 2 Arreglar nombres, 3 Discos y tapas.
- Cada pestaña muestra un tilde cuando está hecha. Si la tocás, vuelve a la última parte que abriste.
- El recorrido de bienvenida ahora explica las pestañas.

## 0.5.31 · 01/11/2026: PAILA y NAPIA, mejor conectadas

- **PAILA ve lo que baja NAPIA:** en la barra de arriba aparece "NAPIA bajando «lista»" con su avance. Si lo tocás, te trae NAPIA.
- **Cuando NAPIA termina una lista, PAILA avisa** cuántos bajó y cuántos no se consiguieron. Los que no se consiguieron quedan marcados en «Faltan o suenan mal» como "No está en Soulseek".
- **La Bandeja sigue la carpeta de NAPIA:** si cambiás en NAPIA dónde guarda, la Bandeja pasa a mirar la nueva (si la había puesto NAPIA). Si guarda adentro de tu Música, no hace falta.
- **Buscar mejor copia con NAPIA:** desde la ficha de un tema o desde varios temas elegidos.
- **En NAPIA, "Ver la tuya":** en cada tema que viene a reemplazar uno tuyo, abre PAILA en tu copia para escucharla y compararla.

## 0.5.30 · 01/11/2026: lo que pidió la segunda prueba con una persona

- **Completar desde internet (y todo lo que tarda):** el tiempo que falta ya no se dispara ("falta 2 h" cuando faltaban minutos). Se perdía parte del avance al calcularlo.
- **Panel del tema:** si tocás un tema de "lo que sigue", el panel pasa a mostrar ese tema (si estaba mostrando el que sonaba).
- **Aplicar** (en Cambios pendientes) ahora es verde: se distingue de los demás botones, que son todos amarillos.

## 0.5.29 · 01/11/2026: elegir qué bajar, y NAPIA avisa si no hay lugar

- **Faltan o suenan mal:** arriba elegís qué mandar a NAPIA: **Mejorar lo que tengo** (temas que ya tenés y suenan mal), **Lo que me falta** (los que les faltan a tus discos y los de listas traídas) o **Todo**. Cada parte llega a NAPIA como una lista aparte.

- **NAPIA:** el botón para parar una bajada ahora es grande y rojo ("⏹ Parar"). Lo bajado queda, y lo que estaba a medias sigue la próxima vez.
- **NAPIA:** antes de arrancar, avisa si la tanda puede no entrar en el disco de la carpeta elegida, y te sugiere elegir otra (por ejemplo, un disco externo).

## 0.5.28 · 01/11/2026: lo que pidió la primera prueba con personas, segunda tanda

- **Arreglar nombres:** arriba de los niveles (Prolijo, Rajatabla, Oficial) dice que elegir uno no cambia ningún archivo: recién se proponen cuando tocás Proponer.
- **Completar desde internet:** cada contador dice qué busca ("búsquedas de nombres" o "búsquedas de géneros"), así no se confunden.
- **Pruebas con personas:** lo que se hace en NAPIA también queda anotado, y cada 15 segundos se anota lo que dice cada trabajo en marcha.

## 0.5.27 · 31/10/2026: separar con el disco externo desenchufado

- **Separar voz y separar en 4 andan con cualquier carpeta de música:** lo separado va a la carpeta de música del tema (antes iba siempre a la primera, y si ese disco estaba desenchufado no se podía separar nada).
- **Si no se puede, lo dice:** con el disco desconectado o el tema que no está, avisa al tocar "Separar" en vez de fallar callado.

## 0.5.26 · 31/10/2026: separar en 4 partes

- **Separar en 4 partes:** en Separar voz ahora podés elegir **4 partes: voz, batería, bajo e instrumental** (guitarras, teclados, sintes y lo demás). El modelo (HT-Demucs v4, de Meta) es opcional y se baja aparte, una sola vez: 166 MB si ya tenías Separar voz. Cada tema tarda más o menos lo que dura.
- **Máxima calidad:** otra opción, con cuatro modelos especialistas (1,26 GB): la voz y la batería salen un poco más limpias, pero tarda unas cinco veces y media lo que dura el tema.
- **Carpeta propia:** lo separado en 4 va a «Stems (PAILA)», al lado de «Acapellas e instrumentales (PAILA)». Como siempre, el tema original no se toca y se puede deshacer.

## 0.5.25 · 31/10/2026: arreglos de la primera prueba con personas

- **Cambiar el idioma ya no te manda al Inicio:** la ventana se recarga y vuelve a Configuración, donde estabas.
- **Cambiar la salida de audio no borra lo que suena:** al pasar entre bit perfect y la salida de Windows, la barra de abajo seguía sonando pero a veces se quedaba sin el tema. Ya no.
- **NAPIA cambia de estilo sola:** si pasás de Sobrio a Historieta (o al revés) en PAILA con NAPIA abierta, NAPIA cambia en un par de segundos, sin cerrarla.
- **La pausa del análisis dice por qué:** "En pausa mientras se separa la voz", y en qué pasada iba. Sigue sola cuando termina.
- **Traer una lista:** "Confirmar los probables" va antes de "Crear", y se pueden confirmar también después.

## 0.5.24 · 31/10/2026: primeros pasos en orden y un Deshacer que no confunde

- **Primeros pasos en un orden que no te hace volver:** Escuchar → Duplicados → Completar desde internet → Arreglar nombres → Discos y tapas → Organizar carpetas. Los repetidos se sacan antes de buscarlos en internet, lo que trae internet se revisa en Arreglar nombres, y Organizar queda al final, cuando los nombres ya no cambian.
- **Arreglar nombres se tilda:** se da por hecho cuando proponés cambios ahí, y tiene "Ya está" (los temas sin ningún dato no se arreglan en esa pantalla y lo dejaban sin tildar).
- **Deshacer, sin sorpresas:** mientras hay cambios pendientes, la barra de arriba ya no muestra "Deshacer lo último" al lado de "Descartar": se confundían y se deshacía otra cosa. Lo último se sigue deshaciendo desde el Historial.
- **NAPIA no busca lo imposible:** no le llegan los temas sin artista con nombres como "Track 01" o "AudioTrack 08". Primero hay que arreglarles el nombre.
- **Pruebas con personas, más seguras:** dentro de una prueba no se puede agregar una carpeta ni elegir una Bandeja de fuera de la prueba, así nunca se toca la música de verdad.

## 0.5.23 · 31/10/2026: lo que baja NAPIA llega a tu música

- **NAPIA y la Bandeja, conectadas:** al tocar "Bajar con NAPIA", si la Bandeja todavía no vigila ninguna carpeta, pasa a vigilar la de NAPIA y te lo avisa. Así lo que baja aparece en la Bandeja para pasarlo a tu Música (antes se quedaba en la carpeta de NAPIA).
- **Bajar solo lo de tu lista:** en "Traer una lista", una vez traída, el botón **Bajar con NAPIA lo que falta** manda solo lo que falta o suena mal de esa lista, no todo lo de "Faltan o suenan mal".
- **Pruebas con personas:** el informe dice "Biblioteca" en vez de "library", y la tarea 6 es "Pasar una lista al pendrive".

## 0.5.22 · 31/10/2026: "Faltan o suenan mal"

- **Nombre nuevo:** la "Lista para conseguir" pasa a llamarse **Faltan o suenan mal**, que dice lo que hay adentro: los temas que no tenés y los que tenés en mala calidad. Funciona igual que antes.
- **NAPIA en las pruebas con personas:** abierta desde una prueba, NAPIA guarda todo dentro de la carpeta de la prueba y usa la Bandeja de esa PAILA, nunca la tuya.

## 0.5.21 · 31/10/2026: internet más rápido y un tiempo restante que no miente

- **Completar desde internet, más rápido:** si un tema ya se reconoció por cómo suena, no se le vuelve a preguntar a MusicBrainz (el servicio más lento). En la prueba del 28/10 eran casi la mitad de las búsquedas.
- **Búsquedas en fila:** si pedís dos búsquedas que usan el mismo servicio (por ejemplo nombres y géneros), la segunda queda **"En fila"** y arranca sola cuando termina la primera, en vez de dar error. Se puede cancelar mientras espera.
- **"Encontrados" cuenta temas:** al terminar dice cuántos temas tienen algo para revisar (antes sumaba cada búsqueda en cada fuente: "1.429 encontrados" con 300 temas).
- **Tiempo restante:** se calcula con el ritmo de los últimos minutos, no con el promedio desde el arranque, y al empezar dice "calculando…" en vez de inventar "24 h 55 min".
- **Lo que suena:** tocar el tema en la barra de abajo abre Escuchando.
- **Detalles:** MusicBrainz y Deezer dicen "no necesita clave", y el trabajo en curso cambia de idioma si cambiás el idioma.

## 0.5.20 · 30/10/2026: más segura

- **Arreglo de seguridad:** PAILA y NAPIA pasan a una versión nueva del motor que usan por dentro (Electron 43.8.4), que tapa una falla al recibir datos comprimidos de internet. Por fuera no cambia nada.

## 0.5.19 · 27/10/2026: más rápido y más a mano

- **Lista para conseguir:** se abre al toque aunque tengas muchísima música (los nombres se limpian de fondo) y usa mejor el espacio: la explicación pasa a un ⓘ y se ven más temas sin bajar.
- **Barra lateral con flechas:** un Tab para entrar, ↑↓ para moverse y Enter para abrir. Llegar a una herramienta con el teclado pasa de 61–76 teclas a 13–28.
- **Llevar la música al celular:** el botón "Copiar temas" queda siempre a la vista abajo y dice qué falta elegir.
- **Bandeja:** los motivos se ven en el idioma que elijas.

## 0.5.18 · 27/10/2026: con teclado, en pantalla chica y con mucha música

- **Ctrl+K arreglado:** ya se pueden escribir todas las letras, y Enter lleva a la pantalla en vez de cambiar un ajuste.
- **Con teclado:** Escape cierra las ventanas, se ve dónde está el foco y cada botón principal queda a pocas teclas; los renglones se abren con Enter.
- **Pantalla chica:** arriba y abajo ocupan menos y el reproductor se achica en ventanas bajas. "Biblioteca" arranca plegada para que se vean más herramientas.
- **Con muchísima música**, la Lista para conseguir ya no traba la app.
- **Menos texto:** Completar desde internet pasa de 191 a 74 palabras; el Historial ya no repite "Deshacer" en cada fila.

## 0.5.17 · 27/10/2026: herramientas a mano y tus playlists en su pantalla

- **Las herramientas, a la vista:** van antes que las playlists en la barra lateral; abajo, Historial, Papelera, Configuración y el disco quedan en un renglón de íconos (Historieta/Sobrio y lo de DJ, en Configuración).
- **Pantalla de Playlists:** en la barra se ven unas pocas (las fijadas o las últimas) y "Ver todas" abre una pantalla con sus tapas, para buscar, ordenar, fijar, fusionar o borrar. Al arrastrar temas, la barra muestra todas para soltar.
- **Inicio con un solo botón** mientras falten Primeros pasos, y la "cera" explicada a la vista.
- **Programas de DJ:** Exportar va primero. **Lista para conseguir:** "Bajar con NAPIA" y "Exportar" arriba.
- **Errores en palabras:** un archivo abierto en otro programa ya no muestra un código raro; si se corta internet en una búsqueda, esos temas se vuelven a buscar.
- **Modo prueba** para que alguien nuevo la pruebe con música de ejemplo (para el autor y sus probadores).

## 0.5.16 · 27/10/2026: te guía y no se rompe sola

- **Primeros pasos en el Inicio:** una tarjeta con el camino para ordenar tu música, que se va tildando sola y desaparece cuando terminás. Si saltás un paso, la pantalla te dice qué conviene hacer antes.
- **Una sola barra arriba** con los avisos, los cambios pendientes y deshacer.
- **Menos texto:** cada pantalla dice en una línea qué hace; lo largo queda en "Cómo funciona".
- **Al terminar una búsqueda** te dice qué sigue.
- **Las herramientas no se pisan:** lo que mueve archivos espera a lo que los está leyendo y lo dice; recortar silencios va antes que los tags; reemplazar un tema saca lo que se había calculado con el audio viejo.
- **Lo tuyo manda:** lo que elegiste a mano no lo cambia nada sin preguntar; después vale cómo lo publicó el autor y recién después las reglas automáticas.
- **Lo que no se pudo aplicar** se muestra aparte, con el motivo.

## 0.5.15 · 27/10/2026: lo que salió de usarla en serio

- **Ventanas y avisos:** el botón de confirmar ya no queda tapado en las listas largas; los avisos de arriba tienen un tope y no tapan la pantalla; los cambios que no se pueden aplicar se pueden descartar.
- **Más limpio:** la trama de puntitos queda solo en el fondo; "Anotar" pasa a "Opinar" (con "Mandar a PAILA" en modo avanzado); el botón Cabina sale de arriba; las tapas quedan en un solo lugar.
- **Completar desde internet:** lo encontrado se acepta de una vez o por grupo, sin ir uno por uno.
- **Playlists:** fusionar o borrar ya no pierde lo que le falta a la playlist; borrar con clic derecho o Supr; traer la misma lista otra vez ofrece **Actualizar** en vez de armar "(2)"; nuevo botón **"Los dos"** para quedarte con tu versión y pedir la de la lista.
- **Emparejar mejor:** el nombre del disco ya no se toma como título; los covers se ofrecen como otra versión.
- **Artistas con "/"** se guardan bien.
- **Reemplazar por otra versión** borra la grilla vieja para que se vuelva a calcular.
- **NAPIA:** "Saltear lo que ya tenés" ya no saltea lo que tenés en mala calidad; no saltea otra versión; prefiere el tema y no la acapella; "Buscar de otra forma" a mano; limpia los restos de bajadas cortadas.

## 0.5.14 · 24/10/2026: NAPIA no se frena con una fuente lenta

- **Una fuente lenta ya no frena la bajada:** si a un tema le faltan más de 5 minutos al ritmo que viene, sigue mientras haya otras cosas bajando; cuando es lo único que queda, NAPIA la corta y prueba con otro usuario. Lo ves como "Lenta" y "probando la 2.ª fuente".
- Si solo hay fuentes lentas, queda como "no se pudo" y podés usar "Buscar de otra forma".

## 0.5.13 · 24/10/2026: NAPIA anota y sigue la bajada

- **"Anotar" también en NAPIA** (o Ctrl+Shift+N): las notas quedan junto con las de PAILA, en Configuración → Notas de uso.
- **La lista de la bajada sigue sola lo que está pasando** (bajando, revisando, esperando). Si subís a mirar algo no te arrastra; vuelve con "Seguir lo que pasa".

## 0.5.12 · 24/10/2026: conseguir lo de una playlist

- **Lista para conseguir, "Solo de esta playlist":** elegís una playlist y la lista muestra solo lo que le falta y sus temas de mala calidad, no lo malo del resto de tu Música. Exportar y "Bajar con NAPIA" mandan solo eso.
- **La playlist que arma Traer una lista se ve enseguida:** si tenías plegado el grupo de playlists en la barra lateral, se abre solo, y el pedido tiene un botón "Ver la playlist".

## 0.5.11 · 24/10/2026: grillas sin trabas y avisos para Rekordbox

- **Las grillas ya no traban PAILA:** se calculan aparte, así la ventana responde y podés seguir usando todo. Los temas larguísimos (mixes, sets) van al final, los Sets no entran de fábrica y hay un botón **"Saltear este"**. Mientras corre una tanda, la pantalla muestra solo esa tanda, sin dos cuentas distintas.
- **Aviso antes de mover temas que están en Rekordbox:** si Organizar o Arreglar nombres va a cambiar de lugar temas que trajiste de Rekordbox, la vista previa te avisa que Rekordbox los va a perder hasta que vuelvas a importar.
- **Organizar ya no se lleva las miniaturas del Reproductor de Windows** (AlbumArt…jpg) como si fueran tapas.
- **Al hacer clic en PAILA ya abierta, la ventana pasa al frente.**
- **Botón "Anotar"** (o Ctrl+Shift+N): si algo te resulta raro o confuso, lo escribís en una línea y PAILA guarda en qué pantalla estabas y una captura. Queda en tu compu, en Configuración → Notas de uso.

## 0.5.10 · 24/10/2026: WMA y MP3 rebeldes

- **Ahora se escriben los WMA:** nombres, datos y volumen parejo, sin recodificar: el sonido queda idéntico, bit a bit. Lo leen Windows y los reproductores, y se deshace como todo.
- **MP3 que antes no se dejaban escribir:** los que traen la etiqueta mal cerrada o restos de otro programa antes del audio ahora se escriben bien.
- **Rekordbox:** la ayuda de "Programas de DJ" ya no dice que Rekordbox actualiza siempre: un tema que PAILA movió o renombró entra como nuevo, con su grilla, cues y estrellas.

## 0.5.9 · 24/10/2026: lo que pidió ordenar una biblioteca real

- **Tapas más cuidadosas:** si en la carpeta hay una imagen más grande, PAILA la usa solo si es la misma tapa que ya tienen los temas (antes podía elegir la de otra edición, como la instrumental). Y un compilado de "Varios Artistas" con un nombre común ("Reggaeton Classics") ya no toma la tapa de otro disco que se llama igual.
- **Duplicados no pierde lo de Rekordbox:** la copia que se queda recibe las estrellas y las veces tocado de la que va a la papelera. Al restaurar, vuelve todo como estaba.
- **Sacar carpetas vacías** ahora también saca las que Windows marcó como "solo lectura", y al deshacer quedan como estaban.
- **Archivos que no se pueden escribir:** los videos con nombre de audio (WebM) y los WMA figuran desde el principio como "no se pueden escribir", en vez de fallar al aplicar.
- **Tapas:** después de proponer, la pestaña ya no ofrece proponer lo mismo otra vez.

## 0.5.8 · 24/10/2026: letras, carpetas vacías y el aviso de Separar voz

- **Las letras viajan con su tema:** al organizar, un archivo de letra (.lrc) con el mismo nombre que un tema se mueve con él y toma su nombre nuevo, así tu reproductor la sigue encontrando. Deshacer la devuelve.
- **Sacar carpetas vacías:** en Espacio, PAILA muestra las carpetas que quedaron vacías (por ejemplo, después de organizar) y las saca con una pregunta. Queda en el Historial y Deshacer las vuelve a crear. Nunca toca los sample packs, los proyectos de Ableton ni el pendrive de Rekordbox.
- **Separar voz avisa con datos:** solo con temas de nota D o F, que separan un poco peor (medido). Con un MP3 de 192 o más separa igual que con un FLAC, así que no avisa.

## 0.5.7 · 24/10/2026: bandas con coma

- **Organizar** ya no corta el nombre de una banda que lleva coma: "Earth, Wind & Fire", "Lipps, Inc" o "Tyler, The Creator" tienen su carpeta. Una lista de artistas de verdad ("Charly García, Pedro Aznar") se sigue separando como antes.

## 0.5.6 · 24/10/2026: separar la voz

- **Separar voz:** en DJ y producción, PAILA saca de un tema la acapella y el instrumental, con un modelo libre que baja aparte (una sola vez, ~107 MB). Quedan como archivos nuevos con los tags y la tapa del original, en su propia carpeta; el original no se toca. Si el tema es de baja calidad te avisa y te ofrece buscar uno mejor. Se deshace desde el Historial.
- **"Deshacer lo último"** ahora dice qué deshace y cuándo ("Se mandaron 1.039 temas a la papelera · hoy a las 11:28"), sea lo que sea.
- **NAPIA y la Bandeja** deciden con la misma vara si una copia nueva es mejor que la tuya: mejor nota, o la misma con más calidad real, sin cortes, sin saturar más y con la misma duración.
- **Nombres oficiales** ya no se traba si MusicBrainz no contestó alguna búsqueda (cuando pide ir más despacio).

## 0.5.5 · 24/10/2026: PAILA se revisa sola

- **Chequeo:** en Configuración, PAILA revisa que todo ande (ffmpeg, que se pueda escribir en tus carpetas, el lugar en el disco, las claves de los servicios de internet, la base) y te dice cómo arreglar lo que falle. No hace falta abrirlo: si algo falla mientras usás PAILA, avisa sola.
- **NAPIA y el firewall de Windows:** se da cuenta si nunca aceptaste el cartel, si lo rechazaste o si le diste permiso para otro tipo de red (por ejemplo, solo "Públicas" cuando tu wifi es "Privada"), y lo arregla con un botón que pide el permiso de Windows una vez.
- **NAPIA, al reemplazar un tema tuyo:** lo nuevo sirve solo si es claramente mejor que tu copia. Si no aparece uno mejor, te lo dice.
- **Relee la calidad de toda tu Música de fondo** para encontrar los cortes chicos (unas centésimas de segundo) que antes no se veían. Retoma sola si se corta.
- **Organizar, más fino:** una página web en el lugar del artista ya no arma carpeta, el "Álbum desconocido" del Reproductor de Windows con la fecha ya no cuenta como disco, las colaboraciones de un compilado van con el primer artista, y un título que traía ".mp3" lo pierde.
- **Atajos G + letra:** las mismas letras en castellano y en inglés.

## 0.5.4 · 24/10/2026: lista para ordenar tu Música

- **Respaldos livianos:** antes de cambiar un archivo, PAILA guarda solo lo que va a cambiar (unos KB por tema) y no el archivo entero: una tanda de tapas y volumen pasó de 45 GB a unos 70 MB. Escribe en una copia, la revisa y recién ahí reemplaza; deshacer deja cada archivo idéntico. "Borrar respaldos" los manda a la papelera, que ahora muestra cuánto ocupa.
- **Decide mejor sola, con criterios repasados uno por uno sobre una biblioteca real:**
  - **Duplicados:** se queda la copia que no satura y la que no tiene cortes; a igual nota, el MP3 le gana al WMA; para desempatar mira el sonido, no de qué página vino.
  - **Nombres:** respeta tus mayúsculas y tus tildes, arregla solo los tags rotos (número pegado al artista, "Various Artists" con el artista en el título, un mail como artista) y usa el nombre del artista como se publica hoy.
  - **Carpetas:** el nombre oficial del artista con sus mayúsculas (ABBA, YSY A), un dúo en una sola carpeta, las colaboraciones sueltas con el primer artista y los compilados sueltos con cada artista.
  - **Tapas:** de varios discos con el mismo nombre, elige el que tiene tus temas y tu año.
  - **BPM y tono imposibles:** Arreglar nombres borra del tag los que seguro están mal (un BPM de 900, o el mismo BPM copiado a todo un disco). No escribe valores nuevos.
  - **Calidad:** "Dañado" cuenta los tropiezos de verdad (antes una palabra de la letra podía marcarlo) y la ficha dice dónde están los cortes ("3 cortes de 26 ms: 0:39, 0:49, 1:29").
- **"Para hacer" en el Inicio:** lo pendiente en un solo lugar, cada cosa con su botón, y cuánto lugar podés liberar.
- **NAPIA revisa lo que baja:** si un tema llega trucho (un MP3 inflado o un FLAC falso), lo aparta en "descartados" y busca otra fuente sola. "La que haya" prueba primero lo mejor.
- **Exportar a Engine DJ** (Denon y otros equipos), **Traer una lista** más preciso, íconos más nítidos y pantallas que se ven bien al 125 % y 150 %.
- **En inglés,** la nota de calidad y sus motivos también cambian de idioma.

## 0.5.3 · 23/10/2026: más segura para tu Música y más rápida

- **Respaldo antes de cada cambio:** antes de tocar tags, tapas, volumen o comentarios, PAILA copia los archivos que va a cambiar y verifica la copia. Si no hay lugar, no arranca. La vista previa te dice cuánto ocupa y dónde va, y el Historial, dónde quedó. Los respaldos se borran solo a mano, en Configuración → Respaldos.
- **Todo lo que toca archivos funciona igual:** la misma confirmación en todas las pantallas, los mismos chequeos antes de empezar (que el disco esté, que haya lugar, que nada caiga dentro de un sample pack) y el mismo registro por si se corta la luz. Llevar al pendrive, al celular o a otros programas ahora también queda en el Historial.
- **Deshacer un género o artista con varios valores** ("Rap; Hip Hop") ya funciona en todos los MP3.
- **Más rápida con bibliotecas enormes:** Arreglar nombres abre en segundos, y Duplicados y el Análisis trabajan más rápido.
- **El instalador** ya no dice que NAPIA necesita instalar sockseek aparte: viene adentro.

## 0.5.2 · 23/10/2026: arreglo de seguridad

- **Electron al día** (la base sobre la que corre PAILA): la versión nueva deja de confiar en unos certificados de internet que estaban comprometidos. Para vos no cambia nada.

## 0.5.1 · 23/10/2026: recortar silencios y PAILA para Mac

- **Recortar silencios largos:** desde el Centro de problemas, PAILA corta el silencio del principio o del final de los temas que tardan en arrancar o quedan callados, sin perder calidad y con los tags intactos. Pasa por Cambios pendientes, se escucha antes y después, y se deshace desde el Historial. Los sample packs nunca se tocan.
- **PAILA y NAPIA para Mac** (en prueba): ya se arman para Mac con chip Apple e Intel, y en Mac los atajos dicen Cmd en vez de Ctrl. Falta probarla en una Mac de verdad.
- **El disco que vuelve:** si el disco se desenchufa en medio de algo y vuelve con PAILA abierta, se resuelve solo, sin reabrir.
- **Reemplazar** ya no falla cuando el tema nuevo tiene el mismo nombre con otra mayúscula en la extensión (".Mp3").

## 0.5.0 · 23/10/2026: en inglés, otros programas de DJ, sonido sin retoques y más

- **PAILA y NAPIA en inglés:** elegís el idioma en Configuración → Pantalla. Lo que PAILA escribe en tus archivos no cambia con el idioma.
- **Pasar PAILA a otra compu:** "Exportar todo" guarda tus playlists, el historial, el análisis y la configuración en un archivo, y "Traer de otra compu" lo abre en otra PC aunque la Música esté en otro lugar. Así no hay que volver a analizar.
- **Calidad más fina**, comparada con Fakin' The Funk en 200 temas: reconoce mejor los MP3 chicos inflados a 320. Los sin pérdida que cortan justo donde lo hace un MP3 muy bueno siguen en B, con la etiqueta **"Puede venir de un MP3"**, su filtro y un botón para buscar el original.
- **"Proyectos" ahora se llama "Inéditos"**: demos, promos y temas que te pasaron antes de que salgan. Se escuchan y van a Rekordbox, pero PAILA no les busca nombre en internet ni los reorganiza.
- **Duplicados que antes no se veían:** el mismo tema de techno muy percusivo en peor calidad, versiones que comparten un pedazo corto y temas muy cortos.
- **Exportar a Traktor, Serato y VirtualDJ:** tus playlists, con grillas, cues y BPM, además de Rekordbox. Probado en Serato y VirtualDJ de verdad.
- **Sonido "bit perfect"** (apagado de fábrica): el tema le llega a tu placa o equipo tal cual está grabado, sin que Windows lo toque, como cuando Ableton toma la placa. Mientras está prendido, los otros programas no suenan por ese aparato.
- **Abrir RAR y ZIP** dentro de tu biblioteca: ver qué tienen, escucharlos, analizarlos y sacar los temas, con deshacer. Si ya sacaste todo, PAILA te ofrece mandar el comprimido a la papelera.
- **Géneros desde internet** (Discogs y Last.fm): de fábrica, con los nombres que ya usás en tu biblioteca, y a un clic el estilo fino o el género general. Uno solo por tema.
- **Estilo por el sonido** (descarga aparte, opcional): una sugerencia de estilo cuando PAILA está muy segura. Y **"Tu energía"**: marcás unos temas y la energía del 1 al 10 se ajusta a tu oído.
- **Bandeja:** la casilla ahora se llama "Reemplazar solo cuando no hay dudas", que dice mejor lo que hace.
- **Más prolija por dentro:** abre más rápido (1,25 s), y los títulos de la barra lateral ya no se mueven al scrollear un poquito.

## 0.4.0 · 22/10/2026: tracklist de sets, Rekordbox y Excel

- **Tracklist automático de sets:** PAILA escucha un set, un enganchado o un recital y te dice qué temas de tu biblioteca suenan y en qué minuto, aunque estén acelerados o frenados como en un disco. Sale como lista, en los tags o como cues, siempre con vista previa.
- **Traer tus playlists de Rekordbox:** soltás tu rekordbox.xml y aparecen como playlists de PAILA. Lo que no tenés va a la Lista para conseguir.
- **Leer un pendrive de CDJ** armado por Rekordbox: ves qué tiene y recuperás sus playlists, grillas y cues (solo lee, no escribe nada en el pendrive).
- **Tu biblioteca a Excel:** exportás la tabla, con las columnas que estás viendo.
- **Vistas guardadas:** guardás un filtro y un orden de la tabla con un nombre y volvés con un clic desde la barra lateral.
- **Silencios largos:** PAILA avisa de temas con mucho silencio al principio o al final.
- **Grillas en vivo más firmes** en temas tocados muy sueltos, y el tiempo que va a tardar ahora se calcula bien.

## 0.3.0 · 22/10/2026: un solo modo y NAPIA más completa

- **Un solo modo para todos:** ya no se pregunta "¿para qué usás tu música?". Abajo en la barra lateral hay un interruptor, **Herramientas para DJ y producción**, que suma BPM y tono, la sección Para DJs y el botón Cabina. Si PAILA ve que pinchás, te lo ofrece una vez.
- **Historieta de fábrica**, y **Sobrio** a un clic, ahí mismo en la barra lateral.
- **Carpetas → Playlists** ahora es para todos, en "Traer y llevar".
- **NAPIA baja en tanda:** ponés varias listas en cola y las baja una detrás de otra, cada una en su carpeta.
- **NAPIA tiene historial:** qué bajaste, cuándo, qué llegó y qué no, con un botón para verlo en la Bandeja de PAILA.
- **NAPIA busca de otra forma lo que no encontró:** sin el "feat.", sin "remaster", o la versión original. Te dice qué cambió antes de buscar.
- **Bandeja: "Reemplazar solo lo seguro"** (apagado de fábrica): reemplaza sola únicamente cuando es el mismo audio sin ninguna duda, y todo el día se deshace de una vez.
- **Modo avanzado** (apagado de fábrica, en Configuración): para mirar por dentro qué sabe PAILA de un tema, la cola del análisis y el registro de lo que hizo.
- **Por dentro:** pruebas más firmes y la lista de "remix, edit, live…" en un solo lugar, así un arreglo vale para todo.

## 0.2.0 · 22/10/2026: PAILA completa

- **Ahora sabés qué versión tenés** y qué trajo: lo ves acá mismo, en Configuración.
- **Calidad con criterio:** PAILA decide la nota de cada tema sola, con pistas (si vino de YouTube, de una tienda, el año), sin mandarte a mirar gráficos.
- **Volumen parejo:** si otro programa ya lo había ajustado bien, se respeta; si no, se corrige por disco entero, para que no salte entre temas.
- **Guardar no borra nada:** cuando PAILA escribe el nombre o el artista de un tema, el resto de los datos que tenía queda igual, y deshacer lo deja exacto.
- **Playlists:** "Fusionar" junta dos en una y "Limpiar" saca los repetidos, quedándose con la mejor versión. Siempre con vista previa y se puede deshacer.
- **NAPIA saltea lo que ya tenés** en PAILA, y entiende que un "feat." o una remasterización son el mismo tema.
- **Grillas para Rekordbox que siguen al tema** aunque el tempo se mueva (rock en vivo, bandas sin metrónomo). El BPM se muestra honesto: un rango (117–120) cuando el tema no es parejo.
- **Modo historieta:** un estilo nuevo, más dibujado. Lo elegís la primera vez, en Configuración o con Ctrl+K, y NAPIA lo copia.
- **La oreja del Inicio** se va llenando de cera según cuánta música de calidad baja tengas (5 escalones).
- **Más ordenado:** una fila por tema en Duplicados, Bandeja, Historial y otras pantallas, y una barra lateral reordenada, con Volumen parejo propio.
- **Más firme:** si cerrás la ventana en medio de Organizar, pregunta antes; la papelera, Espacio y la Bandeja ya no congelan la ventana; algunos FLAC sanos que aparecían como "dañados" ya no.

## 0.1.0 · 22/10/2026: la primera PAILA instalada

- La primera versión con instalador: PAILA y NAPIA en tu PC, con sus accesos en el escritorio.
- Todo lo hecho hasta el masterplan 2: ver la calidad real de tu música, arreglar nombres y tags, organizar carpetas, encontrar duplicados, hacer lugar, playlists, llevar la música al celular, BPM y tono, y pasar a Rekordbox. Siempre con vista previa, papelera propia y deshacer.
