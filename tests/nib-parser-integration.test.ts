/**
 * Test: NibTextParser on realistic AI-extracted text from scanned PDFs.
 * Run with: npx vitest run tests/nib-parser-integration.test.ts
 */
import { describe, it, expect } from 'vitest'
import { NibTextParser } from '@/lib/nib/text-parser'
import { NibDocument } from '@/lib/nib'

// This simulates the text that the AI service extracts from the scanned
// "Design Patterns" PDF — matching what we see in the app screenshots.
const SAMPLE_SECTION_TEXT = `1.1 What Is a Design Pattern?
2 INTRODUCTION CHAPTER 1

and "decorate objects so you can easily add/remove features." Once you know the pattern, a lot of design decisions follow automatically. We all know the value of design experience. How many times have you had design dejavu — that feeling that you've solved a problem before but not knowing exactly where or how? If you could remember the details of the previous problem and how you solved it, then you could reuse the experience instead of rediscovering it. However, we don't do a good job of recording experience in software design for others to use. The purpose of this book is to record experience in designing object-oriented software as design patterns. Each design pattern systematically names, explains, and evaluates an important and recurring design in object-oriented systems. Our goal is to capture design experience in a form that people can use effectively. To this end we have documented some of the most important design patterns and present them as a catalog.
Design patterns make it easier to reuse successful designs and architectures. Expressing proven techniques as design patterns makes them more accessible to developers of new systems. Design patterns help you choose design alternatives that make a system reusable and avoid alternatives that compromise reusability. Design patterns can even improve the documentation and maintenance of existing systems by furnishing an explicit specification of class and object interactions and their underlying intent. Put simply, design patterns help a designer get a design "right" faster.
None of the design patterns in this book describes new or unproven designs. We have included only designs that have been applied more than once in different systems. Most of these designs have never been documented before. They are either part of the folklore of the object-oriented community or are elements of some successful object-oriented systems — neither of which is easy for novice designers to learn from. So although these designs aren't new, we capture them in a new and accessible way: as a catalog of design patterns having a consistent format.`

const SAMPLE_MULTI_SECTION = `1.1 What Is a Design Pattern?
2 INTRODUCTION CHAPTER 1

and "decorate objects so you can easily add/remove features." Once you know the pattern, a lot of design decisions follow automatically. We all know the value of design experience.

How many times have you had design dejavu — that feeling that you've solved a problem before but not knowing exactly where or how? If you could remember the details of the previous problem and how you solved it, then you could reuse the experience instead of rediscovering it.

However, we don't do a good job of recording experience in software design for others to use. The purpose of this book is to record experience in designing object-oriented software as design patterns.

1.2 Design Patterns in Smalltalk MVC

The Model/View/Controller (MVC) triad of classes is used to build user interfaces in Smalltalk-80. Looking at the design patterns inside MVC should help you see what we mean by the term "design pattern."

MVC consists of three kinds of objects. The Model is the application object, the View is its screen presentation, and the Controller defines the way the user interface reacts to user input.`

describe('NibTextParser — AI-extracted text', () => {
  it('should separate header from body text', () => {
    const parser = new NibTextParser()
    const docData = parser.parseText(SAMPLE_SECTION_TEXT, 'Design Patterns', 'GoF')
    const doc = NibDocument.fromData(docData)
    const page = doc.pages[0]

    console.log('\n========== SECTION 1.1 PARSED ==========')
    console.log(`Header: ${page.header?.text ?? '(none)'}`)
    console.log(`Header level: ${page.header?.level ?? '-'}`)
    console.log(`Paragraphs: ${page.paragraphs.length}`)
    console.log(`Total words: ${page.allWords.length}`)

    page.paragraphs.forEach((para, i) => {
      const preview = para.text.substring(0, 150).replace(/\n/g, ' ')
      console.log(`\n  [PARAGRAPH ${i + 1}] (${para.sentences.length} sentences, ${para.allWords.length} words)`)
      console.log(`    "${preview}..."`)

      para.sentences.forEach((sent, j) => {
        console.log(`    [SENTENCE ${j + 1}] (${sent.words.length} words) "${sent.text.substring(0, 100)}..."`)
      })
    })

    // The "2 INTRODUCTION CHAPTER 1" should be detected as a header, NOT in the paragraphs
    expect(page.header).not.toBeNull()
    expect(page.header!.text).toContain('1.1')
    // "2 INTRODUCTION CHAPTER 1" should be detected as junk (running header) and stripped

    // Body paragraphs should NOT start with "2 INTRODUCTION CHAPTER 1"
    const firstParaText = page.paragraphs[0]?.text ?? ''
    expect(firstParaText).not.toContain('INTRODUCTION CHAPTER 1')

    // Should have meaningful paragraphs (1 if no blank lines in source text, more if there are)
    expect(page.paragraphs.length).toBeGreaterThanOrEqual(1)
    // Total sentence count should be substantial
    const totalSentences = page.paragraphs.reduce((sum, p) => sum + p.sentences.length, 0)
    expect(totalSentences).toBeGreaterThanOrEqual(10)
  })

  it('should handle multi-section text with multiple headers', () => {
    const parser = new NibTextParser()
    const docData = parser.parseText(SAMPLE_MULTI_SECTION, 'Design Patterns', 'GoF', 2)
    const doc = NibDocument.fromData(docData)
    const page = doc.pages[0]

    console.log('\n========== MULTI-SECTION PARSED ==========')
    console.log(`Header: ${page.header?.text ?? '(none)'}`)
    console.log(`Paragraphs: ${page.paragraphs.length}`)

    page.paragraphs.forEach((para, i) => {
      const preview = para.text.substring(0, 120)
      console.log(`  [PARA ${i + 1}] "${preview}..."`)
    })

    // Should detect both "1.1" and "1.2" headers
    expect(page.header!.text).toContain('1.1')
    expect(page.header!.text).toContain('1.2')
  })

  it('should allow word → sentence → paragraph navigation', () => {
    const parser = new NibTextParser()
    const docData = parser.parseText(SAMPLE_SECTION_TEXT, 'Design Patterns', 'GoF')
    const doc = NibDocument.fromData(docData)
    const page = doc.pages[0]

    // Find the word "dejavu"
    const dejavu = doc.findWord('dejavu')
    expect(dejavu.length).toBeGreaterThan(0)

    const word = dejavu[0]
    console.log('\n========== WORD CONTEXT: "dejavu" ==========')
    console.log(`Word: "${word.text}"`)
    console.log(`Sentence: "${word.sentence.text}"`)
    console.log(`Paragraph preview: "${word.paragraph.text.substring(0, 100)}..."`)
    console.log(`Page: ${word.page.pageNumber}`)
    console.log(`AI Context:`, JSON.stringify(word.getAIContext(), null, 2))

    // The sentence should contain surrounding context
    expect(word.sentence.text).toContain('design')
    expect(word.getAIContext().sentence).toContain('dejavu')
  })

  it('should produce clean body text without headers', () => {
    const parser = new NibTextParser()
    const docData = parser.parseText(SAMPLE_SECTION_TEXT, 'Design Patterns', 'GoF')
    const doc = NibDocument.fromData(docData)

    const cleanText = doc.fullText
    console.log('\n========== CLEAN BODY TEXT (first 300 chars) ==========')
    console.log(cleanText.substring(0, 300))

    // Clean text should NOT contain the header junk
    expect(cleanText).not.toContain('2 INTRODUCTION CHAPTER 1')
    expect(cleanText).not.toContain('1.1 What Is a Design Pattern?')

    // But should contain the actual content
    expect(cleanText).toContain('design decisions follow automatically')
    expect(cleanText).toContain('design patterns')
  })
})
