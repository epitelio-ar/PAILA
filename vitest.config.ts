import { configDefaults, defineConfig } from 'vitest/config'

// Las copias del proyecto que dejan los agentes de código en .claude/worktrees: sus tests no son de acá.
// Tiempo por test más generoso: con varias sesiones trabajando a la vez, ffmpeg y el análisis compiten por el procesador.
// Con 20 s fallaban los de audio (análisis, huellas, guardar tags, WAV → FLAC) mientras otras sesiones analizaban: tardan
// 5 a 10 veces más con la PC cargada, sin estar mal. 90 s alcanza y un test trabado igual se corta (ningún test pide menos).
// Los ffmpeg de los tests corren con prioridad normal (core/lowpriority.ts): en prioridad baja, con la PC ocupada por otras
// sesiones, casi no recibían procesador y los tests se cortaban por tiempo (22/10).
export default defineConfig({ test: { exclude: [...configDefaults.exclude, '.claude/**', '**/out/**', '**/dist/**'], testTimeout: 90_000, hookTimeout: 90_000, globalSetup: ['tests/esperar-medicion.ts'], env: { PAILA_PRIORIDAD_NORMAL: '1' } } })
