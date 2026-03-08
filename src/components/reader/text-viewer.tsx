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
        <p>No extracted text available. Process this chapter with AI first.</p>
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
