import { create } from "zustand"
import type { WebSearchResult } from "@/lib/web-search"

export interface ResearchTask {
  id: string
  reviewId?: string
  topic: string
  searchQueries?: string[]
  status: "queued" | "searching" | "synthesizing" | "saving" | "done" | "error"
  webResults: WebSearchResult[]
  synthesis: string
  savedPath: string | null
  error: string | null
  createdAt: number
}

interface ResearchState {
  tasks: ResearchTask[]
  panelOpen: boolean
  maxConcurrent: number

  addTask: (topic: string, reviewId?: string) => string
  updateTask: (id: string, updates: Partial<ResearchTask>) => void
  removeTask: (id: string) => void
  setTasks: (tasks: ResearchTask[]) => void
  setPanelOpen: (open: boolean) => void
  getRunningCount: () => number
  getNextQueued: () => ResearchTask | undefined
}

export const useResearchStore = create<ResearchState>((set, get) => ({
  tasks: [],
  panelOpen: false,
  maxConcurrent: 3,

  addTask: (topic, reviewId) => {
    const id = `research-${crypto.randomUUID()}`
    set((state) => ({
      tasks: [
        ...state.tasks,
        {
          id,
          ...(reviewId ? { reviewId } : {}),
          topic,
          status: "queued",
          webResults: [],
          synthesis: "",
          savedPath: null,
          error: null,
          createdAt: Date.now(),
        },
      ],
      panelOpen: true,
    }))
    return id
  },

  updateTask: (id, updates) =>
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    })),

  removeTask: (id) =>
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== id),
    })),

  setTasks: (tasks) => set({ tasks }),

  setPanelOpen: (panelOpen) => set({ panelOpen }),

  getRunningCount: () => {
    const { tasks } = get()
    return tasks.filter((t) =>
      t.status === "searching" || t.status === "synthesizing" || t.status === "saving"
    ).length
  },

  getNextQueued: () => {
    const { tasks } = get()
    return tasks.find((t) => t.status === "queued")
  },
}))
