import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'

import { BookCompleteCelebration } from '../book-complete-celebration'

/**
 * KAN-335: the celebration was the last hand-rolled modal in src/ — no dialog role,
 * no focus move/trap/restore, nothing marking the reader behind the backdrop inert,
 * and an 8s auto-dismiss that re-armed on every caller render.
 */

const dialog = () => screen.getByRole('dialog')
const continueButton = () => screen.getByRole('button', { name: 'Continue Reading' })

afterEach(() => {
  vi.useRealTimers()
})

describe('BookCompleteCelebration accessibility', () => {
  it('exposes a modal dialog named by the Congratulations heading', () => {
    render(<BookCompleteCelebration bookTitle="Structure and Interpretation" onDismiss={vi.fn()} />)

    const el = dialog()
    expect(el.getAttribute('aria-modal')).toBe('true')

    const labelId = el.getAttribute('aria-labelledby')
    expect(labelId).toBeTruthy()
    expect(document.getElementById(labelId!)?.textContent).toBe('Congratulations!')
  })

  it('moves focus to Continue Reading on mount and restores it on unmount', () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    const { unmount } = render(<BookCompleteCelebration bookTitle="A Book" onDismiss={vi.fn()} />)
    expect(document.activeElement).toBe(continueButton())

    unmount()
    expect(document.activeElement).toBe(trigger)

    trigger.remove()
  })

  it('marks the rest of the page inert while open and releases it on unmount', () => {
    const { unmount } = render(<BookCompleteCelebration bookTitle="A Book" onDismiss={vi.fn()} />)

    const root = dialog().parentElement!
    const others = Array.from(document.body.children).filter(el => el !== root)
    expect(others.length).toBeGreaterThan(0)
    for (const el of others) {
      expect(el.hasAttribute('inert')).toBe(true)
      expect(el.getAttribute('aria-hidden')).toBe('true')
    }
    expect(root.hasAttribute('inert')).toBe(false)

    unmount()
    for (const el of others) {
      expect(el.hasAttribute('inert')).toBe(false)
      expect(el.hasAttribute('aria-hidden')).toBe(false)
    }
  })

  it('keeps Tab and Shift+Tab inside the card', () => {
    render(<BookCompleteCelebration bookTitle="A Book" onDismiss={vi.fn()} />)

    // Continue Reading is the only focusable control, so both directions cycle onto it.
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(continueButton())

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(continueButton())

    expect(dialog().contains(document.activeElement)).toBe(true)
  })

  it('hides the confetti layer and the emoji from assistive tech', () => {
    render(<BookCompleteCelebration bookTitle="A Book" onDismiss={vi.fn()} />)

    const confetti = document.querySelector('.animate-confetti-fall')!.parentElement!
    expect(confetti.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByText('\u{1F389}').parentElement?.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('BookCompleteCelebration auto-dismiss timer', () => {
  it('self-dismisses 8s after mount even when the caller re-renders it', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()

    // The real caller passes a fresh inline arrow every render, so the timer used to be
    // cleared and re-armed by any unrelated state change on the reader page.
    const { rerender } = render(
      <BookCompleteCelebration bookTitle="A Book" onDismiss={() => onDismiss()} />
    )

    act(() => { vi.advanceTimersByTime(5000) })
    rerender(<BookCompleteCelebration bookTitle="A Book" onDismiss={() => onDismiss()} />)
    act(() => { vi.advanceTimersByTime(2999) })
    expect(onDismiss).not.toHaveBeenCalled()

    // 8s from mount, plus the 300ms fade-out before onDismiss fires.
    act(() => { vi.advanceTimersByTime(1 + 300) })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('dismisses on Escape', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    render(<BookCompleteCelebration bookTitle="A Book" onDismiss={onDismiss} />)

    fireEvent.keyDown(document, { key: 'Escape' })
    act(() => { vi.advanceTimersByTime(300) })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
