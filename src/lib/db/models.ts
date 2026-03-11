export interface Book {
  id: string
  title: string
  author: string
  totalPages: number
  pdfBlob: Blob
  coverImage: string | null
  structureSource: 'native' | 'ai' | 'manual'
  processingStatus: 'pending' | 'processing' | 'complete' | 'error'
  createdAt: number
  lastReadAt: number | null
  /** Most recently accessed section ID (for Continue Reading) */
  lastAccessedSectionId: string | null
  /** Scroll progress 0-100 at time of last access */
  lastAccessedScrollProgress: number | null
  /** Flat word index of the selected word (word-level restore) */
  lastAccessedWordIndex: number | null
}

export interface Chapter {
  id: string
  bookId: string
  title: string
  order: number
  startPage: number
  endPage: number
}

export interface VocabEntry {
  id: string
  /** The word text (original language) */
  word: string
  /** Romanized pronunciation (e.g. IPA or pinyin) */
  pronunciation: string
  /** Single-word contextual translation in the target language */
  translation: string
  /** Target language code */
  targetLanguage: string
  /** The sentence the word appeared in */
  contextSentence: string
  /** AI explanation of why this translation was chosen (lazy loaded) */
  explanation: string | null
  /** Book title for reference */
  bookTitle: string
  /** Section title for reference */
  sectionTitle: string
  /** Page number */
  pageNumber: number
  /** Timestamp when added */
  createdAt: number
  /** Number of times reviewed */
  reviewCount: number
  /** Last reviewed timestamp */
  lastReviewedAt: number | null
}

export interface Section {
  id: string
  chapterId: string
  bookId: string
  title: string
  order: number
  startPage: number
  endPage: number
  extractedText: string | null
  isRead: boolean
  readAt: number | null
  lastPageViewed: number | null  // last page user was on within this section
  scrollProgress: number | null  // 0-100 scroll percentage in scroll mode
}
