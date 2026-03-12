'use client'

import { useState, useCallback } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'

interface UploadDialogProps {
  onBookImported: () => void
}

export function UploadDialog({ onBookImported }: UploadDialogProps) {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [hasOutline, setHasOutline] = useState<boolean | null>(null)
  const [step, setStep] = useState<'upload' | 'structure' | 'importing'>('upload')
  const [progressMessage, setProgressMessage] = useState('')
  const [progressPercent, setProgressPercent] = useState(0)

  const handleImport = useCallback(async (useNativeTOC: boolean) => {
    if (!file) return
    setLoading(true)
    setStep('importing')
    setProgressPercent(0)
    setProgressMessage('Starting import...')

    const { SettingsService } = await import('@/lib/services/settings-service')
    const { BookProcessingService } = await import('@/lib/services/book-processing-service')
    const settings = new SettingsService()
    const apiKey = settings.getApiKey()
    const service = new BookProcessingService(apiKey ?? undefined)
    await service.importBook(file, {
      useNativeTOC,
      onProgress: (message, percent) => {
        setProgressMessage(message)
        setProgressPercent(percent)
      },
    })
    setLoading(false)
    setOpen(false)
    setStep('upload')
    setFile(null)
    setProgressPercent(0)
    setProgressMessage('')
    onBookImported()
  }, [file, onBookImported])

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    const { PDFService } = await import('@/lib/services/pdf-service')
    const pdfService = new PDFService()
    const outline = await pdfService.extractOutline(f)
    const hasTOC = outline !== null && outline.length > 0
    setHasOutline(hasTOC)

    if (hasTOC) {
      // Show choice: use native TOC or page-by-page
      setStep('structure')
    } else {
      // No TOC — import directly with page-by-page text extraction (no AI needed)
      setStep('structure')
    }
  }, [handleImport])

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!loading) { setOpen(v); if (!v) { setStep('upload'); setFile(null) } } }}>
      <DialogTrigger asChild>
        <Button>Upload PDF</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import a Book</DialogTitle>
        </DialogHeader>
        {step === 'upload' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pdf-file">Select PDF file</Label>
              <Input id="pdf-file" type="file" accept=".pdf" onChange={handleFileChange} />
            </div>
          </div>
        )}
        {step === 'structure' && (
          <div className="space-y-4">
            {hasOutline ? (
              <>
                <p className="text-sm text-muted-foreground">
                  We detected a table of contents in this PDF. Would you like to use it, or import page-by-page?
                </p>
                <div className="flex gap-2">
                  <Button onClick={() => handleImport(true)} disabled={loading}>
                    Use Native TOC
                  </Button>
                  <Button variant="outline" onClick={() => handleImport(false)} disabled={loading}>
                    Page-by-Page
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  No table of contents detected. The book will be imported page-by-page with text extracted locally.
                </p>
                <Button onClick={() => handleImport(false)} disabled={loading}>
                  Import Book
                </Button>
              </>
            )}
          </div>
        )}
        {step === 'importing' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{progressMessage}</p>
            <Progress value={progressPercent} className="h-2" />
            <p className="text-xs text-muted-foreground text-right">{progressPercent}%</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
