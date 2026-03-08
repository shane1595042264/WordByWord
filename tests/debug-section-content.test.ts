/**
 * Debug: Simulate how the parser handles text extracted from the real PDF pages
 * around the Chapter 1 → 1.1 boundary. The real issue is that the page where
 * 1.1 starts also contains the tail of the intro text above the heading.
 *
 * Run with: npx vitest run tests/debug-section-content.test.ts
 */
import { describe, it } from 'vitest'
import { NibTextParser } from '@/lib/nib/text-parser'
import { NibDocument } from '@/lib/nib'

// This is what the REAL extracted text looks like for the pages assigned to
// section 1.1. The page where 1.1 starts ALSO has the tail of the chapter intro.
const REAL_SECTION_11_EXTRACTED_TEXT = `2 INTRODUCTION CHAPTER 1

and "decorate objects so you can easily add/remove features." Once you know the pattern, a lot of design decisions follow automatically.

We all know the value of design experience. How many times have you had design dejavu — that feeling that you've solved a problem before but not knowing exactly where or how? If you could remember the details of the previous problem and how you solved it, then you could reuse the experience instead of rediscovering it. However, we don't do a good job of recording experience in software design for others to use.

The purpose of this book is to record experience in designing object-oriented software as design patterns. Each design pattern systematically names, explains, and evaluates an important and recurring design in object-oriented systems. Our goal is to capture design experience in a form that people can use effectively. To this end we have documented some of the most important design patterns and present them as a catalog.

Design patterns make it easier to reuse successful designs and architectures. Expressing proven techniques as design patterns makes them more accessible to developers of new systems. Design patterns help you choose design alternatives that make a system reusable and avoid alternatives that compromise reusability. Design patterns can even improve the documentation and maintenance of existing systems by furnishing an explicit specification of class and object interactions and their underlying intent. Put simply, design patterns help a designer get a design "right" faster.

None of the design patterns in this book describes new or unproven designs. We have included only designs that have been applied more than once in different systems. Most of these designs have never been documented before. They are either part of the folklore of the object-oriented community or are elements of some successful object-oriented systems — neither of which is easy for novice designers to learn from. So although these designs aren't new, we capture them in a new and accessible way: as a catalog of design patterns having a consistent format.

Despite the book's size, the design patterns in it capture only a fraction of what an expert might know. It doesn't have any patterns dealing with concurrency or distributed programming or real-time programming. It doesn't have any application domain-specific patterns. It doesn't tell you how to build user interfaces, how to write device drivers, or how to use an object-oriented database. Each of these areas has its own patterns, and it would be worthwhile for someone to catalog those too.

1.1 What Is a Design Pattern?

Christopher Alexander says, "Each pattern describes a problem which occurs over and over again in our environment, and then describes the core of the solution to that problem, in such a way that you can use this solution a million times over, without ever doing it the same way twice" [AIS+77, page x].

Even though Alexander was talking about patterns in buildings and towns, what he says is true about object-oriented design patterns. Our solutions are expressed in terms of objects and interfaces instead of walls and doors, but at the core of both kinds of patterns is a solution to a problem in a context.

In general, a pattern has four essential elements:

The pattern name is a handle we can use to describe a design problem, its solutions, and consequences in a word or two. Naming a pattern immediately increases our design vocabulary.`

describe('Debug: How section 1.1 text is parsed', () => {
  it('should show what the parser produces for section 1.1 text', () => {
    const parser = new NibTextParser()
    const docData = parser.parseText(REAL_SECTION_11_EXTRACTED_TEXT, 'Design Patterns', 'GoF')
    const doc = NibDocument.fromData(docData)
    const page = doc.pages[0]

    console.log('\n' + '='.repeat(70))
    console.log('SECTION 1.1 — PARSED OUTPUT')
    console.log('='.repeat(70))
    console.log(`\nHeaders detected: ${page.header?.text ?? '(none)'}`)
    console.log(`Header level: ${page.header?.level ?? '-'}`)
    console.log(`Paragraphs: ${page.paragraphs.length}`)
    console.log(`List items: ${page.listItems.length}`)
    console.log(`Figures: ${page.figures.length}`)
    console.log(`Footnotes: ${page.footnotes.length}`)

    console.log('\n--- ALL PARAGRAPHS ---')
    page.paragraphs.forEach((para, i) => {
      const preview = para.text.substring(0, 120).replace(/\n/g, ' ')
      console.log(`\n  [PARA ${i + 1}] blockType=${para.blockType}`)
      console.log(`    ${para.sentences.length} sentences, ${para.allWords.length} words`)
      console.log(`    "${preview}..."`)
    })

    // Show introduction vs body breakdown
    const introParas = page.paragraphs.filter(p => p.blockType === 'introduction')
    const bodyParas = page.paragraphs.filter(p => p.blockType === 'body')

    console.log('\n' + '-'.repeat(70))
    console.log(`INTRODUCTION paragraphs: ${introParas.length}`)
    introParas.forEach((p, i) => {
      console.log(`  [intro ${i + 1}] "${p.text.substring(0, 100)}..."`)
    })

    console.log(`\nBODY paragraphs: ${bodyParas.length}`)
    bodyParas.forEach((p, i) => {
      console.log(`  [body ${i + 1}] "${p.text.substring(0, 100)}..."`)
    })

    // What section 1.1 SHOULD show (body text only — after the heading)
    const bodyText = bodyParas.map(p => p.text).join('\n\n')
    console.log('\n' + '='.repeat(70))
    console.log('SECTION 1.1 BODY-ONLY TEXT (what should be displayed):')
    console.log('='.repeat(70))
    console.log(bodyText.substring(0, 500))
    console.log('...')

    const introText = introParas.map(p => p.text).join('\n\n')
    console.log('\n' + '='.repeat(70))
    console.log('INTRODUCTION TEXT (should be in a separate section):')
    console.log('='.repeat(70))
    console.log(introText.substring(0, 500))
    console.log('...')
  })
})
