/**
 * Compile-time proof that pdfjs-dist's real typings satisfy the structural
 * interfaces text-layer.ts declares, so the viewer can hand
 * `await import('pdfjs-dist')` and a real PageViewport straight through
 * without casts.
 *
 * `import type` is erased at build time, so this does NOT pull pdfjs-dist into
 * any runtime bundle (the repo rule is about runtime imports, which call
 * `new DOMMatrix()` and break SSR). The assertions are the typed assignments
 * inside `compileTimeAssertions`, a function that is type-checked but never
 * called — if pdfjs-dist or text-layer.ts drifts, `npx tsc --noEmit` reports
 * the exact mismatched property under src/lib/pdf-text. The runtime `it`
 * exists only so vitest counts the file.
 */
import { describe, it, expect } from 'vitest'
import type * as Pdfjs from 'pdfjs-dist'
import type { PdfjsTextLayerModule, PdfViewportLike } from '../text-layer'

function compileTimeAssertions(pdfjsModule: typeof Pdfjs, pageViewport: Pdfjs.PageViewport): void {
  // The module object `await import('pdfjs-dist')` resolves to must be usable as the `pdfjs` argument.
  const moduleIsAssignable: PdfjsTextLayerModule = pdfjsModule
  // A real PageViewport (whose `rawDims` pdf.js types as `Object`) must be usable as the `viewport` argument.
  const viewportIsAssignable: PdfViewportLike = pageViewport
  void moduleIsAssignable
  void viewportIsAssignable
}

describe('pdfjs-dist typings vs pdf-text structural interfaces', () => {
  it('the pdfjs module object and PageViewport are assignable (checked at compile time)', () => {
    // Deliberately not invoked: its parameters have no runtime values. Compiling is the test.
    expect(typeof compileTimeAssertions).toBe('function')
  })
})
