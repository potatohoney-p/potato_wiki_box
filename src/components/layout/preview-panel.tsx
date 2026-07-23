import { useEffect, useCallback, useRef, useState } from "react"
import { AlertCircle, LoaderCircle, X } from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"
import { readFile, writeFileAtomic } from "@/commands/fs"
import { getFileCategory, isBinary, isExtractedTextPreviewFile } from "@/lib/file-types"
import { WikiEditor } from "@/components/editor/wiki-editor"
import { FilePreview } from "@/components/editor/file-preview"
import { getFileName } from "@/lib/path-utils"
import {
  DocumentSaveCoordinator,
  registerDocumentSaveCoordinator,
} from "@/lib/document-save-coordinator"

export function PreviewPanel() {
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const fileContent = useWikiStore((s) => s.fileContent)
  const previewContentPath = useWikiStore((s) => s.previewContentPath)
  const externalPreview = useWikiStore((s) => s.externalPreview)
  const setFileContent = useWikiStore((s) => s.setFileContent)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selectedFileRef = useRef(selectedFile)
  selectedFileRef.current = selectedFile
  const fileContentRef = useRef(fileContent)
  fileContentRef.current = fileContent
  const previousFileRef = useRef<string | null>(null)
  const loadGenerationRef = useRef(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle")
  // Snapshot of what was most recently loaded from disk. Milkdown re-emits
  // `markdownUpdated` on initial parse (before the user types anything),
  // which used to trigger an auto-save that could write back a placeholder
  // marker if read_file had returned one for a missing/locked file. We
  // skip save when the incoming markdown equals the last-loaded content.
  const lastLoadedRef = useRef<string>("")
  const saveCoordinatorRef = useRef<DocumentSaveCoordinator | null>(null)
  if (!saveCoordinatorRef.current) {
    saveCoordinatorRef.current = new DocumentSaveCoordinator(writeFileAtomic, {
      onSaving: ({ path }) => {
        if (selectedFileRef.current === path) setSaveState("saving")
      },
      onSaved: ({ path, contents }) => {
        if (selectedFileRef.current !== path) return
        lastLoadedRef.current = contents
        setFileContent(contents)
        setSaveState("saved")
      },
      onError: ({ path }, error) => {
        console.error(`Failed to save ${path}:`, error)
        if (selectedFileRef.current === path) setSaveState("error")
      },
    })
  }

  const flushPath = useCallback((path: string | null): Promise<void> => {
    if (!path) return Promise.resolve()
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    return saveCoordinatorRef.current?.flush(path) ?? Promise.resolve()
  }, [])

  useEffect(() => {
    const coordinator = saveCoordinatorRef.current
    if (!coordinator) return
    return registerDocumentSaveCoordinator(coordinator)
  }, [])

  useEffect(() => {
    const previousPath = previousFileRef.current
    if (previousPath && previousPath !== selectedFile) {
      void flushPath(previousPath).catch(() => undefined)
    }
    previousFileRef.current = selectedFile
    const generation = ++loadGenerationRef.current
    setLoadError(null)
    setSaveState("idle")

    if (!selectedFile) {
      setFileContent("")
      lastLoadedRef.current = ""
      setIsLoading(false)
      return
    }
    if (previewContentPath === selectedFile) {
      lastLoadedRef.current = fileContentRef.current
      setIsLoading(false)
      return
    }
    if (externalPreview?.path === selectedFile) {
      lastLoadedRef.current = fileContentRef.current
      setIsLoading(false)
      return
    }

    const category = getFileCategory(selectedFile)

    if (isBinary(category) && !isExtractedTextPreviewFile(selectedFile)) {
      setFileContent("")
      lastLoadedRef.current = ""
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    readFile(selectedFile)
      .then((content) => {
        if (generation !== loadGenerationRef.current || selectedFileRef.current !== selectedFile) return
        lastLoadedRef.current = content
        setFileContent(content)
        setIsLoading(false)
      })
      .catch((err) => {
        if (generation !== loadGenerationRef.current || selectedFileRef.current !== selectedFile) return
        lastLoadedRef.current = ""
        setFileContent("")
        setLoadError(err instanceof Error ? err.message : String(err))
        setIsLoading(false)
      })
  }, [selectedFile, previewContentPath, externalPreview, flushPath, setFileContent])

  const handleSave = useCallback(
    (markdown: string, options?: { immediate?: boolean }) => {
      if (!selectedFile) return
      // Ignore no-op saves from the editor's initial re-emit. Only write
      // when the user has actually changed the content relative to the
      // last disk read.
      if (markdown === lastLoadedRef.current) return
      saveCoordinatorRef.current?.stage(selectedFile, markdown)
      setSaveState("idle")
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      if (options?.immediate) {
        void flushPath(selectedFile).catch(() => undefined)
        return
      }
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null
        void saveCoordinatorRef.current?.flush(selectedFile).catch(() => undefined)
      }, 1000)
    },
    [selectedFile, flushPath]
  )

  useEffect(() => {
    return () => {
      void flushPath(previousFileRef.current).catch(() => undefined)
      void saveCoordinatorRef.current?.flushAll()
    }
  }, [flushPath])

  if (!selectedFile) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select a file to preview
      </div>
    )
  }

  const category = getFileCategory(selectedFile)
  const fileName = externalPreview?.path === selectedFile
    ? externalPreview.title
    : getFileName(selectedFile)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-1.5">
        <span className="truncate text-xs text-muted-foreground" title={selectedFile}>
          {fileName}
        </span>
        <span className="ml-auto mr-2 text-[11px] text-muted-foreground" role="status">
          {saveState === "saving" ? "Saving..." : saveState === "saved" ? "Saved" : saveState === "error" ? "Save failed" : ""}
        </span>
        <button
          onClick={() => setSelectedFile(null)}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent"
          aria-label="Close preview"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex-1 min-w-0 overflow-auto">
        {isLoading ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" /> Loading file...
          </div>
        ) : loadError ? (
          <div className="flex h-full items-center justify-center p-6 text-sm text-destructive" role="alert">
            <div className="flex max-w-md items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Could not open this file: {loadError}</span>
            </div>
          </div>
        ) : externalPreview?.path === selectedFile ? (
          <ExternalReferencePreview
            source={externalPreview.source}
            title={externalPreview.title}
            path={externalPreview.url}
            snippet={externalPreview.snippet || fileContent}
          />
        ) : category === "markdown" ? (
          <WikiEditor
            key={selectedFile}
            content={fileContent}
            onSave={handleSave}
            filePath={selectedFile}
          />
        ) : (
          <FilePreview
            key={selectedFile}
            filePath={selectedFile}
            textContent={fileContent}
          />
        )}
      </div>
    </div>
  )
}

function ExternalReferencePreview({
  source,
  title,
  path,
  snippet,
}: {
  source: string
  title: string
  path: string
  snippet: string
}) {
  return (
    <div className="flex h-full flex-col overflow-auto p-6">
      <div className="mb-4 space-y-2">
        <div className="flex items-center gap-2">
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
            {source}
          </span>
          <h3 className="truncate text-sm font-medium" title={title}>{title}</h3>
        </div>
        <div className="break-all rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {path}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border/60 bg-background p-4">
        <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6">
          {snippet || "(No preview fragment returned.)"}
        </pre>
      </div>
    </div>
  )
}
