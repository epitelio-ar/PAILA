# @paila/diseno

El diseño compartido de PAILA y NAPIA (Fase G). Para usarlo en una app:

```css
@import '@paila/diseno/estilos.css';
```
```html
<div id="root" data-app="paila"> <!-- o "napia": cambia el acento, el resto es igual -->
```
```tsx
import { Boton, Nota, Pildora, Caja, Aviso, Barra, Ventana, Info } from '@paila/diseno'
```

- Tokens: `tokens.css`. Componentes: `componentes.css` y `src/`. Muestrario: `src/Muestrario.tsx` (en PAILA, Ctrl+Mayús+M).
- Palabras y tono: `docs/GLOSARIO.md`. Mapa completo: `docs/MAPA.md`.
- Los colores de las notas de calidad son fijos (`--nota-ap` … `--nota-f`): no se tocan por pantalla.
