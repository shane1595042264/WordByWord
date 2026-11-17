'use client'

import { useEffect } from 'react'
import { toast } from 'sonner'
import { LatexText, containsLatex } from '@/components/reader/latex-renderer'

interface TextViewerProps {
  text: string | null
  sectionTitle: string
}

export function TextViewer({ text, sectionTitle }: TextViewerProps) {
  useEffect(() => {
    if (!text) {
      toast.error('No extractable text layer in this PDF', { duration: 5000 })
    }
  }, [text])

  if (!text) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground p-8">
        <p>No extractable text layer in this PDF. This is likely a scanned or image-based document. Use the PDF view instead, or process with AI to extract text via OCR.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[72ch] p-6 font-reading text-[17px] leading-[1.7] sm:px-8">
      <h2 className="mb-6 font-display text-2xl font-semibold leading-tight tracking-tight">{sectionTitle}</h2>
      <div className="whitespace-pre-wrap">
        {containsLatex(text) ? <LatexText text={text} /> : text}
      </div>
    </div>
  )
}
