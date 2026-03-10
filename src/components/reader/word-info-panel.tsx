'use client'

import { useState, useRef, useCallback, useEffect, type CSSProperties } from 'react'
import { ShortcutButton } from '@/components/ui/shortcut-button'
import type { NibWord } from '@/lib/nib'
import type { TranslationResult } from '@/lib/services/translation-service'
import type { TargetLanguage } from '@/lib/services/settings-service'

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
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null)
  const [pinnedPos, setPinnedPos] = useState<{ x: number; y: number } | null>(null)
  const dragging = useRef(false)
  const dragStart = useRef({ mouseX: 0, mouseY: 0, panelX: 0, panelY: 0 })

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

  // Settings
  const [targetLang, setTargetLang] = useState<TargetLanguage>('zh')
  const [apiKey, setApiKey] = useState<string | null>(null)

  // Load settings on mount
  useEffect(() => {
    import('@/lib/services/settings-service').then(({ SettingsService }) => {
      const svc = new SettingsService()
      const s = svc.getSettings()
      setTargetLang(s.targetLanguage)
      setApiKey(s.anthropicApiKey)
    })
  }, [])

  // Check if already in vocab
  useEffect(() => {
    setCheckingVocab(true)
    import('@/lib/services/vocab-service').then(({ VocabService }) => {
      const svc = new VocabService()
      svc.exists(word.text, word.sentence.text).then(exists => {
        setAddedToVocab(exists)
        setCheckingVocab(false)
      })
    })
  }, [word])

  // Auto-translate when word changes (and we have an API key)
  useEffect(() => {
    if (!apiKey) {
      setTranslation(null)
      setTranslating(false)
      return
    }

    let cancelled = false
    setTranslating(true)
    setTranslation(null)
    setTranslationError(null)
    setExplanation(null)
    setShowExplanation(false)

    import('@/lib/services/translation-service').then(({ TranslationService }) => {
      const svc = new TranslationService(apiKey)
      svc.translateWord(word.text, word.sentence.text, targetLang)
        .then(result => {
          if (!cancelled) {
            setTranslation(result)
            setTranslating(false)
          }
        })
        .catch(err => {
          if (!cancelled) {
            setTranslationError(err.message || 'Translation failed')
            setTranslating(false)
          }
        })
    })

    // Also lazy-load the explanation in the background
    import('@/lib/services/translation-service').then(({ TranslationService }) => {
      const svc = new TranslationService(apiKey)
      // We need to wait for translation to complete before explaining
      // This is handled separately when user clicks "See explanation"
    })

    return () => { cancelled = true }
  }, [word, apiKey, targetLang])

  // Auto-translate sentence when in sentence mode
  useEffect(() => {
    if (panelMode !== 'sentence' || !apiKey) {
      setSentenceTranslation(null)
      setSentenceTranslating(false)
      return
    }

    let cancelled = false
    setSentenceTranslating(true)
    setSentenceTranslation(null)

    const sentenceText = word.sentence.text
    const paragraphText = word.paragraph?.sentences
      ? word.paragraph.sentences.map((s: any) => s.text).join(' ')
      : sentenceText

    import('@/lib/services/translation-service').then(({ TranslationService }) => {
      const svc = new TranslationService(apiKey)
      svc.translateSentence(sentenceText, paragraphText, targetLang)
        .then(result => {
          if (!cancelled) {
            setSentenceTranslation(result.translation)
            setSentenceTranslating(false)
          }
        })
        .catch(() => {
          if (!cancelled) {
            setSentenceTranslation('Translation failed.')
            setSentenceTranslating(false)
          }
        })
    })

    return () => { cancelled = true }
  }, [word, apiKey, targetLang, panelMode])

  // Load explanation lazily
  const handleLoadExplanation = useCallback(async () => {
    if (explanation || explaining || !apiKey || !translation) return
    setExplaining(true)
    setShowExplanation(true)

    try {
      const { TranslationService } = await import('@/lib/services/translation-service')
      const svc = new TranslationService(apiKey)
      const result = await svc.explainTranslation(
        word.text,
        word.sentence.text,
        translation.translation,
        targetLang,
      )
      setExplanation(result.explanation)
    } catch {
      setExplanation('Failed to load explanation.')
    } finally {
      setExplaining(false)
    }
  }, [explanation, explaining, apiKey, translation, word, targetLang])

  // Add to vocabulary
  const handleAddVocab = useCallback(async () => {
    if (!translation || addedToVocab) return

    try {
      const { VocabService } = await import('@/lib/services/vocab-service')
      const svc = new VocabService()
      await svc.add({
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
      setAddedToVocab(true)
    } catch (err) {
      console.error('Failed to add vocab:', err)
    }
  }, [translation, addedToVocab, word, targetLang, explanation, bookTitle, sectionTitle])

  // ── Positioning (same drag logic as before) ──

  const getAnchorPos = useCallback((): { x: number; y: number } | null => {
    if (!anchorEl) return null
    const rect = anchorEl.getBoundingClientRect()
    return { x: rect.right + 8, y: rect.top - 4 }
  }, [anchorEl])

  const getPosition = useCallback((): { x: number; y: number } => {
    if (isPinned && pinnedPos) return pinnedPos
    return getAnchorPos() ?? { x: 200, y: 200 }
  }, [isPinned, pinnedPos, getAnchorPos])

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
      setDragOffset({ x: dragStart.current.panelX + dx, y: dragStart.current.panelY + dy })
    }

    const onUp = () => {
      dragging.current = false
      setIsPinned(true)
      setPinnedPos((_prev) => dragOffset ?? getPosition())
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [getPosition, dragOffset])

  useEffect(() => {
    if (dragging.current && dragOffset) setPinnedPos(dragOffset)
  }, [dragOffset])

  useEffect(() => {
    setIsPinned(false)
    setPinnedPos(null)
    setDragOffset(null)
  }, [word])

  const pos = isPinned && pinnedPos ? pinnedPos : (dragOffset && dragging.current ? dragOffset : getAnchorPos() ?? { x: 200, y: 200 })
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
              ) : !apiKey ? (
                <p className="text-xs text-muted-foreground/60">
                  Set your Anthropic API key in Settings to enable translation.
                </p>
              ) : null}
            </>
          ) : (
            /* ── Word mode: full word info panel ── */
            <>
              {/* Word + pronunciation row */}
              <div className="flex items-baseline gap-2 mb-0.5">
                <span className="font-bold text-xl leading-tight">{word.text}</span>
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
              ) : !apiKey ? (
                <div className="mt-2 mb-2 text-xs text-muted-foreground/60">
                  Set your Anthropic API key in Settings to enable translation.
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
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {explanation}
                    </p>
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
