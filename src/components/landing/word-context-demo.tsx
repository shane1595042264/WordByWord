'use client'

import { useMemo, useState } from 'react'
import { NibTextParser } from '@/lib/nib/text-parser'
import { NibDocument, type NibWord } from '@/lib/nib/models'
import { cn } from '@/lib/utils'

/**
 * The hero demo, built on the real reader model: the passage goes through
 * NibTextParser into a NibDocument, exactly as a section does in the reader,
 * and the panel shows what NibWord.getAIContext() hands the AI.
 *
 * The passage is public domain: Henry David Thoreau, Walden (1854), "Reading".
 * The short explanations are hand-written samples; the live app asks the AI.
 */
const PASSAGE =
  'To read well, that is, to read true books in a true spirit, is a noble exercise, and one that will task the reader more than any exercise which the customs of the day esteem. It requires a training such as the athletes underwent, the steady intention almost of the whole life to this object. Books must be read as deliberately and reservedly as they were written.'

const SAMPLE_EXPLANATIONS: Record<string, string> = {
  reservedly: 'With restraint. Holding back quick judgement and letting the text speak first.',
  deliberately: 'Slowly and on purpose, with full attention rather than in a hurry.',
  task: 'A verb here: to make heavy demands on someone, to tax them.',
  esteem: 'To value or regard highly. Here, what the habits of the time admire.',
  noble: 'Worthy and admirable; of high character.',
  intention: 'A fixed aim kept over a long time, not a passing wish.',
}

const INITIAL_WORD = 'reservedly'

function bareWord(text: string): string {
  return text.toLowerCase().replace(/[^a-z]/g, '')
}

export function WordContextDemo({ className }: { className?: string }) {
  const doc = useMemo(
    () => NibDocument.fromData(new NibTextParser().parseText(PASSAGE, 'Walden', 'Henry David Thoreau')),
    [],
  )
  const sentences = useMemo(() => doc.pages.flatMap(p => p.paragraphs.flatMap(para => para.sentences)), [doc])

  const initial = useMemo(() => {
    for (const s of sentences) {
      const w = s.words.find(word => bareWord(word.text) === INITIAL_WORD)
      if (w) return w
    }
    return sentences[0].words[0]
  }, [sentences])

  const [selected, setSelected] = useState<NibWord>(initial)
  const sentence = selected.sentence
  const context = selected.getAIContext()
  const explanation = SAMPLE_EXPLANATIONS[bareWord(selected.text)]

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border bg-card shadow-[0_1px_2px_oklch(0.22_0.04_170/0.06),0_30px_60px_-30px_oklch(0.22_0.04_170/0.4)]',
        className,
      )}
    >
      <div className="px-6 pt-6 pb-5 sm:px-8 sm:pt-8">
        <p className="font-reading text-[17px] leading-[1.75] sm:text-[18px]">
          {sentences.map(s =>
            s.words.map(word => {
              const glossed = bareWord(word.text) in SAMPLE_EXPLANATIONS
              const isSelected = word === selected
              const inSentence = word.sentence === sentence
              return (
                <span key={`${s.index}-${word.index}`}>
                  <button
                    type="button"
                    tabIndex={glossed ? 0 : -1}
                    aria-pressed={isSelected}
                    onClick={() => setSelected(word)}
                    className={cn(
                      'rounded-[4px] px-[1px] transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      isSelected
                        ? 'bg-primary text-primary-foreground'
                        : inSentence
                          ? 'text-foreground hover:bg-primary/15'
                          : 'text-foreground/55 hover:bg-primary/10 hover:text-foreground',
                      glossed && !isSelected && 'underline decoration-primary/45 decoration-dotted decoration-[1.5px] underline-offset-[5px]',
                    )}
                  >
                    {word.text}
                  </button>{' '}
                </span>
              )
            }),
          )}
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          Henry David Thoreau, <span className="italic">Walden</span> (1854). Click any word.
        </p>
      </div>

      <div className="min-h-[164px] border-t bg-surface-sunken px-6 py-5 sm:px-8" aria-live="polite">
        <div key={`${sentence.index}-${selected.index}`} className="animate-rise-in">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="font-reading text-2xl font-medium italic tracking-tight">{context.word.replace(/[.,;:!?]$/, '')}</p>
            <p className="text-xs tabular-nums text-muted-foreground">
              Sentence {sentence.index + 1} of {sentences.length}, word {selected.index + 1}
            </p>
          </div>
          {explanation ? (
            <p className="mt-2 text-[15px] leading-relaxed">
              {explanation}
              <span className="ml-2 align-middle text-[11px] text-muted-foreground">sample</span>
            </p>
          ) : (
            <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
              Try a dotted word for a sample explanation.
            </p>
          )}
          <p className="mt-3 line-clamp-3 font-reading text-[14px] leading-relaxed text-muted-foreground">
            <span className="font-sans text-xs font-medium text-foreground">Sent with it: </span>
            {context.sentence}
          </p>
        </div>
      </div>
    </div>
  )
}
