import { useEffect, useState } from "react"
import { FolderOpen, Plus, Clock, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { getRecentProjects, removeFromRecentProjects } from "@/lib/project-store"
import type { WikiProject } from "@/types/wiki"
import { useTranslation } from "react-i18next"
import logoImg from "@/assets/logo.jpg"

interface WelcomeScreenProps {
  onCreateProject: () => void
  onOpenProject: () => void
  onSelectProject: (project: WikiProject) => void
}

export function WelcomeScreen({
  onCreateProject,
  onOpenProject,
  onSelectProject,
}: WelcomeScreenProps) {
  const { t } = useTranslation()
  const [recentProjects, setRecentProjects] = useState<WikiProject[]>([])

  useEffect(() => {
    getRecentProjects().then(setRecentProjects).catch(() => {})
  }, [])

  async function handleRemoveRecent(e: React.MouseEvent, path: string) {
    e.stopPropagation()
    await removeFromRecentProjects(path)
    const updated = await getRecentProjects()
    setRecentProjects(updated)
  }

  return (
    <div className="flex h-full items-center justify-center bg-background">
      <div className="flex w-full max-w-lg flex-col items-center gap-7 px-4">
        <div className="text-center">
          <img src={logoImg} alt="" className="mx-auto mb-2 h-20 w-20 rounded-md object-cover" />
          <h1 className="text-3xl font-bold">{t("app.title")}</h1>
          <p className="mx-auto mt-2 max-w-md text-pretty text-muted-foreground">
            {t("app.subtitle")}
          </p>
        </div>

        <div className="flex flex-wrap justify-center gap-3">
          <Button onClick={onCreateProject} className="max-sm:min-h-11">
            <Plus className="mr-2 h-4 w-4" />
            {t("welcome.newProject")}
          </Button>
          <Button variant="outline" onClick={onOpenProject} className="max-sm:min-h-11">
            <FolderOpen className="mr-2 h-4 w-4" />
            {t("welcome.openProject")}
          </Button>
        </div>

        {recentProjects.length > 0 && (
          <div className="w-full max-w-md">
            <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              {t("welcome.recentProjects")}
            </div>
            <div className="overflow-hidden rounded-md border">
              {recentProjects.map((proj) => (
                <div key={proj.path} className="group flex items-stretch border-b last:border-b-0 hover:bg-accent">
                  <button
                    type="button"
                    onClick={() => onSelectProject(proj)}
                    className="min-w-0 flex-1 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <div className="truncate text-sm font-medium">{proj.name}</div>
                    <div className="truncate text-xs text-muted-foreground" title={proj.path}>
                      {proj.path}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleRemoveRecent(e, proj.path)}
                    className="m-2 flex size-8 shrink-0 items-center justify-center rounded-md opacity-60 transition-colors hover:bg-destructive/10 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                    aria-label={t("welcome.removeRecent", { name: proj.name })}
                    title={t("welcome.removeRecent", { name: proj.name })}
                  >
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
