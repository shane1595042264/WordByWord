// 2026-05-16: vocabulary moved out of Nibbler. The personal-website knowledge
// base at shanejli.com/knowledge is the canonical surface now; new vocab
// captures from the reader are forwarded there in real time (see NorthStar.md
// Section 0). This page exists only to keep bookmarks and typed URLs working
// — links in the app are <a target="_blank"> pointers to shanejli directly.
import { redirect } from 'next/navigation'

export default function VocabularyPage() {
  redirect('https://shanejli.com/knowledge')
}
