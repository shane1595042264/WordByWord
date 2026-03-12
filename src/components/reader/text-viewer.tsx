'use client'

import { LatexText, containsLatex } from '@/components/reader/latex-renderer'

interface TextViewerProps {
  text: string | null
  sectionTitle: string
}

export function TextViewer({ text, sectionTitle }: TextViewerProps) {
  if (!text) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground p-8">
        <p>No extractable text layer in this PDF. This is likely a scanned or image-based document. Use the PDF view instead, or process with AI to extract text via OCR.</p>
      </div>
    )
  }

  return (
    <div className="prose prose-sm max-w-none p-6">
      <h2>{sectionTitle}</h2>
      <div className="whitespace-pre-wrap">
        {containsLatex(text) ? <LatexText text={text} /> : text}
      </div>
    </div>
  )
}
