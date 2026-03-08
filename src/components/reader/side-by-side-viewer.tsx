'use client'

import { PDFViewer } from './pdf-viewer'
import { TextViewer } from './text-viewer'
import { NibTextViewer } from './nib-text-viewer'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { NibDocument } from '@/lib/nib'

interface SideBySideViewerProps {
  pdfBlob: Blob
  startPage: number
  endPage: number
  text: string | null
  nibDocument?: NibDocument | null
  sectionTitle: string
  readingMode: 'scroll' | 'flip'
  showIndicators?: boolean
  currentPage?: number
  onPageChange?: (page: number) => void
  highlightRegion?: { top: number; height: number } | null
  onPageProgress?: (currentPage: number, totalPages: number, scrollPercent: number) => void
}

export function SideBySideViewer({ pdfBlob, startPage, endPage, text, nibDocument, sectionTitle, readingMode, showIndicators = false, currentPage, onPageChange, onPageProgress }: SideBySideViewerProps) {
  return (
    <div className="grid grid-cols-2 h-full">
      <ScrollArea className="h-full">
        <div className="p-4">
          {nibDocument ? (
            <NibTextViewer
              nibDocument={nibDocument}
              sectionTitle={sectionTitle}
              showIndicators={showIndicators}
            />
          ) : (
            <TextViewer text={text} sectionTitle={sectionTitle} />
          )}
        </div>
      </ScrollArea>
      <div className="h-full border-l">
        <PDFViewer
          pdfBlob={pdfBlob}
          startPage={startPage}
          endPage={endPage}
          readingMode={readingMode}
          currentPage={currentPage}
          onPageChange={onPageChange}
          onPageProgress={onPageProgress}
        />
      </div>
    </div>
  )
}
