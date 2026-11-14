# Repensar la usabilidad de PAILA (01/11/2026)

El autor, después de la prueba de la persona 2: "se pierden las cosas, se loopea porque no se entiende qué se hace primero y al
rehacer algo obliga a hacer otras cosas de nuevo, no guía bien". Esto junta lo que mostraron las tres pruebas (el autor 28/10,
La persona 1 31/10, la persona 2 1/11) y un mapa del código pantalla por pantalla, y propone cómo resolverlo de raíz. Los bocetos están al
lado (`bocetos-usabilidad/`: a-camino, b-revision, c-objetivo).

## 1. Qué pasa hoy (los hechos)

**Demasiadas puertas, ninguna dice "empezá acá".** La barra lateral tiene 6 pantallas sueltas, 5 grupos (8 con DJ, modo
avanzado y vistas) y 26 pantallas en total, todas al mismo nivel. La persona 2 entró 32 veces a Inicio en 90 minutos; la persona 1 arrancó
por Separar voz y Análisis.

**Tres órdenes distintos para lo mismo.**
- La barra lateral (ayuda de "Ordenar"): 1 Nombres, 2 Internet, 3 Duplicados, 4 Organizar, y Discos después de Organizar.
- Los Primeros pasos de Inicio: Duplicados, Internet, Nombres, Discos, Organizar.
- Arreglar nombres: "primero pasalo por Duplicados".

**Las pantallas dependen unas de otras, pero no lo dicen.** Los encadenamientos reales:
- Análisis → Duplicados, Bandeja, Volumen y Silencios (necesitan la huella y el volumen medido).
- Nombres ⇄ Internet. Internet necesita artista y título aplicados. Nombres "Oficial" necesita lo que trajo Internet.
- Nombres e Internet → Discos y tapas (necesitan el disco en el tag).
- Duplicados → Organizar (si no, aparecen "(2)").
- Todo lo que cambia tags, **aplicado** → Organizar (Organizar lee los tags aplicados, no los pendientes).
- Organizar → Programas de DJ (Rekordbox reconoce los temas por carpeta y nombre).
- Bandeja → Volumen → Silencios. Reemplazar un tema borra su análisis y sus cambios de volumen pendientes.

**Los loops (rehacer X obliga a rehacer Y).**
1. **Nombres ⇄ Internet.** Lo que trae internet se guarda por tema y no se vuelve a preguntar si después cambiás el nombre.
2. **Nombres después de Organizar.** Organizar también renombra; un cambio de nombre después lo pisa, y el Deshacer de
   Organizar saltea esos archivos.
3. **Organizar con cambios sin aplicar.** "Nombres" se tilda al *proponer*, así que Organizar puede correr con los tags
   viejos y hay que hacerlo dos veces.
4. **Reemplazar después de Volumen.** El tema nuevo se analiza de cero y pierde el volumen parejo.
5. **Duplicados después de Nombres.** Lo pendiente de un repetido se pierde al mandarlo a la papelera.
6. **Claves de internet cargadas después.** Hay que volver a buscar todo.

**Los Primeros pasos no saben cuándo algo se desarma.** Cuatro de los seis pasos se tildan con una marca que queda para
siempre, y no hay forma de destildar. Rehacer un paso anterior no avisa que los siguientes quedaron viejos. Deshacer Organizar
deja "Organizar" tildado.

**Cada pantalla es su propio mundo.** "Completar desde internet" son tres recorridos completos en una página (unos 6
botones principales: la "pestaña INFINITA" de la persona 2). "Arreglar nombres" re-analiza con cada nivel que tocás. Programas de
DJ apila 7 secciones.

## 2. La raíz

No es falta de explicaciones (sobran: la persona 2 se abrumó). Son tres cosas de fondo:
1. **El orden lo tiene que saber la persona.** PAILA lo sabe (está en el código), pero se lo deja a ella.
2. **El estado es de mentira.** "Hecho" es una marca, no lo que de verdad pasa con la música; por eso no se desarma cuando
   corresponde.
3. **Cada herramienta aplica por su lado.** Si el orden de aplicar importa (tags antes de mover, mover antes de exportar),
   la persona tiene que acertarlo.

## 3. Tres formas de resolverlo

### A. El camino
Inicio pasa a ser un camino de 5 etapas, siempre en el mismo orden:
1. Conocer tu música
2. Limpiar (repetidos y basura)
3. Nombres y datos (nombres, internet y discos, juntos)
4. Ordenar carpetas
5. Mejorar el sonido

Cada etapa muestra qué falta, en una frase, y un solo botón. Si volvés atrás y cambiás algo, las etapas siguientes pasan a
**"para repasar"** y dicen qué cambió ("cambiaste 12 nombres: Organizar tiene 12 temas para mover"). La barra lateral muestra
las etapas arriba; las 26 pantallas quedan plegadas en "Herramientas".
- *A favor:* cambia poco por dentro y se puede hacer por partes.
- *En contra:* la persona igual entra pantalla por pantalla, y los loops 1 y 2 siguen ahí. Solo se avisan.

### B. Una sola revisión
PAILA hace sola todo lo que es mirar, en el orden correcto: analiza, busca repetidos, busca en internet, arma los nombres,
calcula carpetas. Después te muestra **una sola lista de propuestas**, agrupada ("30 repetidos", "120 nombres", "45 discos con
tapa", "265 temas a su carpeta"), con un tilde por grupo y la posibilidad de abrir cada uno. Un solo **Aplicar** lo hace en el
orden que no rompe nada: papelera → tags → tapas → mover. Si rechazás algo, lo que dependía se recalcula solo.
- *A favor:* los loops desaparecen, porque el orden es de PAILA. La persona 2 y la persona 1 habrían terminado en minutos.
- *En contra:* es el cambio más grande. Hay que proponer "mover a carpetas" sobre los tags que *van a quedar*, no los de hoy.

### C. Por objetivo
Inicio pregunta qué querés hacer:
- ordenar mi música;
- mejorar la calidad;
- pasar una lista al pendrive;
- preparar para pinchar.

Cada objetivo es un asistente con sus pasos.
- *A favor:* muy claro para alguien nuevo.
- *En contra:* los objetivos se pisan entre sí ("ordenar" y "mejorar" tocan los mismos temas) y los loops quedan entre
  asistentes.

## 4. Recomendación

**B como corazón y A como cara.** El camino de A es lo que se ve, y la etapa más pesada, "Ordenar tu música" (Limpiar + Nombres y datos + Carpetas),
funciona como la revisión única de B. "Mejorar el sonido" y "Usar tu música" (listas, pendrive, DJ) quedan como etapas propias,
porque no se pisan con lo anterior.

Arreglos de base que hacen falta con cualquier opción:
- **Un solo orden** en la barra lateral, Inicio y los textos.
- **El estado sale de la música, no de marcas.** "Repetidos: 0 grupos sin revisar" se calcula; si después llega un repetido,
  vuelve a aparecer.
- **"Para repasar":** cada etapa guarda con qué datos se hizo. Si cambiaron, avisa qué y cuántos.
- **Organizar mira lo que va a quedar**, tags pendientes incluidos.
- **Internet vuelve a preguntar** cuando cambia el nombre de un tema.
- **Un botón principal por pantalla**; Aplicar en verde (ya está).

## 5. Cómo seguir

1. El autor elige: A, B, C o la mezcla. Va a `docs/DECISIONES.md`.
2. Un boceto navegable (HTML) del camino elegido, para probarlo con clics antes de programar.
3. Construirlo por etapas, empezando por "Ordenar tu música" (donde se trabaron los tres).
4. Una prueba con alguien nuevo, con las mismas tareas que la persona 2, y comparar los tiempos (la persona 2: 17 min en nombres,
   24 min en NAPIA, 3 de 6 tareas).

## 6. Idea del autor: pestañas que avanzan (D)

"Pestañas donde dentro de esas secciones haya otras, que se avance de izquierda a derecha" (1/11). Boceto:
`bocetos-usabilidad/d-pestanas.png`.

- **Arriba, 6 pestañas en orden:** Conocer → Limpiar → Nombres y datos → Ordenar → Mejorar el sonido → Usar. Cada pestaña
  muestra su estado: ✓ hecha, ! para repasar, número si falta.
- **Adentro, las partes en orden,** cada una con un solo botón principal.
- **Fijo arriba:** buscador, Escuchando, Historial, Papelera, Configuración. **Abajo:** el reproductor.
- **No obliga:** cualquier pestaña se puede tocar; el orden avisa, no bloquea.
- **Entra en una notebook:** las herramientas para DJ y el modo avanzado van dentro de "Usar", no como pestañas propias.

Es la opción A con otra forma: la barra lateral desaparece y el avance se ve de izquierda a derecha. Se combina con B (la
revisión única) dentro de "Ordenar".
