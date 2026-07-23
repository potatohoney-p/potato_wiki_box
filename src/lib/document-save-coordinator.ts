export type DocumentWriter = (path: string, contents: string) => Promise<void>

export interface DocumentSaveEvent {
  path: string
  contents: string
}

const activeCoordinators = new Set<DocumentSaveCoordinator>()
const inFlightDocumentSaves = new Set<Promise<void>>()

function trackDocumentSave(task: Promise<void>): Promise<void> {
  inFlightDocumentSaves.add(task)
  void task.then(
    () => inFlightDocumentSaves.delete(task),
    () => inFlightDocumentSaves.delete(task),
  )
  return task
}

export function registerDocumentSaveCoordinator(
  coordinator: DocumentSaveCoordinator,
): () => void {
  activeCoordinators.add(coordinator)
  return () => activeCoordinators.delete(coordinator)
}

export async function flushAllDocumentSaves(): Promise<void> {
  await Promise.all([...activeCoordinators].map((coordinator) => coordinator.flushAll()))
  while (inFlightDocumentSaves.size > 0) {
    await Promise.all([...inFlightDocumentSaves])
  }
}

interface DocumentSaveCoordinatorOptions {
  onSaving?: (event: DocumentSaveEvent) => void
  onSaved?: (event: DocumentSaveEvent) => void
  onError?: (event: DocumentSaveEvent, error: unknown) => void
}

/**
 * Serializes document writes and keeps the newest unsaved contents per path.
 * A slow save for one file can never complete after a newer save and overwrite
 * it, and switching documents can flush the old path without touching the new
 * document's UI state.
 */
export class DocumentSaveCoordinator {
  private readonly pending = new Map<string, string>()
  private chain: Promise<void> = Promise.resolve()

  constructor(
    private readonly writer: DocumentWriter,
    private readonly options: DocumentSaveCoordinatorOptions = {},
  ) {}

  stage(path: string, contents: string): void {
    this.pending.set(path, contents)
  }

  hasPending(path: string): boolean {
    return this.pending.has(path)
  }

  flush(path: string): Promise<void> {
    const contents = this.pending.get(path)
    if (contents === undefined) return this.chain

    const event = { path, contents }
    const task = this.chain
      .catch(() => undefined)
      .then(async () => {
        // A newer edit superseded this queued snapshot before it started.
        if (this.pending.get(path) !== contents) return
        this.options.onSaving?.(event)
        try {
          await this.writer(path, contents)
          if (this.pending.get(path) === contents) this.pending.delete(path)
          this.options.onSaved?.(event)
        } catch (error) {
          this.options.onError?.(event, error)
          throw error
        }
      })
    this.chain = task
    return trackDocumentSave(task)
  }

  async flushAll(): Promise<void> {
    while (this.pending.size > 0) {
      const paths = [...this.pending.keys()]
      await Promise.all(paths.map((path) => this.flush(path)))
    }
    await this.chain
  }

  whenIdle(): Promise<void> {
    return this.chain
  }
}
