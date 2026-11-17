import { describe, it, expect, beforeEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ThemeToggle } from '../theme-toggle'
import { THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from '@/lib/theme'

const root = () => document.documentElement

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear()
    root().classList.remove('dark')
    root().style.colorScheme = ''
  })

  it('cycles system, light, dark and back, saving all but system', () => {
    render(<ThemeToggle />)
    const button = () => screen.getByRole('button')
    expect(button().getAttribute('aria-label')).toBe('Theme: match system')

    fireEvent.click(button())
    expect(button().getAttribute('aria-label')).toBe('Theme: light')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
    expect(root().classList.contains('dark')).toBe(false)

    fireEvent.click(button())
    expect(button().getAttribute('aria-label')).toBe('Theme: dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(root().classList.contains('dark')).toBe(true)
    expect(root().style.colorScheme).toBe('dark')

    // Back to system: the key is removed so the OS preference wins again.
    // jsdom has no matchMedia, which must read as "not dark", not throw.
    fireEvent.click(button())
    expect(button().getAttribute('aria-label')).toBe('Theme: match system')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
    expect(root().classList.contains('dark')).toBe(false)
  })

  it('keeps two toggles on the page in step', () => {
    render(<><ThemeToggle /><ThemeToggle /></>)
    const [a, b] = screen.getAllByRole('button')
    act(() => { fireEvent.click(a) })
    expect(b.getAttribute('aria-label')).toBe('Theme: light')
  })
})

describe('THEME_INIT_SCRIPT', () => {
  beforeEach(() => {
    localStorage.clear()
    root().classList.remove('dark')
  })

  it('applies a saved dark choice before React runs', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    new Function(THEME_INIT_SCRIPT)()
    expect(root().classList.contains('dark')).toBe(true)
  })

  it('never throws when matchMedia is missing', () => {
    expect(() => new Function(THEME_INIT_SCRIPT)()).not.toThrow()
    expect(root().classList.contains('dark')).toBe(false)
  })
})
