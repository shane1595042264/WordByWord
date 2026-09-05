'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { toast } from 'sonner'

interface ProcessButtonProps {
  bookId: string
  totalChapters: number
  onComplete: () => void
}

export function ProcessButton({ bookId, totalChapters, onComplete }: ProcessButtonProps) {
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // Synchronous in-flight guard. `processing` is React state and only flips at
  // setProcessing(true) below, AFTER the awaited dynamic imports — so a second
  // click during that import window would otherwise re-enter and start a second
  // concurrent processAllChaptersWithAI run, duplicating every section row and
  // doubling Anthropic spend. Mirrors addingVocabRef in word-info-panel.tsx.
  const inFlightRef = useRef(false)

  const handleProcess = async () => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    try {
      const { SettingsService } = await import('@/lib/services/settings-service')
      const settings = new SettingsService()
      const apiKey = settings.getApiKey()
      if (!apiKey) {
        setError('Please set your Anthropic API key in Settings first.')
        return
      }

      setProcessing(true)
      setError(null)
      const { BookProcessingService } = await import('@/lib/services/book-processing-service')
      const service = new BookProcessingService(apiKey)
      await service.processAllChaptersWithAI(bookId, (processed, total) => {
        setProgress(Math.round((processed / total) * 100))
      })
      onComplete()
    } catch (err: any) {
      const message = err?.message ?? 'Processing failed'
      setError(message)
      toast.error(message, { duration: 6000 })
    } finally {
      inFlightRef.current = false
      setProcessing(false)
    }
  }

  return (
    <div className="space-y-2">
      {processing ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Processing with AI... {progress}%</p>
          <Progress value={progress} className="h-2" />
        </div>
      ) : (
        <Button onClick={handleProcess} variant="secondary">
          Process All Chapters with AI
        </Button>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  )
}
