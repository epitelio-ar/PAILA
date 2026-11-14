// Marcas del arranque del lado de la interfaz (hora del reloj, en ms): viajan con el aviso de que la biblioteca ya se ve y
// el proceso principal las pasa a su cuenta (electron/main.ts: Exportar diagnóstico y scripts/arranque.ts).
export const marcasArranque: Record<string, number> = {}
export const marcaArranque = (k: string) => { marcasArranque[k] ??= performance.timeOrigin + performance.now() }
