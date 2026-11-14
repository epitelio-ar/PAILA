// Tipos de captura.mjs (una captura de una pantalla de PAILA o NAPIA).
export declare function copiaDeLaBase(carpeta?: string): string
export declare function guion(o: { pantalla?: string | null; cabina?: boolean; js?: string }): string
export declare function capturar(o: { pantalla?: string | null; salida?: string; cabina?: boolean; tamano?: string; js?: string; espera?: number; datos?: string | null; napia?: boolean; argumentos?: string[]; escribir?: boolean; limite?: number; escala?: number }): string
