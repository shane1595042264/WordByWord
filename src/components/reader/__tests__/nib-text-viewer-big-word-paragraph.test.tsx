import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRef } from 'react'
import { act, render } from '@testing-library/react'
import { NibTextViewer, type NibTextViewerHandle } from '../nib-text-viewer'
import { NibMarkdownParser } from '@/lib/nib/markdown-parser'
import { NibDocument } from '@/lib/nib/models'

// Paragraphs of 1, 2 and 5 sentences, an inline formula, and a display equation.
const MARKDOWN = [
  'Alpha b $x+y$ c end.',
  'One. Two two.',
  '$$a^2 + b^2$$',
  'P1. P2. P3. P4. P5.',
  'Last para.',
].join('\n\n')

describe('NibTextViewer W skips formulas, S jumps paragraphs (KAN-409)', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    Element.prototype.scrollIntoView = vi.fn()
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    container.remove()
  })

  const doc = new NibDocument(new NibMarkdownParser().parse(MARKDOWN, 'T', 'A'))
  const words = doc.pages.flatMap(p => p.paragraphs.flatMap(para => para.allWords))
  const indexOf = (text: string) => words.findIndex(w => w.text === text)

  function renderViewer(vimMode: 'normal' | 'sentence' = 'normal') {
    const ref = createRef<NibTextViewerHandle>()
    render(
      <NibTextViewer ref={ref} nibDocument={doc} sectionTitle="S" scrollContainerRef={{ current: container }} vimMode={vimMode} />,
      { container },
    )
    return ref
  }

  const cursorText = (ref: React.RefObject<NibTextViewerHandle | null>) => words[ref.current!.getVimCursorIndex()].text
  const selected = (ref: React.RefObject<NibTextViewerHandle | null>) => ref.current!.getSelectedText()

  it('fixture sanity: the inline formula is several LaTeX tokens', () => {
    const b = indexOf('b')
    expect(words[b + 1].isLatex).toBe(true)
    expect(words[b + 2].isLatex).toBe(true)
  })

  it('w from b lands on the formula, W from b lands past it', () => {
    const ref = renderViewer()
    act(() => ref.current!.selectWordByIndex(indexOf('b')))
    act(() => ref.current!.selectWordByDelta(1))
    expect(words[ref.current!.getVimCursorIndex()].isLatex).toBe(true)

    act(() => ref.current!.selectWordByIndex(indexOf('b')))
    act(() => ref.current!.selectBigWordByDelta(1))
    expect(cursorText(ref)).toBe('c')

    // and back over it the other way
    act(() => ref.current!.selectBigWordByDelta(-1))
    expect(cursorText(ref)).toBe('b')
  })

  it('3W crosses the inline formula and the display equation counts as one hop', () => {
    const ref = renderViewer()
    act(() => ref.current!.selectWordByIndex(indexOf('Two')))
    for (let i = 0; i < 3; i++) act(() => ref.current!.selectBigWordByDelta(1))
    // two. -> (display equation skipped) P1. -> P2.
    expect(cursorText(ref)).toBe('P2.')
  })

  it('W with only LaTeX ahead stays put', () => {
    const only = new NibDocument(new NibMarkdownParser().parse('Word\n\n$$z^2$$', 'T', 'A'))
    const ref = createRef<NibTextViewerHandle>()
    render(<NibTextViewer ref={ref} nibDocument={only} sectionTitle="S" scrollContainerRef={{ current: container }} vimMode="normal" />, { container })
    act(() => ref.current!.selectWordByIndex(0))
    act(() => ref.current!.selectBigWordByDelta(1))
    expect(ref.current!.getVimCursorIndex()).toBe(0)
  })

  it('S from any sentence lands on the first sentence of the next paragraph', () => {
    const ref = renderViewer('sentence')
    act(() => ref.current!.selectSentenceByDelta(0))
    expect(selected(ref)).toBe('Alpha b x + y c end.')

    // 1-sentence paragraph -> first sentence of the 2-sentence one
    act(() => ref.current!.selectParagraphByDelta(1))
    expect(selected(ref)).toBe('One.')

    // from its 2nd sentence -> the display equation
    act(() => ref.current!.selectSentenceByDelta(1))
    expect(selected(ref)).toBe('Two two.')
    act(() => ref.current!.selectParagraphByDelta(1))
    expect(words[ref.current!.getVimCursorIndex()].isLatex).toBe(true)

    act(() => ref.current!.selectParagraphByDelta(1))
    expect(selected(ref)).toBe('P1.')

    // mid 5-sentence paragraph -> next paragraph in one S
    act(() => ref.current!.selectSentenceByDelta(3))
    expect(selected(ref)).toBe('P4.')
    act(() => ref.current!.selectParagraphByDelta(1))
    expect(selected(ref)).toBe('Last para.')

    // last paragraph: S stays put
    act(() => ref.current!.selectParagraphByDelta(1))
    expect(selected(ref)).toBe('Last para.')
  })

  it('2S hops two paragraphs; backward goes to the paragraph start, then the previous paragraph', () => {
    const ref = renderViewer('sentence')
    act(() => ref.current!.selectSentenceByDelta(0))
    for (let i = 0; i < 2; i++) act(() => ref.current!.selectParagraphByDelta(1))
    expect(words[ref.current!.getVimCursorIndex()].isLatex).toBe(true)
    for (let i = 0; i < 2; i++) act(() => ref.current!.selectParagraphByDelta(1))
    expect(selected(ref)).toBe('Last para.')

    act(() => ref.current!.selectSentenceByDelta(-2))
    expect(selected(ref)).toBe('P4.')
    act(() => ref.current!.selectParagraphByDelta(-1))
    expect(selected(ref)).toBe('P1.')
    act(() => ref.current!.selectParagraphByDelta(-1))
    expect(words[ref.current!.getVimCursorIndex()].isLatex).toBe(true)
    act(() => ref.current!.selectParagraphByDelta(-1))
    expect(selected(ref)).toBe('One.')
  })
})
