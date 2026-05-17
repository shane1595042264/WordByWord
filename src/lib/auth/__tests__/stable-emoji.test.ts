import { describe, it, expect } from 'vitest'
import { EMOJI_AVATARS, stableEmojiForId } from '../user-repository'

describe('stableEmojiForId', () => {
  it('returns the same emoji for the same id across calls', () => {
    const ids = ['user_abc', '01HX...', 'a1595042264@gmail.com', '']
    for (const id of ids) {
      expect(stableEmojiForId(id)).toBe(stableEmojiForId(id))
    }
  })

  it('returns an emoji from EMOJI_AVATARS', () => {
    const ids = ['1', 'abc', 'def', 'xyz', 'a1595042264', 'juntao.li@pmg.com']
    for (const id of ids) {
      expect(EMOJI_AVATARS).toContain(stableEmojiForId(id))
    }
  })

  it('distributes across the emoji list (not always the same emoji)', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 100; i++) {
      seen.add(stableEmojiForId(`user_${i}`))
    }
    expect(seen.size).toBeGreaterThan(10)
  })
})
