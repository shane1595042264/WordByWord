import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useCallback, useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * KAN-338: the read toggle set `disabled` on itself while its write was in flight.
 * Browsers blur a focused button the instant it becomes disabled, so every keyboard
 * press dropped focus to <body>, and the book-complete celebration (which captures
 * document.activeElement on mount) had nothing to restore focus to on dismiss.
 *
 * jsdom does not implement that blur, so the browser behaviour is reproduced with a
 * MutationObserver below. Without it these tests would pass against the old code.
 */

// One router for every render: handleBackToDashboard closes over it, and a fresh
// identity per render would re-register the shortcut (which sets provider state)
// forever.
const router = { push: vi.fn() }
vi.mock('next/navigation', () => ({
  useRouter: () => router,
}))

vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

let resolveWrite: (bookJustCompleted: boolean) => void = () => {}
const markAsRead = vi.fn(
  () => new Promise<boolean>(resolve => { resolveWrite = resolve }),
)
const markAsUnread = vi.fn(async () => {})

vi.mock('@/lib/repositories', () => ({
  SectionRepository: class {
    markAsRead = markAsRead
    markAsUnread = markAsUnread
  },
}))

import { ReaderToolbar } from '../reader-toolbar'
import { BookCompleteCelebration } from '../book-complete-celebration'
import { ShortcutProvider } from '@/hooks/use-shortcuts'
import { TooltipProvider } from '@/components/ui/tooltip'

const noop = () => {}

function Harness() {
  const [isRead, setIsRead] = useState(false)
  const [celebrating, setCelebrating] = useState(false)
  // Stable identity, as page.tsx provides: the toolbar's shortcut registrations
  // re-run whenever a callback they close over changes, and register() sets state.
  const handleReadToggle = useCallback((bookJustCompleted?: boolean) => {
    setIsRead(r => !r)
    if (bookJustCompleted) setCelebrating(true)
  }, [])
  return (
    <ShortcutProvider>
      <TooltipProvider>
        <ReaderToolbar
          bookId="b1"
          sectionTitle="Chapter 1"
          isRead={isRead}
          sectionId="s1"
          viewMode="text"
          onViewModeChange={noop}
          readingMode="scroll"
          onReadingModeChange={noop}
          onReadToggle={handleReadToggle}
          sectionProgress={0}
          currentPage={1}
          totalSectionPages={1}
          startPage={1}
          onPrevPage={noop}
          onNextPage={noop}
          canGoPrev={false}
          canGoNext={false}
          format="epub"
        />
        {celebrating && (
          <BookCompleteCelebration bookTitle="A Book" onDismiss={() => setCelebrating(false)} />
        )}
      </TooltipProvider>
    </ShortcutProvider>
  )
}

const toggle = () => screen.getByRole('button', { name: 'Mark as Read' }) as HTMLButtonElement

let observer: MutationObserver
beforeEach(() => {
  // Focus returning to the toggle opens its Radix tooltip, whose popper measures
  // itself with ResizeObserver; jsdom has none and the throw unmounts the tree.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  markAsRead.mockClear()
  // Browser behaviour jsdom lacks: a focused element that becomes disabled loses focus.
  // jsdom's blur() is a no-op on a disabled element, so move focus to a throwaway
  // input and remove it, which leaves activeElement on <body> as a browser would.
  observer = new MutationObserver(records => {
    for (const r of records) {
      const el = r.target as HTMLButtonElement
      if (el.disabled && document.activeElement === el) {
        const sink = document.createElement('input')
        document.body.appendChild(sink)
        sink.focus()
        sink.remove()
      }
    }
  })
  observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['disabled'] })
})

afterEach(() => {
  observer.disconnect()
  vi.unstubAllGlobals()
})

/** Let the MutationObserver callbacks and pending microtasks run. */
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })

/** Click the toggle and wait until the write is actually pending (past the dynamic import). */
async function pressToggle(button: HTMLElement) {
  fireEvent.click(button)
  await waitFor(() => expect(markAsRead).toHaveBeenCalledTimes(1))
  await flush()
}

describe('reader toolbar read toggle focus (KAN-338)', () => {
  it('keeps focus on the toggle while the write is in flight and after it settles', async () => {
    render(<Harness />)
    const button = toggle()
    button.focus()

    await pressToggle(button)

    // Busy, but still focusable: aria-disabled rather than the native attribute.
    expect(button.disabled).toBe(false)
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(button)

    await act(async () => { resolveWrite(false) })
    await flush()

    expect(button.getAttribute('aria-disabled')).toBe('false')
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(document.activeElement).toBe(button)
  })

  it('ignores a second press while the first write is still in flight', async () => {
    render(<Harness />)
    const button = toggle()
    button.focus()

    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(markAsRead).toHaveBeenCalled())
    await flush()
    expect(markAsRead).toHaveBeenCalledTimes(1)

    await act(async () => { resolveWrite(false) })
    await flush()
  })

  it('returns focus to the toggle when the book-complete celebration is dismissed', async () => {
    render(<Harness />)
    const button = toggle()
    button.focus()

    await pressToggle(button)
    await act(async () => { resolveWrite(true) })
    await flush()

    const dialog = screen.getByRole('dialog')
    expect(dialog.contains(document.activeElement)).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Continue Reading' }))
    // The card fades out for 300ms before onDismiss unmounts it.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(button)
  })
})
