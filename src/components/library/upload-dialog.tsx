'use client'

import { useState, useCallback } from 'react'
import { v4 as uuid } from 'uuid'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { db } from '@/lib/db/database'
import type { Book } from '@/lib/db/models'

interface UploadDialogProps {
  onBookImported: () => void
}

type UploadStep = 'select' | 'mode' | 'uploading'

export function UploadDialog({ onBookImported }: UploadDialogProps) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<UploadStep>('select')
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    setStep('mode')
  }, [])

  const handleUpload = useCallback(async (mode: 'full' | 'toc-only') => {
    if (!file) return
    setStep('uploading')
    setLoading(true)

    try {
      // Step 1: Extract metadata locally (instant)
      setStatus('Reading PDF metadata...')
      const { PDFService } = await import('@/lib/services/pdf-service')
      const pdfService = new PDFService()
      const metadata = await pdfService.extractMetadata(file)

      // Step 2: Generate cover from page 1 (instant)
      setStatus('Generating cover...')
      let coverImage: string | null = null
      try {
        coverImage = await pdfService.renderPageToImage(file, 1, 1.5)
      } catch { /* no cover, that's fine */ }

      // Step 3: Upload PDF to backend with mode
      setStatus('Uploading to cloud...')
      const { syncService } = await import('@/lib/services/sync-service')
      const uploadResult = await syncService.uploadBook(
        file,
        metadata.title,
        metadata.author,
        metadata.totalPages,
        mode,
      )

      // Step 4: Create local book in IndexedDB
      const localId = uuid()
      const now = Date.now()
      const book: Book = {
        id: localId,
        title: metadata.title,
        author: metadata.author,
        totalPages: metadata.totalPages,
        pdfBlob: file,
        coverImage: uploadResult?.coverUrl || coverImage,
        structureSource: 'native',
        processingStatus: uploadResult ? 'processing' : 'pending',
        createdAt: now,
        updatedAt: now,
        lastReadAt: null,
        lastAccessedSectionId: null,
        lastAccessedScrollProgress: null,
        lastAccessedWordIndex: null,
        remoteId: uploadResult?.remoteId,
        catalogId: uploadResult?.catalogId,
        jobId: uploadResult?.jobId,
      }
      await db.books.add(book)

      setOpen(false)
      setLoading(false)
      setStatus('')
      setStep('select')
      setFile(null)
      onBookImported()
    } catch (err) {
      console.error('Upload failed:', err)
      setStatus(`Upload failed: ${err}`)
      setLoading(false)
    }
  }, [file, onBookImported])

  return (
    <Dialog open={open} onOpenChange={(v) => {
      if (!loading) {
        setOpen(v)
        if (!v) { setStep('select'); setFile(null); setStatus('') }
      }
    }}>
      <DialogTrigger asChild>
        <Button>Upload PDF</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import a Book</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {step === 'select' && (
            <div className="space-y-2">
              <Label htmlFor="pdf-file">Select PDF file</Label>
              <Input id="pdf-file" type="file" accept=".pdf" onChange={handleFileSelect} />
            </div>
          )}

          {step === 'mode' && file && (
            <div className="space-y-3">
              <p className="text-sm font-medium">{file.name}</p>
              <p className="text-xs text-muted-foreground">Choose processing mode:</p>

              <Button className="w-full justify-start text-left h-auto py-3" variant="outline" onClick={() => handleUpload('full')}>
                <div>
                  <div className="font-semibold">Full Processing</div>
                  <div className="text-xs text-muted-foreground font-normal">
                    Mathpix extracts tables, formulas, figures as rich content. Best quality, uses API credits.
                  </div>
                </div>
              </Button>

              <Button className="w-full justify-start text-left h-auto py-3" variant="outline" onClick={() => handleUpload('toc-only')}>
                <div>
                  <div className="font-semibold">TOC Only</div>
                  <div className="text-xs text-muted-foreground font-normal">
                    Uses PDF table of contents for structure. Read via PDF viewer. Fast, free, no API needed.
                  </div>
                </div>
              </Button>
            </div>
          )}

          {step === 'uploading' && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">{status}</p>
              <div className="h-1 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary animate-pulse w-full" />
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
