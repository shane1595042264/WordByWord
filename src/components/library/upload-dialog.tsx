'use client'

import { useState, useCallback } from 'react'
import { v4 as uuid } from 'uuid'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { db } from '@/lib/db/database'
import type { Book } from '@/lib/db/models'
import { toast } from 'sonner'

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
    const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
    const isEpub = f.type === 'application/epub+zip' || /\.epub$/i.test(f.name)
    if (!isPdf && !isEpub) {
      setStatus('Only PDF and EPUB files are allowed')
      e.target.value = ''
      return
    }
    setFile(f)
    // EPUBs skip the mode chooser — always run the EPUB pipeline, no Mathpix toggle
    setStep(isEpub ? 'uploading' : 'mode')
    if (isEpub) handleUpload('full', f)
  }, [])

  const handleUpload = useCallback(async (mode: 'full' | 'toc-only', sourceFile?: File) => {
    const f = sourceFile ?? file
    if (!f) return
    setStep('uploading')
    setLoading(true)

    const isEpub = f.type === 'application/epub+zip' || /\.epub$/i.test(f.name)
    const format: 'pdf' | 'epub' = isEpub ? 'epub' : 'pdf'

    try {
      let title: string
      let author: string
      let totalPages: number
      let coverImage: string | null = null

      if (isEpub) {
        // For EPUB, we skip local PDF metadata extraction — the backend will
        // parse the file and populate the catalog (title/author/cover/chapter
        // count). Show a reasonable local title while processing.
        setStatus('Reading EPUB...')
        title = f.name.replace(/\.epub$/i, '')
        author = ''
        totalPages = 0
      } else {
        setStatus('Reading PDF metadata...')
        const { PDFService } = await import('@/lib/services/pdf-service')
        const pdfService = new PDFService()
        const metadata = await pdfService.extractMetadata(f)
        title = metadata.title
        author = metadata.author
        totalPages = metadata.totalPages

        setStatus('Generating cover...')
        try {
          coverImage = await pdfService.renderPageToImage(f, 1, 1.5)
        } catch { /* no cover, that's fine */ }
      }

      setStatus('Uploading to cloud...')
      const { syncService } = await import('@/lib/services/sync-service')
      const uploadResult = await syncService.uploadBook(f, title, author, totalPages, mode)

      // Step 4: Create local book in IndexedDB
      const localId = uuid()
      const now = Date.now()
      const book: Book = {
        id: localId,
        title,
        author,
        totalPages,
        format,
        // For PDFs we keep the blob locally so the viewer can render offline.
        // For EPUBs we don't render the source file anywhere — skip the blob.
        pdfBlob: isEpub ? undefined : f,
        coverImage: uploadResult.coverUrl || coverImage,
        structureSource: isEpub ? 'epub' : 'native',
        processingStatus: uploadResult.jobId ? 'processing' : 'complete',
        createdAt: now,
        updatedAt: now,
        lastReadAt: null,
        lastAccessedSectionId: null,
        lastAccessedScrollProgress: null,
        lastAccessedWordIndex: null,
        completedAt: null,
        remoteId: uploadResult.remoteId,
        catalogId: uploadResult.catalogId,
        jobId: uploadResult.jobId,
      }
      await db.books.add(book)

      setOpen(false)
      setLoading(false)
      setStatus('')
      setStep('select')
      setFile(null)
      onBookImported()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('Upload failed:', err)
      toast.error(`Upload failed: ${message}`, { duration: 5000 })
      setStep('select')
      setFile(null)
      setStatus('')
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
        <Button>Upload Book</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import a Book</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {step === 'select' && (
            <div className="space-y-2">
              <Label htmlFor="book-file">Select PDF or EPUB file</Label>
              <Input id="book-file" type="file" accept=".pdf,.epub" onChange={handleFileSelect} />
              {status && <p className="text-sm text-destructive">{status}</p>}
            </div>
          )}

          {step === 'mode' && file && (
            <div className="space-y-3">
              <p className="text-sm font-medium">{file.name}</p>
              <p className="text-xs text-muted-foreground">Choose processing mode:</p>

              <Button className="w-full justify-start text-left h-auto py-3 whitespace-normal" variant="outline" onClick={() => handleUpload('full')}>
                <div className="min-w-0">
                  <div className="font-semibold">Full Processing</div>
                  <div className="text-xs text-muted-foreground font-normal">
                    Mathpix extracts tables, formulas, figures as rich content. Best quality, uses API credits.
                  </div>
                </div>
              </Button>

              <Button className="w-full justify-start text-left h-auto py-3 whitespace-normal" variant="outline" onClick={() => handleUpload('toc-only')}>
                <div className="min-w-0">
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
