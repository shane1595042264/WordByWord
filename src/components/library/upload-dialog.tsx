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

export function UploadDialog({ onBookImported }: UploadDialogProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

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

      // Step 3: Upload PDF to backend
      setStatus('Uploading to cloud...')
      const { syncService } = await import('@/lib/services/sync-service')
      const uploadResult = await syncService.uploadBook(
        file,
        metadata.title,
        metadata.author,
        metadata.totalPages,
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

      // Done — close dialog, book appears in library with progress overlay
      setOpen(false)
      setLoading(false)
      setStatus('')
      onBookImported()
    } catch (err) {
      console.error('Upload failed:', err)
      setStatus(`Upload failed: ${err}`)
      setLoading(false)
    }
  }, [onBookImported])

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!loading) { setOpen(v) } }}>
      <DialogTrigger asChild>
        <Button>Upload PDF</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import a Book</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {!loading ? (
            <div className="space-y-2">
              <Label htmlFor="pdf-file">Select PDF file</Label>
              <Input id="pdf-file" type="file" accept=".pdf" onChange={handleFileChange} />
              <p className="text-xs text-muted-foreground">
                The book will be uploaded and processed in the background. You can navigate away while it processes.
              </p>
            </div>
          ) : (
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
