/**
 * PDF text layer + vim cursor — public entry point.
 *
 * Nothing here imports pdfjs-dist (see text-layer.ts), so this barrel is safe
 * to import from any component, including ones that render during SSR.
 */

export * from './types'
export * from './text-layer'
export * from './sentences'
export * from './cursor'
