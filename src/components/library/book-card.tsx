'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { FileTextIcon } from 'lucide-react'
import type { BookWithProgress } from '@/hooks/use-books'
import { useProcessingStatus } from '@/hooks/use-processing-status'
import { ProcessingLogDialog } from './processing-log-dialog'
import { toast } from 'sonner'

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
  const { data: processing, pollError, retry } = useProcessingStatus(isProcessing ? book.jobId : undefined)
  const [showLog, setShowLog] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [isRetrying, setIsRetrying] = useState(false)
  const [coverError, setCoverError] = useState(false)
  const completedRef = useRef(false)
  const hasLog = !!book.jobId

  // Reset cover error state when the URL changes so sync recoveries re-attempt the load
  useEffect(() => {
    setCoverError(false)
  }, [book.coverImage])

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
      {book.coverImage && !coverError ? (
        <img
          src={book.coverImage}
          alt={book.title}
          className={`object-cover w-full h-full transition-all ${isProcessing || isFailed ? 'brightness-[0.3]' : ''}`}
          onError={() => setCoverError(true)}
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

      {isProcessing && !processing && !pollError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-white p-2">
          <span className="text-sm opacity-80">Starting...</span>
        </div>
      )}

      {isProcessing && pollError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-white p-2 gap-1">
          <span className="text-2xl">&#x26A0;</span>
          <span className="text-xs text-center opacity-80">Sync paused</span>
          <Button
            variant="secondary"
            size="sm"
            className="h-6 px-2 text-[10px] mt-1"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); retry() }}
          >
            Retry
          </Button>
        </div>
      )}

      {isFailed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-white p-2">
          <span className="text-2xl">&#x26A0;</span>
          <span className="text-xs mt-1 text-center">Processing failed</span>
          {!editMode && <span className="text-[10px] mt-0.5 text-center opacity-70">Tap to review</span>}
        </div>
      )}

      {editMode && hovered && !isProcessing && (
        <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/60 to-transparent">
          <Button
            variant="secondary"
            size="sm"
            className={`w-full text-xs gap-1.5 ${!hasLog ? 'opacity-50 cursor-not-allowed' : ''}`}
            disabled={!hasLog}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowLog(true) }}
          >
            <FileTextIcon className="h-3 w-3" />
            View Log
          </Button>
        </div>
      )}
    </div>
  )

  const cardBody = (
    <Card
      className={`transition-all h-full overflow-hidden ${
        editMode
          ? selected
            ? 'ring-2 ring-primary shadow-lg scale-[0.97] cursor-pointer'
            : 'hover:ring-1 hover:ring-muted-foreground/30 cursor-pointer'
          : isProcessing
            ? 'opacity-90'
            : isFailed
              ? 'opacity-90 hover:shadow-lg cursor-pointer'
              : 'hover:shadow-lg cursor-pointer'
      }`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={editMode ? (e: React.MouseEvent) => {
        e.preventDefault()
        onToggleSelect?.(book.id, e)
      } : undefined}
    >
      <CardContent className="p-4 flex flex-col gap-3 relative min-w-0">
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
              {book.completedAt ? (
                <span className="flex items-center gap-1 text-green-600 dark:text-green-400 font-medium">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 6L5 9L10 3" />
                  </svg>
                  Complete
                </span>
              ) : (
                <span>{book.progress.percentage}%</span>
              )}
              <span>{book.progress.read}/{book.progress.total} sections</span>
            </div>
            <Progress value={book.progress.percentage} className={`h-2 ${book.completedAt ? '[&_[data-slot=progress-indicator]]:bg-green-500' : ''}`} />
          </div>
        )}

        {(isProcessing || isFailed) && book.jobId && (
          <div className="flex flex-col gap-1 w-full">
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowLog(true) }}
            >
              Check Progress
            </Button>
            {isProcessing && (
              <Button
                variant="destructive"
                size="sm"
                className="w-full text-xs"
                disabled={isCancelling}
                onClick={async (e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  if (isCancelling) return
                  setIsCancelling(true)
                  try {
                    const tokenRes = await fetch('/api/auth/token')
                    if (!tokenRes.ok) {
                      toast.error('Session expired - please reload', { duration: 5000 })
                      return
                    }
                    const { token } = await tokenRes.json()
                    const apiUrl = process.env.NEXT_PUBLIC_API_URL || ''
                    const res = await fetch(`${apiUrl}/processing/${book.jobId}/cancel`, {
                      method: 'POST',
                      headers: { Authorization: `Bearer ${token}` },
                    })
                    if (!res.ok) {
                      toast.error('Failed to cancel processing', { duration: 5000 })
                      return
                    }
                    onProcessingComplete?.() // refresh
                  } catch (err) {
                    toast.error('Failed to cancel processing', { duration: 5000 })
                    console.error('Cancel processing error:', err)
                  } finally {
                    setIsCancelling(false)
                  }
                }}
              >
                Cancel
              </Button>
            )}
            {isFailed && (
              <Button
                variant="default"
                size="sm"
                className="w-full text-xs"
                disabled={isRetrying}
                onClick={async (e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  if (isRetrying) return
                  setIsRetrying(true)
                  try {
                    const tokenRes = await fetch('/api/auth/token')
                    if (!tokenRes.ok) {
                      toast.error('Session expired - please reload', { duration: 5000 })
                      return
                    }
                    const { token } = await tokenRes.json()
                    const apiUrl = process.env.NEXT_PUBLIC_API_URL || ''
                    const res = await fetch(`${apiUrl}/processing/${book.jobId}/retry`, {
                      method: 'POST',
                      headers: { Authorization: `Bearer ${token}` },
                    })
                    if (res.ok) {
                      onProcessingComplete?.() // refresh to show new processing state
                    } else {
                      toast.error('Failed to retry processing', { duration: 5000 })
                    }
                  } catch (err) {
                    toast.error('Failed to retry processing', { duration: 5000 })
                    console.error('Retry processing error:', err)
                  } finally {
                    setIsRetrying(false)
                  }
                }}
              >
                Retry
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )

  return (
    <>
      {editMode || isProcessing ? cardBody : (
        <Link href={`/book/${book.id}`}>{cardBody}</Link>
      )}
      {showLog && book.jobId && (
        <ProcessingLogDialog
          jobId={book.jobId}
          bookTitle={book.title}
          open={showLog}
          onClose={() => setShowLog(false)}
          isLive={isProcessing}
        />
      )}
    </>
  )
}
