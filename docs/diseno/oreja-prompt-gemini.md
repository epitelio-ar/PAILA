# Prompt para Gemini: las 5 orejas del termómetro

**Qué adjuntar:** `apps\paila\build\arte\oreja-original.jpg` (la oreja de hoy, fondo crema, 2000×2000). Es el **nivel 4, "Bastante"**.

**Cómo:** todo en **un mismo chat**, bajando de a un nivel: 4 → 3 (algo) → 2 (un poquito) → 1 (limpia), y al final 5 (desastre) si el límite de Gemini lo permite. Guardá cada una con su nombre (`oreja-3-algo.png`, `oreja-2-un-poquito.png`, `oreja-1-limpia.png`, `oreja-5-desastre.png`). El fondo crema lo recorto yo.

Si en algún paso la oreja se empieza a mover, cambiar de tamaño o de estilo, pedile: "Volvé a partir de la primera imagen que te mandé (la original) y hacé solo este cambio".

---

## Mensaje 1 (con la imagen adjunta) → nivel 3, "Algo"

> Te mando una ilustración estilo cómic de una oreja humana con cera que chorrea. Vamos a hacer una escala de 5 niveles de cera, del 1 al 5:
> 1 = limpia (nada de cera) · 2 = un poquito · 3 = algo · **4 = bastante (esta imagen)** · 5 = desastre.
>
> **No redibujes la oreja: editá la imagen original y tocá solo la zona de la cera.** La oreja tiene que quedar idéntica, del mismo tamaño (ocupando casi todo el cuadro) y con el mismo nivel de detalle realista. Devolvela en la misma resolución que la original (2000×2000).
>
> En todas las versiones mantené **exactamente** todo lo demás: el mismo encuadre y tamaño (cuadrada, la oreja en la misma posición, mismo ángulo y mismo lugar), el mismo dibujo de la oreja con sus pliegues, sus pelitos y su contorno negro grueso, los mismos colores de piel, la misma trama de puntos (semitono), las mismas luces y el mismo fondo liso color crema. No agregues texto, marcos, manos ni otros objetos. **Lo único que cambia es la cantidad de cera**, siempre del mismo color ámbar brillante y con el mismo estilo de dibujo.
>
> Ahora hacé el **nivel 3 (algo)**: más o menos la mitad de cera que en esta imagen. Un hilo de cera que sale del oído y baja un poco por el lóbulo, terminando en una sola gota que todavía no se desprende. Sin salpicaduras.

## Mensaje 2 → nivel 2, "Un poquito"

> Perfecto. Ahora el **nivel 2 (un poquito)**: misma imagen, pero apenas una gotita chica de cera asomando en la entrada del oído, sin chorrear afuera. Casi limpia. Todo lo demás igual.

## Mensaje 3 → nivel 1, "Limpia"

> Ahora el **nivel 1 (limpia)**: nada de cera. El oído limpio y oscuro, sin gotas ni chorros, la piel sana con un brillo prolijo. Todo lo demás igual, mismo encuadre.

## Mensaje 4 → nivel 5, "Desastre" (si da el límite)

> Último: el **nivel 5 (desastre)**, partiendo de la **primera imagen que te mandé** (la del nivel 4). Muchísima más cera: el oído desbordado, chorros gruesos que salen por varios lados y cubren parte de la concha y el lóbulo, varias gotas grandes colgando y cayendo, y salpicaduras alrededor sobre el fondo crema. Exagerado y gracioso, de historieta, pero sin perder la forma de la oreja ni salirse del encuadre.

---

**Para revisar cuando estén las cinco:** puestas una al lado de la otra, la oreja no se tiene que mover (mismo tamaño y lugar), la cera tiene que crecer de a poco de la 1 a la 5 y el color de la cera tiene que ser el mismo en todas. Guardalas en `apps\paila\build\arte\` o mandalas por el chat.
