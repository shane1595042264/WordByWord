'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import { BookProcessingService } from '@/lib/services/book-processing-service'
import { useAuth } from '@/hooks/use-auth'
import { useRouter } from 'next/navigation'
import { DebugLogDialog } from './debug-log-dialog' // Import the new component

interface UploadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onUploadSuccess: (bookId: string) => void
}

export function UploadDialog({ open, onOpenChange, onUploadSuccess }: UploadDialogProps) {
  const { user } = useAuth()
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState('Waiting for file...')
  const [error, setError] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [useNativeTOC, setUseNativeTOC] = useState(true)
  const [useNibProcess, setUseNibProcess] = useState(true) // New state for NIB processing
  const [showDebugLog, setShowDebugLog] = useState(false); // State for debug log dialog
  const [debugLogs, setDebugLogs] = useState<string[]>([]); // State for debug log messages

  const bookProcessingService = useRef<BookProcessingService | null>(null)

  useEffect(() => {
    if (user?.apiKey) {
      // Initialize BookProcessingService with API key and debug logger
      bookProcessingService.current = new BookProcessingService(user.apiKey, (logMessage) => {
        setDebugLogs(prev => [...prev, logMessage]);
      });
    } else {
      // Initialize without API key, or if API key is removed
      bookProcessingService.current = new BookProcessingService(undefined, (logMessage) => {
        setDebugLogs(prev => [...prev, logMessage]);
      });
    }
  }, [user?.apiKey]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0]
      if (file.type !== 'application/pdf') {
        setError('Please upload a PDF file.')
        setSelectedFile(null)
        return
      }
      setSelectedFile(file)
      setError(null)
      setMessage(`Selected: ${file.name}`)
      setProgress(0)
      setDebugLogs([]); // Clear logs on new file selection
    }
  }

  const handleUpload = useCallback(async () => {
    if (!selectedFile) {
      setError('No file selected.')
      return
    }

    if (!bookProcessingService.current) {
      setError('Book processing service not initialized. Please refresh or check API key.')
      return
    }

    setIsProcessing(true)
    setError(null)
    setDebugLogs([]); // Clear logs before starting new process
    setShowDebugLog(true); // Automatically open debug log when processing starts

    try {
      const bookId = await bookProcessingService.current.importBook(selectedFile, {
        useNativeTOC,
        useNibProcess,
        onProgress: (msg, percent) => {
          setMessage(msg)
          setProgress(percent)
          setDebugLogs(prev => [...prev, `[Progress] ${msg} (${percent}%)`]); // Add progress to debug log
        },
        onDebugLog: (logMessage) => { // Pass the debug log callback
          setDebugLogs(prev => [...prev, logMessage]);
        }
      })
      onUploadSuccess(bookId)
      setMessage('Upload and processing complete!')
      setProgress(100)
      onOpenChange(false) // Close dialog on success
      router.push(`/book/${bookId}`) // Navigate to the new book
    } catch (e) {
      console.error('Error during book import:', e)
      setError(`Failed to process book: ${e instanceof Error ? e.message : String(e)}`)
      setMessage('Processing failed.')
      setProgress(0)
      setDebugLogs(prev => [...prev, `[ERROR] ${e instanceof Error ? e.message : String(e)}`]); // Add error to debug log
    } finally {
      setIsProcessing(false)
    }
  }, [selectedFile, useNativeTOC, useNibProcess, onUploadSuccess, onOpenChange, router])

  const handleClose = useCallback(() => {
    setSelectedFile(null)
    setProgress(0)
    setMessage('Waiting for file...')
    setError(null)
    setIsProcessing(false)
    setDebugLogs([]); // Clear logs when dialog is closed
    setShowDebugLog(false); // Close debug log dialog
    onOpenChange(false)
  }, [onOpenChange])

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Upload PDF Book</DialogTitle>
            <DialogDescription>
              Upload a PDF file to start reading. We'll process it to extract text, chapters, and sections.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid w-full max-w-sm items-center gap-1.5">
              <Label htmlFor="pdf-file">PDF File</Label>
              <Input
                id="pdf-file"
                type="file"
                accept=".pdf"
                onChange={handleFileChange}
                ref={fileInputRef}
                disabled={isProcessing}
              />
              {selectedFile && <p className="text-sm text-muted-foreground">Selected: {selectedFile.name}</p>}
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="use-native-toc"
                checked={useNativeTOC}
                onCheckedChange={setUseNativeTOC}
                disabled={isProcessing}
              />
              <Label htmlFor="use-native-toc">Use native PDF Table of Contents (if available)</Label>
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="use-nib-process"
                checked={useNibProcess}
                onCheckedChange={setUseNibProcess}
                disabled={isProcessing}
              />
              <Label htmlFor="use-nib-process">Use NIB (Neural Information Book) processing for content extraction</Label>
            </div>

            {isProcessing && (
              <div className="space-y-2 mt-4">
                <p className="text-sm text-muted-foreground">{message}</p>
                <Progress value={progress} className="w-full" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDebugLog(true)} // Button to open debug log
              disabled={!isProcessing && debugLogs.length === 0} // Disable if not processing and no logs
            >
              Show Debug Log
            </Button>
            <Button variant="outline" onClick={handleClose} disabled={isProcessing}>
              Cancel
            </Button>
            <Button type="submit" onClick={handleUpload} disabled={!selectedFile || isProcessing}>
              {isProcessing ? 'Processing...' : 'Upload & Process'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DebugLogDialog
        open={showDebugLog}
        onClose={() => setShowDebugLog(false)}
        logs={debugLogs}
      />
    </>
  )
}
