'use client'

import { useState, useRef, useCallback, useEffect, type CSSProperties } from 'react'
import ReactMarkdown from 'react-markdown'
import { ShortcutButton } from '@/components/ui/shortcut-button'
import type { NibWord } from '@/lib/nib'
import type { TranslationResult } from '@/lib/services/translation-service'
import { SettingsService, type TargetLanguage } from '@/lib/services/settings-service'
import { toast } from 'sonner'
import { reportLazyImportError } from '@/lib/lazy-import-error'

interface WordInfoPanelProps {
  word: NibWord
  /** The DOM element of the clicked word span — used to position the panel */
  anchorEl: HTMLElement | null
  showIndicators?: boolean
  onClose: () => void
  /** Book title for vocab context */
  bookTitle?: string
  /** Section title for vocab context */
  sectionTitle?: string
  /** Panel mode: 'word' shows word translation, 'sentence' shows sentence translation */
  panelMode?: 'word' | 'sentence'
}

/**
 * Floating word-info panel with:
 *  - AI-powered contextual translation (single definition)
 *  - Pronunciation (IPA)
 *  - Add to vocabulary book
 *  - Lazy-loaded explanation
 *  - Draggable + pinnable
 */
export function WordInfoPanel({ word, anchorEl, showIndicators, onClose, bookTitle, sectionTitle, panelMode = 'word' }: WordInfoPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [isPinned, setIsPinned] = useState(false)
  const [pinnedPos, setPinnedPos] = useState<{ x: number; y: number } | null>(null)
  const dragging = useRef(false)
  const dragStart = useRef({ mouseX: 0, mouseY: 0, panelX: 0, panelY: 0 })
  const liveDragPos = useRef<{ x: number; y: number } | null>(null)
  const [, forceRender] = useState(0)
  // Tracks in-flight handleLoadExplanation request so word-change cleanup
  // and unmount can abort the lazy explanation call.
  const explanationControllerRef = useRef<AbortController | null>(null)
  // Synchronous in-flight guard for handleAddVocab. addedToVocab is React
  // state and only flips after the awaited svc.add resolves, so re-entries
  // during the dynamic import + IDB write window otherwise sail through and
  // create duplicate vocab rows / shanejli KB entries (no DELETE endpoint).
  const addingVocabRef = useRef(false)
  // Holds the IDB id returned by svc.add() for a word saved this session, so an
  // AI explanation loaded *after* the add (add-then-explain order) can be
  // written back onto the saved entry instead of being silently discarded.
  const addedVocabIdRef = useRef<string | null>(null)

  // Track anchor position changes from scrolling (re-render when anchor moves)
  const [anchorPos, setAnchorPos] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!anchorEl || isPinned) return
    const update = () => {
      const rect = anchorEl.getBoundingClientRect()
      setAnchorPos({ x: rect.right + 8, y: rect.top - 4 })
    }
    update()
    // Listen for scroll on all ancestors to update position
    const scrollParents: HTMLElement[] = []
    let el: HTMLElement | null = anchorEl.parentElement
    while (el) {
      if (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth) {
        scrollParents.push(el)
        el.addEventListener('scroll', update, { passive: true })
      }
      el = el.parentElement
    }
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update, { passive: true })
    return () => {
      scrollParents.forEach(p => p.removeEventListener('scroll', update))
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [anchorEl, isPinned])

  // Translation state
  const [translation, setTranslation] = useState<TranslationResult | null>(null)
  const [translating, setTranslating] = useState(false)
  const [translationError, setTranslationError] = useState<string | null>(null)

  // Explanation state (lazy loaded)
  const [explanation, setExplanation] = useState<string | null>(null)
  const [explaining, setExplaining] = useState(false)
  const [showExplanation, setShowExplanation] = useState(false)

  // Sentence translation state
  const [sentenceTranslation, setSentenceTranslation] = useState<string | null>(null)
  const [sentenceTranslating, setSentenceTranslating] = useState(false)

  // Vocab state
  const [addedToVocab, setAddedToVocab] = useState(false)
  const [checkingVocab, setCheckingVocab] = useState(true)

  // Settings — initialized synchronously from localStorage via SettingsService
  // (getSettings() is sync and SSR-guarded). Reading these lazily instead of
  // via an async effect avoids a stale-default render window that used to fire
  // a redundant, wrong-language translation on every panel open.
  const [targetLang] = useState<TargetLanguage>(() => new SettingsService().getSettings().targetLanguage)
  const [apiKey] = useState<string | null>(() => new SettingsService().getSettings().anthropicApiKey)

  // ESC key closes panel (works in both vim and non-vim modes)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    // Use capture phase to intercept before vim engine
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [onClose])

  // Click outside panel closes it and deselects word
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      const panel = panelRef.current
      if (!panel) return
      // If click is inside the panel, ignore
      if (panel.contains(e.target as Node)) return
      // If click is on the anchor word itself, ignore (let word click handler deal with it)
      if (anchorEl && anchorEl.contains(e.target as Node)) return
      onClose()
    }
    // Use a small delay to avoid closing immediately from the click that opened the panel
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleMouseDown)
    }, 100)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleMouseDown)
    }
  }, [onClose, anchorEl])

  // Check if already in vocab
  useEffect(() => {
    let cancelled = false
    setCheckingVocab(true)
    // New word on the reused panel instance — drop any prior word's saved id so
    // a late explanation load can't be written onto the previous entry.
    addedVocabIdRef.current = null
    // Treat any rejection (IDB transient error, schema mismatch, chunk-load
    // failure) as unknown-state → leave the button usable; the add path has
    // its own error toast.
    const handleFailure = (err: unknown) => {
      if (cancelled) return
      console.warn('vocab existence check failed:', err)
      setAddedToVocab(false)
      setCheckingVocab(false)
    }
    import('@/lib/services/vocab-service').then(({ VocabService }) => {
      if (cancelled) return
      const svc = new VocabService()
      svc.exists(word.text, word.sentence.text).then(exists => {
        if (!cancelled) {
          setAddedToVocab(exists)
          setCheckingVocab(false)
        }
      }, handleFailure)
    }, handleFailure)
    return () => { cancelled = true }
  }, [word])

  // Detect if this is a block element (table, code, figure) that should use explanation mode
  const isBlockContent = !!(word.latexSource && (word.text.startsWith('[') || word.imageUrl))
  const isImageContent = !!word.imageUrl

  // Auto-translate when word changes. Translation now goes through the
  // backend proxy — no client-side API key required. Image explanation
  // (Claude Vision) still needs the user's key though, because the backend
  // doesn't have a URL-based vision endpoint yet.
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    // Abort any in-flight lazy explanation from the previous word so it
    // can't land on the new word's panel and burn an Anthropic call.
    explanationControllerRef.current?.abort()
    explanationControllerRef.current = null
    setTranslation(null)
    setTranslationError(null)
    setExplanation(null)
    setExplaining(false)
    setShowExplanation(false)

    if (isBlockContent) {
      // Block content (table/code/figure) → skip translation, auto-explain
      setTranslating(false)
      setShowExplanation(true)
      setExplaining(true)

      import('@/lib/services/translation-service').then(async ({ TranslationService }) => {
        const svc = new TranslationService(apiKey)
        try {
          let result: string
          if (isImageContent && word.imageUrl) {
            // Vision — still client-side; requires user's Anthropic key
            result = await svc.explainImage(word.imageUrl, word.sentence.text, controller.signal)
          } else {
            // Backend-proxied content explanation (table/code)
            result = await svc.explainContent(word.latexSource!, word.sentence.text, controller.signal)
          }
          if (!cancelled) {
            setExplanation(result)
            setExplaining(false)
          }
        } catch (err: any) {
          if (err?.name === 'AbortError') return
          if (!cancelled) {
            setExplanation(`Explanation failed: ${err.message}`)
            setExplaining(false)
          }
        }
      }, (err) => {
        // The dynamic import itself failed (e.g. stale chunk after a deploy);
        // clear the spinner that was set before the import so it can't hang.
        if (cancelled) return
        setExplanation('Explanation failed: could not load the translation module.')
        setExplaining(false)
        reportLazyImportError('image/content explanation import', err)
      })
    } else {
      // Regular word → backend-proxied translation
      setTranslating(true)
      import('@/lib/services/translation-service').then(({ TranslationService }) => {
        const svc = new TranslationService()
        svc.translateWord(word.text, word.sentence.text, targetLang, controller.signal)
          .then(result => {
            if (!cancelled) {
              setTranslation(result)
              setTranslating(false)
            }
          })
          .catch(err => {
            if (err?.name === 'AbortError') return
            if (!cancelled) {
              setTranslationError(err.message || 'Translation failed')
              setTranslating(false)
            }
          })
      }, (err) => {
        // Import rejected (stale chunk after a deploy) — clear the spinner set
        // before the import so it can't spin forever.
        if (cancelled) return
        setTranslationError('Could not load the translation module.')
        setTranslating(false)
        reportLazyImportError('word translation import', err)
      })
    }

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [word, apiKey, targetLang, isBlockContent, isImageContent])

  // Auto-translate sentence when in sentence mode (backend-proxied)
  useEffect(() => {
    if (panelMode !== 'sentence') {
      setSentenceTranslation(null)
      setSentenceTranslating(false)
      return
    }

    let cancelled = false
    const controller = new AbortController()
    setSentenceTranslating(true)
    setSentenceTranslation(null)

    const sentenceText = word.sentence.text
    const paragraphText = word.paragraph?.sentences
      ? word.paragraph.sentences.map((s: any) => s.text).join(' ')
      : sentenceText

    import('@/lib/services/translation-service').then(({ TranslationService }) => {
      const svc = new TranslationService()
      svc.translateSentence(sentenceText, paragraphText, targetLang, controller.signal)
        .then(result => {
          if (!cancelled) {
            setSentenceTranslation(result.translation)
            setSentenceTranslating(false)
          }
        })
        .catch((err) => {
          if (err?.name === 'AbortError') return
          if (!cancelled) {
            setSentenceTranslation('Translation failed.')
            setSentenceTranslating(false)
            toast.error('Sentence translation failed', { duration: 5000 })
            console.error('Sentence translation error:', err)
          }
        })
    }, (err) => {
      // Import rejected (stale chunk after a deploy) — clear the spinner set
      // before the import so it can't spin forever.
      if (cancelled) return
      setSentenceTranslation('Translation failed.')
      setSentenceTranslating(false)
      toast.error('Sentence translation failed', { duration: 5000 })
      reportLazyImportError('sentence translation import', err)
    })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [word, targetLang, panelMode])

  // Load explanation lazily (backend-proxied — no key needed)
  const handleLoadExplanation = useCallback(async () => {
    if (explanation || explaining || !translation) return
    explanationControllerRef.current?.abort()
    const controller = new AbortController()
    explanationControllerRef.current = controller
    setExplaining(true)
    setShowExplanation(true)

    try {
      const { TranslationService } = await import('@/lib/services/translation-service')
      const svc = new TranslationService()
      const contentText = word.latexSource || word.text
      const contextText = word.latexSource ? `${contentText}\n\nContext: ${word.sentence.text}` : word.sentence.text
      const result = await svc.explainTranslation(
        contentText,
        contextText,
        translation.translation,
        targetLang,
        controller.signal,
      )
      if (!controller.signal.aborted) {
        setExplanation(result.explanation)
        // Add-then-explain order: the entry was already saved with an empty
        // explanation. Write the freshly loaded AI text back onto it so it
        // persists across reloads and syncs cross-device. (Explain-then-add
        // needs nothing — svc.add() saves the populated explanation directly.)
        const savedId = addedVocabIdRef.current
        if (savedId) {
          try {
            const { VocabService } = await import('@/lib/services/vocab-service')
            await new VocabService().updateExplanation(savedId, result.explanation)
          } catch (persistErr) {
            console.error('Failed to persist explanation to saved vocab entry:', persistErr)
          }
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      if (!controller.signal.aborted) setExplanation('Failed to load explanation.')
    } finally {
      if (!controller.signal.aborted) setExplaining(false)
    }
  }, [explanation, explaining, translation, word, targetLang])

  // Add to vocabulary
  const handleAddVocab = useCallback(async () => {
    if (!translation || addedToVocab || addingVocabRef.current) return
    addingVocabRef.current = true

    try {
      const { VocabService } = await import('@/lib/services/vocab-service')
      const svc = new VocabService()
      const id = await svc.add({
        word: word.text,
        pronunciation: translation.pronunciation,
        translation: translation.translation,
        targetLanguage: targetLang,
        contextSentence: word.sentence.text,
        explanation: explanation,
        bookTitle: bookTitle ?? '',
        sectionTitle: sectionTitle ?? '',
        pageNumber: word.page.pageNumber,
      })
      addedVocabIdRef.current = id
      setAddedToVocab(true)
    } catch (err) {
      toast.error('Failed to save to vocabulary', { duration: 5000 })
      console.error('Failed to add vocab:', err)
    } finally {
      addingVocabRef.current = false
    }
  }, [translation, addedToVocab, word, targetLang, explanation, bookTitle, sectionTitle])

  // ── Positioning (same drag logic as before) ──

  const getAnchorPos = useCallback((): { x: number; y: number } | null => {
    return anchorPos
  }, [anchorPos])

  const getPosition = useCallback((): { x: number; y: number } => {
    if (isPinned && pinnedPos) return pinnedPos
    return anchorPos ?? { x: 200, y: 200 }
  }, [isPinned, pinnedPos, anchorPos])

  const clampToViewport = useCallback((x: number, y: number): { x: number; y: number } => {
    const panel = panelRef.current
    if (!panel) return { x, y }
    const pw = panel.offsetWidth
    const ph = panel.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    return {
      x: Math.max(4, Math.min(x, vw - pw - 4)),
      y: Math.max(4, Math.min(y, vh - ph - 4)),
    }
  }, [])

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragging.current = true
    const pos = getPosition()
    dragStart.current = { mouseX: e.clientX, mouseY: e.clientY, panelX: pos.x, panelY: pos.y }

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return
      const dx = ev.clientX - dragStart.current.mouseX
      const dy = ev.clientY - dragStart.current.mouseY
      const newPos = { x: dragStart.current.panelX + dx, y: dragStart.current.panelY + dy }
      liveDragPos.current = newPos
      forceRender(n => n + 1)
    }

    const onUp = () => {
      dragging.current = false
      const finalPos = liveDragPos.current
      if (finalPos) {
        setIsPinned(true)
        setPinnedPos(finalPos)
      }
      liveDragPos.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [getPosition])

  useEffect(() => {
    setIsPinned(false)
    setPinnedPos(null)
    liveDragPos.current = null
  }, [word])

  const pos = dragging.current && liveDragPos.current ? liveDragPos.current : (isPinned && pinnedPos ? pinnedPos : (anchorPos ?? { x: 200, y: 200 }))
  const clamped = clampToViewport(pos.x, pos.y)

  const style: CSSProperties = {
    position: 'fixed',
    left: clamped.x,
    top: clamped.y,
    zIndex: 50,
    width: '20rem',
    willChange: dragging.current ? 'transform' : undefined,
  }

  return (
    <div ref={panelRef} style={style} className="select-none">
      <div className="
        bg-background/95 backdrop-blur-xl
        border border-border/50
        rounded-xl shadow-xl shadow-black/15
        overflow-hidden
      ">
        {/* Drag handle bar */}
        <div
          onMouseDown={onDragStart}
          className="
            flex items-center justify-between px-3 py-1.5
            cursor-grab active:cursor-grabbing
            bg-muted/30 border-b border-border/20
            select-none
          "
        >
          <div className="flex gap-0.5 opacity-30">
            <span className="w-1 h-1 rounded-full bg-foreground/60" />
            <span className="w-1 h-1 rounded-full bg-foreground/60" />
            <span className="w-1 h-1 rounded-full bg-foreground/60" />
            <span className="w-1 h-1 rounded-full bg-foreground/60" />
            <span className="w-1 h-1 rounded-full bg-foreground/60" />
          </div>
          {isPinned && (
            <span className="text-[9px] text-muted-foreground/40 font-mono mx-2">pinned</span>
          )}
          <button
            className="text-muted-foreground/60 hover:text-foreground text-xs leading-none p-0.5 -mr-1"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Main content */}
        <div className="px-4 py-3">
          {panelMode === 'sentence' ? (
            /* ── Sentence mode: clean sentence translation ── */
            <>
              {/* Original sentence */}
              <p className="text-sm text-foreground/80 leading-relaxed mb-3">
                {word.sentence.text}
              </p>

              {/* Divider */}
              <div className="border-t border-border/20 mb-3" />

              {/* Translated sentence */}
              {sentenceTranslating ? (
                <div className="space-y-1.5 mb-2">
                  <div className="h-4 w-full bg-muted/40 rounded animate-pulse" />
                  <div className="h-4 w-4/5 bg-muted/40 rounded animate-pulse" />
                </div>
              ) : sentenceTranslation ? (
                <p className="text-base text-foreground/90 leading-relaxed">
                  {sentenceTranslation}
                </p>
              ) : null}
            </>
          ) : (
            /* ── Word mode: full word info panel ── */
            <>
              {/* Word + pronunciation row */}
              <div className="flex items-baseline gap-2 mb-0.5">
                <span className="font-bold text-xl leading-tight">
                  {word.imageUrl ? 'Figure' : word.latexSource && word.text.startsWith('[') ? word.text.replace(/[\[\]]/g, '') : word.text}
                </span>
                {translation?.pronunciation && (
                  <span className="text-sm text-muted-foreground/70 font-mono">
                    {translation.pronunciation}
                  </span>
                )}
                {translating && (
                  <span className="text-xs text-muted-foreground/50 animate-pulse">...</span>
                )}
              </div>

              {/* Part of speech */}
              {translation?.partOfSpeech && (
                <span className="text-xs text-muted-foreground/60 italic">
                  {translation.partOfSpeech}
                </span>
              )}

              {/* Translation */}
              {translating ? (
                <div className="mt-2 mb-2">
                  <div className="h-4 w-32 bg-muted/40 rounded animate-pulse" />
                </div>
              ) : translationError ? (
                <div className="mt-2 mb-2 text-xs text-red-400">
                  {translationError}
                </div>
              ) : translation ? (
                <div className="mt-2 mb-2">
                  <p className="text-base text-foreground/90 leading-snug">
                    {translation.translation}
                  </p>
                </div>
              ) : null}

              {/* Sentence context (subtle) */}
              <p className="text-xs text-muted-foreground/50 leading-relaxed mb-3 line-clamp-2">
                {word.sentence.text}
              </p>

              {/* Divider */}
              <div className="border-t border-border/20 mb-2" />

              {/* Action buttons row */}
              <div className="flex items-center justify-between">
                <ShortcutButton
                  shortcutId="word-panel:explain"
                  label="See explanation"
                  defaultKeys="e"
                  onClick={handleLoadExplanation}
                  disabled={!translation || (showExplanation && !!explanation)}
                  showHint={true}
                  className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-muted/50"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 16v-4M12 8h.01" />
                  </svg>
                  <span>{showExplanation ? 'Explanation' : 'See explanation'}</span>
                </ShortcutButton>

                <ShortcutButton
                  shortcutId="word-panel:add-vocab"
                  label="Add to vocabulary"
                  defaultKeys="a"
                  onClick={handleAddVocab}
                  disabled={!translation || addedToVocab || checkingVocab}
                  showHint={true}
                  className={`text-xs px-2 py-1 rounded-md ${
                    addedToVocab
                      ? 'text-green-500'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  }`}
                >
                  {addedToVocab ? (
                    <>
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                      <span>Added</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                      <span>Add to vocab</span>
                    </>
                  )}
                </ShortcutButton>
              </div>

              {/* Explanation area (lazy loaded, collapsible) */}
              {showExplanation && (
                <div className="mt-2 pt-2 border-t border-border/20">
                  {explaining ? (
                    <div className="space-y-1.5">
                      <div className="h-3 w-full bg-muted/40 rounded animate-pulse" />
                      <div className="h-3 w-4/5 bg-muted/40 rounded animate-pulse" />
                      <div className="h-3 w-3/5 bg-muted/40 rounded animate-pulse" />
                    </div>
                  ) : explanation ? (
                    <div className="text-xs text-muted-foreground leading-relaxed prose prose-xs prose-neutral dark:prose-invert max-w-none [&_h1]:text-sm [&_h1]:font-bold [&_h1]:mt-2 [&_h1]:mb-1 [&_h2]:text-xs [&_h2]:font-bold [&_h2]:mt-2 [&_h2]:mb-1 [&_h3]:text-xs [&_h3]:font-semibold [&_h3]:mt-1 [&_p]:my-1 [&_ul]:my-1 [&_ul]:pl-4 [&_li]:my-0.5 [&_strong]:text-foreground">
                      <ReactMarkdown>{explanation}</ReactMarkdown>
                    </div>
                  ) : null}
                </div>
              )}

              {/* Page info (very subtle) */}
              {showIndicators && (
                <p className="text-[10px] text-muted-foreground/30 mt-2">
                  p.{word.page.pageNumber} · para.{word.paragraph.index + 1} · w.{word.index + 1}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
