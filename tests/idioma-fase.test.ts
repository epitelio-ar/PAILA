// Lo que dice el análisis en curso pasa al otro idioma al cambiarlo (main.ts lo traduce con enEsteIdioma). Prueba de
// El autor del 28/10: puso la app en inglés con el análisis andando y seguía "Analizando calidad, BPM y tono…".
import { describe, expect, it } from 'vitest'
import '@paila/core/queue'
import '@paila/core/precise'
import { enEsteIdioma } from '@paila/shared/idioma'

describe('el texto del análisis en curso cambia de idioma', () => {
  it('castellano → inglés y vuelta', () => {
    expect(enEsteIdioma('Analizando calidad, BPM y tono…', 'en')).toBe('Analyzing quality, BPM and key…')
    expect(enEsteIdioma('Analyzing quality, BPM and key…', 'es')).toBe('Analizando calidad, BPM y tono…')
  })
})
