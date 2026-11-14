// Tipos globales de la interfaz: window.paila (el puente con el proceso principal) y los de Vite (imágenes, CSS).
/// <reference types="vite/client" />
import type { PailaApi } from '@paila/shared/types'

declare global {
  interface Window { paila: PailaApi }
}
