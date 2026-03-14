'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import type { BookWithProgress } from '@/hooks/use-books'
import { useProcessingStatus } from '@/hooks/use-processing-status'
import { ProcessingLogDialog } from './processing-log-dialog'

interface BookCardProps {
  book: BookWithProgress
  editMode?: boolean
  selected?: boolean
  onToggleSelect?: (id: string, event?: React.MouseEvent) => void
  onProcessingComplete?: () => void
}

const STAGE_LABELS: Record<string, string> = {
  download: 'Downloading...',
  metadata: 'Reading metadata...',
  outline: 'Parsing TOC...',
  structure: 'Building structure...',
  extract_text: 'Extracting text...',
  ocr: 'Running OCR...',
  cover: 'Generating cover...',
  finalize: 'Finalizing...',
  complete: 'Complete!',
}

export function BookCard({ book, editMode, selected, onToggleSelect, onProcessingComplete }: BookCardProps) {
  const isProcessing = book.processingStatus === 'processing'
  const isFailed = book.processingStatus === 'error'
  const processing = useProcessingStatus(isProcessing ? book.jobId : undefined)
  const [showLog, setShowLog] = useState(false)
  const completedRef = useRef(false)

  // Trigger refresh when processing completes
  useEffect(() => {
    if (processing?.status === 'completed' && !completedRef.current) {
      completedRef.current = true
      onProcessingComplete?.()
    }
  }, [processing?.status, onProcessingComplete])

  const stageLabel = processing?.stage ? (STAGE_LABELS[processing.stage] || 'Processing...') : 'Processing...'

  const coverContent = (
    <div className="aspect-[3/4] bg-muted rounded-md flex items-center justify-center overflow-hidden relative">
      {book.coverImage ? (
        <img
          src={book.coverImage}
          alt={book.title}
          className={`object-cover w-full h-full transition-all ${isProcessing || isFailed ? 'brightness-[0.3]' : ''}`}
        />
      ) : (
        <span className={`text-4xl text-muted-foreground ${isProcessing || isFailed ? 'opacity-30' : ''}`}>📖</span>
      )}

      {isProcessing && processing && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-white p-2">
          <span className="text-2xl font-bold tabular-nums">{processing.progress}%</span>
          <span className="text-xs text-center mt-1 opacity-80">{stageLabel}</span>
          <Progress value={processing.progress} className="h-1 mt-2 w-3/4" />
        </div>
      )}

      {isProcessing && !processing && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-white p-2">
          <span className="text-sm opacity-80">Starting...</span>
        </div>
      )}

      {isFailed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-white p-2">
          <span className="text-2xl">&#x26A0;</span>
          <span className="text-xs mt-1">Processing failed</span>
        </div>
      )}
    </div>
  )

  const cardBody = (
    <Card
      className={`transition-all h-full ${
        editMode
          ? selected
            ? 'ring-2 ring-primary shadow-lg scale-[0.97] cursor-pointer'
            : 'hover:ring-1 hover:ring-muted-foreground/30 cursor-pointer'
          : isProcessing || isFailed
            ? 'opacity-90'
            : 'hover:shadow-lg cursor-pointer'
      }`}
      onClick={editMode ? (e: React.MouseEvent) => {
        e.preventDefault()
        onToggleSelect?.(book.id, e)
      } : undefined}
    >
      <CardContent className="p-4 flex flex-col gap-3 relative">
        {editMode && (
          <div className={`absolute top-2 left-2 z-10 w-5 h-5 rounded-full border-2 flex items-center justify-center ${
            selected
              ? 'bg-primary border-primary text-primary-foreground'
              : 'border-muted-foreground/40 bg-background'
          }`}>
            {selected && (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </div>
        )}

        {coverContent}

        <div className="space-y-1">
          <h3 className="font-semibold text-sm line-clamp-2">{book.title}</h3>
          <p className="text-xs text-muted-foreground">{book.author}</p>
        </div>

        {!isProcessing && !isFailed && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{book.progress.percentage}%</span>
              <span>{book.progress.read}/{book.progress.total} sections</span>
            </div>
            <Progress value={book.progress.percentage} className="h-2" />
          </div>
        )}

        {(isProcessing || isFailed) && book.jobId && (
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 text-xs"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowLog(true) }}
            >
              Check Progress
            </Button>
            {isProcessing && (
              <Button
                variant="destructive"
                size="sm"
                className="text-xs"
                onClick={async (e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  try {
                    const tokenRes = await fetch('/api/auth/token')
                    if (!tokenRes.ok) return
                    const { token } = await tokenRes.json()
                    const apiUrl = process.env.NEXT_PUBLIC_API_URL || ''
                    await fetch(`${apiUrl}/processing/${book.jobId}/cancel`, {
                      method: 'POST',
                      headers: { Authorization: `Bearer ${token}` },
                    })
                    onProcessingComplete?.() // refresh
                  } catch { /* ignore */ }
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )

  return (
    <>
      {editMode || isProcessing || isFailed ? cardBody : (
        <Link href={`/book/${book.id}`}>{cardBody}</Link>
      )}
      {showLog && book.jobId && (
        <ProcessingLogDialog
          jobId={book.jobId}
          bookTitle={book.title}
          open={showLog}
          onClose={() => setShowLog(false)}
        />
      )}
    </>
  )
}
