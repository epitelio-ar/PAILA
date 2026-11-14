// Los textos del proceso principal de PAILA (el aviso al cerrar con PAILA trabajando y cómo se llama lo que está haciendo,
// que entra en "PAILA está …"), en castellano y en inglés (ver @paila/shared/idioma).
import { textos } from '@paila/shared/idioma'

export const T = textos({
  trabajando: { es: 'PAILA está trabajando', en: 'PAILA is working' },
  seguir: { es: 'Seguir', en: 'Keep going' },
  frenar: { es: 'Frenar y cerrar', en: 'Stop and close' },
  esta: { es: (what: string) => `PAILA está ${what}.`, en: (what: string) => `PAILA is ${what}.` },
  siCerras: {
    es: 'Si cerrás ahora, frena en el archivo que está y lo que falta queda sin hacer. Lo que ya hizo queda anotado y se puede deshacer desde el Historial.',
    en: "If you close now, it stops at the current file and the rest is left undone. What it already did is recorded and can be undone from the History.",
  },
  revisando: { es: 'revisando lo que quedó a medias la última vez', en: 'checking what was left half done last time' },
  cambiando: { es: 'cambiando archivos', en: 'changing files' },
})
