// Tipos de turnos.mjs (avisos de turno entre sesiones).
export interface Aviso { tipo: 'copia' | 'medicion' | 'laboratorio' | 'verificar' | 'ajeno'; quien: string; que: string; desde: string | null; pid: number | null; vivo: boolean | null; edad: number | null; aMano?: boolean; texto: string }
export interface Avisos { activos: Aviso[]; olvidados: Aviso[] }
export interface Proceso { pid: number; nombre?: string; ruta?: string; cmd?: string }
export declare const MEDICION: string
export declare const VERIFICANDO: string
export declare const carpetaTrabajo: () => string
export declare const COPIA_LOCK: () => string
export declare const carpetaLab: () => string
export declare const turnoLab: () => string
export declare function duracion(ms: number): string
export declare function vivo(pid: number | null | undefined): boolean | null
export declare function quienSoy(): string
export declare function leerAvisos(opts?: { ahora?: number; copia?: string; medicion?: string; laboratorio?: string; verificando?: string; ajeno?: string }): Avisos
export declare function textoAviso(a: Omit<Aviso, 'texto'>): string
export declare function pesados(procesos: Proceso[], propios?: Set<number>): { esperar: string[]; avisar: string[] }
export declare function procesosAhora(): Proceso[]
type OpcionesAviso = { esperar?: number; pausa?: number; avisar?: (m: string) => void; ignorar?: (a: Aviso) => boolean }
export declare function tomarAviso(archivo: string, tipo: Aviso['tipo'], texto: string, opts?: OpcionesAviso): Promise<(() => void) | null>
export declare function tomarCopia(copia: string, opts: { que: string; horas?: number; propio?: boolean; esperar?: number; quien?: string; avisar?: (m: string) => void }): Promise<() => void>
export declare function tomarMedicion(que: string, opts?: { esperar?: number; quien?: string; avisar?: (m: string) => void }): Promise<() => void>
export declare function esperarSinMedicion(opts?: { avisar?: (m: string) => void; tope?: number }): Promise<number>
export declare function pantallaTurnos(avisos: Avisos, extra?: { esperar?: string[]; avisar?: string[] }): string
export declare function turnoAjeno(): string
export declare function tomarTurnoAjeno(que: string, archivo?: string): () => void
