'use client'

import * as React from "react"
import { XIcon } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"

interface DebugLogDialogProps {
  open: boolean
  onClose: () => void
  logs: string[]
  title?: string
  description?: string
}

export function DebugLogDialog({
  open,
  onClose,
  logs,
  title = "Processing Log",
  description = "Detailed output from the PDF processing pipeline.",
}: DebugLogDialogProps) {
  const scrollAreaRef = React.useRef<HTMLDivElement>(null);

  // Scroll to bottom when new logs arrive
  React.useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <ScrollArea className="flex-1 border rounded-md p-4 font-mono text-xs bg-muted/20 overflow-auto" ref={scrollAreaRef}>
          {logs.length === 0 ? (
            <p className="text-muted-foreground">No log messages yet...</p>
          ) : (
            logs.map((log, index) => (
              <p key={index} className="whitespace-pre-wrap break-words py-0.5">
                {log}
              </p>
            ))
          )}
        </ScrollArea>
        <DialogFooter className="flex justify-end">
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
