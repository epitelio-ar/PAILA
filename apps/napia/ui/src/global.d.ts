// Tipos globales de la pantalla de NAPIA: window.napia (el puente con el proceso principal) y los de Vite (imágenes, CSS).
/// <reference types="vite/client" />
import type { NapiaApi } from '@paila/shared/napia'

declare global {
  interface Window { napia: NapiaApi }
}
