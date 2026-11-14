# Motor de operaciones único y recuperación con la app abierta

Diseño para cerrar el masterplan 2 (MASTERPLAN-2, A10; docs/PENDIENTES.md, punto 1). Escrito el 21/10/2026 sobre `main`
en e47464e; construido el mismo día (ver "Cómo quedó", al final, y la bitácora `docs/archivo/pruebas/2026-10-21-cierre-masterplan-2.md`).

**En pocas palabras:** hoy cada función que toca archivos (tags, papelera, Organizar, reemplazar, convertir…) ya anota
en el diario *antes* de actuar, y al abrir PAILA se termina o se vuelve atrás lo que quedó a medias. Lo que falta es que
todas pasen por **un mismo camino**, con los mismos chequeos antes de empezar y la misma verificación al final, y que la
recuperación también corra **cuando vuelve un disco con la app abierta**, sin tener que cerrarla.

---

## 1. Qué existe hoy

| Pieza | Dónde | Qué hace |
|---|---|---|
| Candado de operaciones | `core/oplock.ts` (`lib.ops.run`) y `ctx.withPaused` en `electron/main.ts` | Nunca dos operaciones a la vez ni durante un escaneo; pausa el análisis mientras se escribe. |
| Diario | `core/journal.ts` (`OpJournal`, tabla `op_journal`, v16) | `begin` antes de tocar el archivo (sincronizado al disco), `phase`/`hash`, `done(annotate)` = resultado en la base y anotación borrada en UNA transacción, `drop` si no se hizo. |
| Recuperación | `core/recovery.ts` (`recover`, `report`, `markSeen`) | Al abrir, con el candado tomado: mira dónde quedó cada archivo y lo termina, lo da por no hecho, lo vuelve atrás o lo deja "para revisar". Si el disco no está, espera a la próxima apertura. Vacía las carpetas de trabajo (`shrink`, `convert`) y las copias de resguardo sueltas. |
| Historial | `core/history.ts` | Una lista común de tandas (tags, papelera, organizar, limpieza, reemplazo, conversión, playlist) con deshacer que revalida el estado de hoy. |
| Mover sin pisar | `core/safefs.ts` (`moveNoClobber`, `trashBatch`) | Nunca pisa; tandas de papelera con nombre único. |
| Huella del sonido | `core/audiohash.ts` (`pcmHash`) | Verifica que lo escrito suene idéntico. |

Cómo lo usa cada operación hoy:

| Operación | Diario | Verifica al final | Chequeos antes | Vista previa | Historial |
|---|---|---|---|---|---|
| Tags, nombres, extensión (`changes.ts`, `changeFile`) | `tags` / `deshacer-tags`, con copia de resguardo y fase `resguardo` | huella del sonido | propios (sample pack, archivo cambiado) | Cambios pendientes | sí |
| Tapas (`covers.ts`, `foldercover.ts`) y Volumen parejo (`replaygain.ts`) | van por Cambios pendientes → igual que tags | huella | propios | sí | sí (como tags) |
| Organizar (`organizer.ts`) y deshacer | `organizar` / `deshacer-organizar` | que el archivo exista en el destino (implícito) | destino libre, sin tags se saltea, samples afuera | sí (`plan`) | sí |
| Papelera / restaurar (`trash.ts`) | `papelera` / `restaurar` | — | sample pack | no (es un clic) | sí |
| Limpieza de Espacio (`space.ts trashFiles`) | `limpieza` | — | propios | sí (lista) | sí |
| Reemplazo (`replace.ts`) y deshacer | `reemplazo` / `deshacer-reemplazo` | **no** (copia sin `fsync` ni huella; `transplantTags` sí verifica) | sample pack, nombre libre | escucha A/B | sí |
| Convertir (`convert.ts`) y WAV→FLAC (`space.ts`) | por el Reemplazo | huella (sin pérdida) o lectura entera (con pérdida) | propios | sí | sí (como conversión) |
| Vaciar papelera (`purge.ts`) | `vaciar` con la lista de la tanda | que ya no exista | escribir VACIAR, solo dentro de `_PAILA/papelera`, sin junctions, nunca samples | sí (lista con tamaños) | marca `purged_at` |
| Bandeja: mover a `usados/` y `no-sirvió/` (`inboxflow.ts moveDone`) | **no** | tamaño (si copia entre discos) | — | simulación | el reemplazo sí; el movimiento no |
| A pendrive (`export.ts`), al celular (`carry.ts`) | **no** (no tocan la biblioteca; reanudan sin pisar) | tamaño | espacio libre (`statfs`) | sí | no |

## 2. Qué falta

1. **Una sola entrada.** Cada módulo arma su propio "anotar → mover → anotar el resultado". El mismo patrón está
   copiado seis veces, con diferencias chicas (quién hace `pruneEmpty`, quién verifica, quién no).
2. **Chequeos previos centrales**, antes del primer archivo y para toda la tanda: disco conectado, **espacio libre**
   (hoy solo lo miran pendrive y celular), destino libre, no es sample pack (regla A6, hoy repartida en 10 archivos),
   el archivo no cambió desde la vista previa (tamaño y fecha), y que el candado esté tomado.
3. **Verificación y confirmación iguales para todos.** El reemplazo no verifica la copia; mover no confirma que el
   destino tenga el mismo tamaño; la Bandeja y el reemplazo copian sin `fsync`.
4. **La vista previa común** (un `Plan` con pasos que la interfaz muestra igual en todas las pantallas). Hoy cada
   pantalla tiene la suya; eso puede seguir, pero el plan que se aplica tiene que ser el mismo objeto que se mostró.
5. **Bandeja y pendrive sin diario.** La Bandeja mueve archivos de la persona (de la carpeta de descargas a `usados/`):
   un corte entre copiar y borrar el original (entre discos) puede dejar el tema dos veces. El pendrive no toca la
   biblioteca: alcanza con que siga reanudando sin pisar (no hace falta diario).
6. **Recuperación con la app abierta** (sección 5).
7. **Deshacer que sigue al tema.** Organizar → reemplazar → deshacer Organizar falla con "El archivo ya no está"
   (test en `tests/errores-conocidos.test.ts`). El reemplazo ya sigue al tema (A8); Organizar no.

## 3. Cómo es el motor (`packages/core/ops/`)

Una operación es **un plan de pasos**. El motor los corre siempre igual:

```
plan → chequeos previos (toda la tanda) → por cada paso: diario → hacer → verificar → confirmar → Historial
```

### Tipos (en `packages/shared/types/ops.ts`)

```ts
type StepKind =
  | 'mover'      // un archivo de la biblioteca cambia de lugar (organizar, papelera, restaurar, limpieza, deshacer)
  | 'escribir'   // se reescribe el archivo en su lugar (tags, tapa, volumen; puede cambiar el nombre o la extensión)
  | 'reemplazar' // el archivo de hoy va a la papelera y entra otro (reemplazo, conversión, WAV→FLAC)
  | 'borrar'     // borrado real, solo dentro de _PAILA/papelera (vaciar)
  | 'sacar'      // un archivo de afuera de la biblioteca se mueve (Bandeja → usados/ o no-sirvió/)

interface Step {
  kind: StepKind
  rootId: number | null    // null = fuera de la biblioteca (Bandeja)
  fileId: number | null
  src: string              // relativa a la raíz (o absoluta si rootId es null)
  dst: string | null
  size: number; mtime: number // cómo estaba el archivo cuando se armó el plan
  op: JournalOp            // el nombre que ya usan el diario y el Historial ('organizar', 'papelera'…)
  data?: unknown           // lo que necesita `annotate` (lo mismo que hoy guarda cada módulo)
}

interface Plan { op: string; batch: string; steps: Step[]; bytesNeeded: Record<number, number> /* por disco */ }
```

### Lo que pone el motor (una vez) y lo que pone cada operación

- **El motor** (`ops/run.ts`): chequeos previos; diario (`OpJournal`, sin cambios); `moveNoClobber`; copia con
  `copyDurable` (`fsync`); verificación según el tipo de paso; `pruneEmpty` de las carpetas que quedan vacías; avance y
  cancelación (entre pasos, nunca en medio de uno); el resumen (hechos, salteados con motivo, fallados).
- **Cada operación** (un adaptador chico): arma el `Plan` (lo que hoy hace `organizer.plan`, `trash.toTrash`…), y da
  `annotate(step)` (lo que hoy son `logMove`, `logTrash`, `logReplaceUndo`, `markPurged`…) y, para `escribir` y
  `reemplazar`, el "hacer" propio (`writeVerified`, `transplantTags`, la conversión).

### Chequeos previos (`ops/checks.ts`), antes de tocar el primer archivo

| Chequeo | Si falla |
|---|---|
| El candado está tomado por esta operación (`ops.busy`) | error de programación: no arranca |
| Cada disco del plan está conectado (`rootPath`) | no arranca; dice qué disco falta |
| Espacio libre por disco ≥ lo que suma el plan + 5 % (`statfs`; mover dentro del mismo disco no suma) | no arranca; dice cuánto falta |
| Ningún paso toca un sample pack (`kind = 'produccion'` o regla de carpeta) | ese paso se saca del plan, con motivo |
| El archivo sigue como en la vista previa (tamaño y fecha) | ese paso se saltea: "cambió desde la vista previa" |
| El destino está libre (y no hay dos pasos con el mismo destino) | ese paso se saltea |
| No está en una carpeta excluida (`PIONEER`, Ableton) | ese paso se saca |

Regla: **lo que afecta a toda la tanda frena todo; lo que afecta a un archivo lo saltea y lo cuenta**.

### Verificar y confirmar, por tipo de paso

| Paso | Verificar | Confirmar (`journal.done` + `annotate`) |
|---|---|---|
| `mover` | el destino existe con el mismo tamaño y el origen ya no | la base al día |
| `escribir` | huella del sonido igual a la de antes (como hoy `changeFile`) | tags, nombre y la anotación en una transacción |
| `reemplazar` | la copia nueva tiene el tamaño del archivo elegido antes de los tags y, después de los tags, la huella del elegido (sin pérdida) o se lee entera (con pérdida) | la fila del tema y `replacements` |
| `borrar` | ya no existe | `purged_at` |
| `sacar` | el destino existe con el mismo tamaño (y el original ya no) | `inbox_items` |

Si la verificación falla: se vuelve atrás ese paso con lo mismo que usa la recuperación (sección 4), queda "fallado"
con el motivo y la tanda sigue con el próximo.

## 4. La recuperación, por tipo de paso (no por operación)

`recovery.ts` hoy decide por `e.op` (diez casos). Con el motor, decide por el tipo de paso, que es lo que importa para
saber dónde puede haber quedado el archivo:

- `mover`: igual que hoy (si está en el origen, no se hizo; si está en el destino, completar; si no está en ningún
  lado, para revisar).
- `escribir`: igual que hoy (copia de resguardo verificada por huella).
- `reemplazar`: igual que hoy (el viejo vuelve de la papelera, la copia a medias va a la papelera).
- `borrar`: igual que hoy (`markPurged` de lo que ya no está).
- `sacar`: si está en el origen y en el destino con el mismo tamaño, se quita el origen de la lista de la Bandeja y
  queda el destino (el original es una descarga, no se borra: va a `usados/` con número); si está solo en uno, completar
  o no hecho.

Las filas viejas del diario (con `op` y sin tipo de paso) se leen con una tabla fija `op → tipo`, así una anotación
escrita por la versión anterior se sigue resolviendo bien.

## 5. Recuperación con la app abierta (cuando vuelve un disco)

Hoy `recover()` corre una sola vez (`electron/main.ts`, al abrir). Si un SSD se desconectó en medio de Organizar y se
vuelve a enchufar con PAILA abierta, la anotación queda pendiente hasta reabrir.

**Cuándo correr:**
1. **Antes de cada escaneo** (que ya toma el candado): es el momento en que PAILA "mira" los discos.
2. **Al volver un disco**: un vigilante liviano en el proceso principal que, **solo si hay anotaciones pendientes por
   disco desconectado**, prueba cada 10 s si ese disco está (`findMount` de `volumes.ts`, que ya busca por número de
   serie aunque cambie la letra). Sin anotaciones pendientes no hace nada (cero costo).
3. **Antes de cada operación del motor** que toque ese disco (último seguro).

**Cómo, sin pisar una operación en marcha:**
- Corre **con el candado tomado** (`lib.ops.run('terminando lo que quedó a medias en <disco>')`). Si el candado está
  ocupado, espera al próximo intento (no se encola en silencio).
- Con el candado tomado no hay ninguna operación en marcha, **siempre que todo lo que escribe en el diario tome el
  candado**. El motor lo exige (chequeo 1). Hoy ya lo hacen todas: van por `withPaused` o `ops.run`.
- Solo resuelve las anotaciones **de los discos que volvieron** (`recover(db, deps, { roots: [id] })`).
- **No vacía las carpetas de trabajo** (`shrink`, `convert`, la carpeta de los ZIP de la Bandeja) ni limpia copias de
  resguardo: eso sigue siendo solo al abrir, porque una conversión en segundo plano puede estar usándolas.
- Avisa igual que al abrir: un evento `recovery:update` refresca `RecoveryNotice` en Inicio y sale un cartelito
  ("Volvió el disco SSD EXTERNO: se terminaron 3 movimientos que habían quedado a medias").

**`report()` y `bootAt`:** hoy `report` separa "a medias de antes" de "en marcha ahora" por la hora de apertura. Con la
recuperación en vivo, la separación pasa a ser por estado: pendiente sin resolver y sin operación en marcha = a medias.

## 6. Cómo migrar sin romper nada, y en qué orden

Una operación por vez, cada una en su commit, con todos los tests en verde antes de pasar a la siguiente. La forma de
la base no cambia; si hace falta guardar el tipo de paso, una migración nueva **al final** de `migrations.ts`
(`op_journal.step`, nullable; las filas viejas se leen con la tabla `op → tipo`).

| # | Qué | Por qué en este orden | Tests |
|---|---|---|---|
| 0 | `core/ops/` (tipos, `run`, `checks`) sin usarlo todavía | base para todo | unitarios del motor con pasos falsos y cortes simulados |
| 1 | Papelera y restaurar | lo más simple (`mover`) y lo más usado | `trash.test.ts`, `recovery.test.ts`, `history.test.ts` sin cambios |
| 2 | Organizar y su deshacer, **siguiendo al tema** (arregla el error de la sección 2.7) | el caso de la prueba de corte real | `organizer*.test.ts` + el `it.fails` pasa a `it` |
| 3 | Limpieza de Espacio | `mover` a la papelera, sin tema | `space.test.ts` |
| 4 | Vaciar papelera (`borrar`) | ya tiene diario por tanda; se suma el chequeo central | `trash.test.ts` (vaciar) |
| 5 | Reemplazo y su deshacer (`reemplazar`), con la verificación que falta | lo usan 6, 7 y la Bandeja | `replace.test.ts`, `bandeja-vigilada.test.ts` |
| 6 | Convertir y WAV→FLAC | van arriba del Reemplazo: casi nada que cambiar | `convert.test.ts`, `space.test.ts` |
| 7 | Tags, nombres y extensiones (`escribir`); tapas y volumen vienen solos (van por Cambios pendientes) | el más delicado: se mueve al final, ya probado el motor | `changes*.test.ts`, `tags-formats.test.ts`, `tapas-volumen.test.ts`, `npm run corpus` |
| 8 | Bandeja (`sacar`) y el ZIP ya usado a `usados/` | nuevo diario | `bandeja-vigilada.test.ts` (el `it.fails` del ZIP) |
| 9 | Recuperación en vivo (sección 5) | necesita el motor para garantizar el candado | `recovery.test.ts`: disco que vuelve con la app "abierta" (raíz que aparece entre dos llamadas) |

Reglas para cada paso de la migración:
- El adaptador llama al motor y **devuelve lo mismo que antes** (mismos tipos en `@paila/shared`): la interfaz y el
  IPC no cambian.
- El `annotate` es la misma función de hoy (`logMove`, `logTrash`…): la base queda escrita igual, y el Historial y
  la recuperación siguen leyendo lo mismo.
- Si una operación tiene algo que el motor no cubre, se queda con su camino viejo y se anota acá; no se fuerza.

## 7. Lo que no entra en el motor

- **Pendrive y celular** (`export.ts`, `carry.ts`): copian hacia afuera y nunca tocan la biblioteca; ya reanudan sin
  pisar. Solo toman el candado.
- **Playlists**: no tocan archivos (salvo `.m3u8` exportados, que son nuevos).
- **El análisis**: solo lee.

## 8. Aparte (pedido del autor): dos esperas sin aviso

No son del motor, pero salen de la misma revisión (PENDIENTES, punto 3):

- **Espectrograma de un set de 1 h**: `electron/media.ts` (`spectrogram`) decodifica el tema entero con
  `showspectrumpic` para una imagen de 640 px; queda guardado en `userData/spectro/`, así que tarda solo la primera vez.
  Propuesta: para temas de más de 15 min, decodificar a menor frecuencia de muestreo o saltando (la imagen tiene el
  mismo ancho igual) y mostrar "armando el espectrograma…" mientras tanto.
- **Columnas Nota y BPM vacías mientras analiza**: un tema sin analizar muestra la celda en blanco, igual que uno que
  no se pudo analizar. Propuesta: "…" en gris con ⓘ "Todavía no se analizó (va N de M)" si el análisis está andando,
  y "—" con el motivo si falló. Va en `@paila/shared/trackinfo.ts` (el valor de cada columna) y es de interfaz.

## 9. Los errores del punto 3, cómo se arreglan (etapa 2)

Cada uno tiene su test en `tests/errores-conocidos.test.ts` (o en `bandeja-vigilada.test.ts`):

| Error | Causa encontrada | Arreglo propuesto |
|---|---|---|
| "Ella Baila Sola … DEL Records 2023.mp3" | **No es un MP3**: es un WebM (Opus de YouTube) con extensión .mp3; `sniff()` no reconoce WebM | `sniff` reconoce la marca EBML (`1A 45 DF A3` + "webm"/"matroska") → `WEBM` con extensión `webm`; el paso de extensiones lo propone. Actualizar `tests/corpus.json` (caso `extension-webm`, `escribe: false` hasta tener tags de WebM). |
| Deshacer Organizar tras reemplazar | `Organizer.undo` busca `to_rel` exacto | seguir el `rel_path` de hoy del tema (como `Replacer.undo`), con la extensión de hoy |
| Madonna MP3/FLAC (3,4 s) | por nombre el margen es ±3 s fijos; por sonido ya es ±3 s o 2 % | mismo margen que el sonido: ±3 s o 2 % de la duración |
| Loop sin armonía, versiones < 15 s, WAV < 3 s | límites de la huella acústica | pedir decisión (en `docs/DECISIONES.md`); los tests quedan como `it.todo` |
| "Lobo suelto / Cordero atado" | "Volumen 1/2" + "(CD 1)/(CD 2)" se toma como doble | pedir regla (¿dos discos si cada volumen tiene tapa propia o su propia lista en internet?) |
| ZIP ya usado en la Bandeja | `moveDone` mueve el tema abierto, no el ZIP | cuando todos los temas de un ZIP se usaron o no sirvieron, el ZIP va a `usados/` (por el motor, paso `sacar`) |
| .csv "Título - Artista" | `context.ts` crea `new Wanted(lib.db)` sin el nombre oficial | pasarle un `OfficialName` armado con `officialFindings` (confianza alta) |
| Títulos que repiten el artista | **ya resuelto** en Arreglar nombres; lo del celular venía de tags sin arreglar | — (test que lo fija) |
| Títulos cortados en 30 letras | sin internet solo se avisa | si el nombre del archivo trae el mismo título más largo, proponerlo (con aviso) |
| Artistas con ";" o " x " | `artistParts` no los separa; `nameList` no separa ";" | sumar ";" y " x " (con espacios) a los dos; "Malcolm X" no se parte |

## 10. Cómo quedó (21/10/2026)

Construido en `packages/core/ops/` (`types.ts`, `checks.ts`, `run.ts`) y `packages/core/recoverywatch.ts`. Diferencias con
lo de arriba, a propósito:
- **Sin migración nueva.** El tipo de paso sale de la operación del diario (`OP_KIND` en `ops/types.ts`), así que no hizo
  falta guardar una columna más; las anotaciones viejas se leen igual. Se sumó la operación `bandeja`.
- **Mover pasa entero por el motor** (papelera, restaurar, Organizar y su deshacer, limpieza de Espacio, Bandeja).
  **Reemplazar y escribir** usan los chequeos centrales (`checkOrThrow`) y siguen con su propio "hacer": el reemplazo ganó
  la copia con `fsync` y la comparación de tamaño; la escritura de tags ya hacía diario → resguardo → huella → confirmar.
- **Vaciar** sigue con un diario por tanda (no por archivo: serían miles de escrituras sincronizadas) y suma los chequeos.
- **La recuperación** sigue decidiendo por operación para lo que ya existía (cada una anota distinto en la base) y por
  tipo de paso para lo nuevo (la Bandeja).
- **El candado se exige solo donde se registra** (`guardWith`, la app y los ayudantes de `scripts/`): los tests que llaman
  a los módulos directo no lo necesitan.
- No hay "vista previa común" nueva: cada pantalla sigue mostrando su plan, y los chequeos previos corren sobre ese mismo
  plan. Si más adelante se quiere una pantalla de confirmación única, `Step[]` ya es el formato.

## 11. Cómo se completó (23/10/2026, masterplan 4, 4B.4)

Detalle y corrida supervisada en `docs/pruebas/2026-10-23-motor-unico.md`.
- **Copiar afuera** (`ops/copy.ts`, paso `copiar`, op `copia`): el pendrive, el celular, las listas y los archivos de otros programas, con diario, copia temporal, verificación y el Historial (`copies_log`, v39). Cambia lo de la sección 7: el pendrive ahora sí pasa por el motor.
- **Respaldo por paso** (`ops/backup.ts`, `backups`, v40): antes de escribir lo de adentro de archivos, una copia verificada.
- **Una sola confirmación** en pantalla (`Confirmar.tsx`): es la "vista previa común" que acá quedaba para más adelante.
- **Chequeos nuevos:** el disco de destino de lo que va afuera, y que nada de tu Música caiga adentro de un sample pack, de PIONEER o de un proyecto de Ableton.
