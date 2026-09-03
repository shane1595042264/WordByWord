import { describe, it, expect } from 'vitest'
import { buildChapterGroups } from '../chapter-accordion'
import type { ChapterWithSections } from '@/hooks/use-book-detail'

let seq = 0

function chapter(title: string, read = 0, total = 2): ChapterWithSections {
  seq += 1
  return {
    id: `ch-${seq}`,
    bookId: 'book-1',
    title,
    order: seq,
    startPage: seq,
    endPage: seq,
    updatedAt: 0,
    sections: [],
    progress: { read, total, percentage: total > 0 ? Math.round((read / total) * 100) : 0 },
  }
}

const allChapterIds = (groups: ReturnType<typeof buildChapterGroups>) =>
  groups.flatMap(g => g.chapters.map(c => c.id))

describe('buildChapterGroups', () => {
  it('keeps duplicate flat titles as separate chapters', () => {
    const chapters = [chapter('Exercises'), chapter('Exercises')]
    const groups = buildChapterGroups(chapters)

    expect(groups).toHaveLength(2)
    expect(allChapterIds(groups).sort()).toEqual(chapters.map(c => c.id).sort())
    expect(groups.map(g => g.title)).toEqual(['Exercises', 'Exercises'])
  })

  it('does not let a standalone chapter wipe a same-named prefix group', () => {
    // Flat "Driving" is iterated LAST, after the group it collides with.
    const chapters = [
      chapter('Driving > Lesson 1'),
      chapter('Driving > Lesson 2'),
      chapter('Driving'),
    ]
    const groups = buildChapterGroups(chapters)

    expect(allChapterIds(groups).sort()).toEqual(chapters.map(c => c.id).sort())
    const prefixGroup = groups.find(g => g.chapters.length > 1)!
    expect(prefixGroup.title).toBe('Driving')
    expect(prefixGroup.chapters.map(c => c.title)).toEqual(['Lesson 1', 'Lesson 2'])
  })

  it('loses no chapter on a mixed-depth book and emits unique keys', () => {
    const chapters = [
      chapter('Part 1 > Chapter 1'),
      chapter('Exercises'),
      chapter('Part 2 > Chapter 4'),
      chapter('Exercises'),
      chapter('Part 1'),
    ]
    const groups = buildChapterGroups(chapters)

    expect(allChapterIds(groups)).toHaveLength(chapters.length)
    expect(new Set(allChapterIds(groups)).size).toBe(chapters.length)
    expect(new Set(groups.map(g => g.key)).size).toBe(groups.length)
  })

  it('survives a 48-Laws-shaped book: 102 chapters, 51 titles, each twice', () => {
    const titles = ['PREFACE', ...Array.from({ length: 50 }, (_, i) => `LAW ${i + 1}`)]
    const chapters = [...titles, ...titles].map(t => chapter(t))

    const groups = buildChapterGroups(chapters)

    expect(chapters).toHaveLength(102)
    expect(allChapterIds(groups)).toHaveLength(102)
    expect(new Set(allChapterIds(groups)).size).toBe(102)
  })

  it('still accumulates and weights progress for prefixed siblings', () => {
    const groups = buildChapterGroups([
      chapter('Part 1 > A', 1, 2),
      chapter('Part 1 > B', 3, 6),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].progress).toEqual({ read: 4, total: 8, percentage: 50 })
  })
})
