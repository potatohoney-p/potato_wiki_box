import { templates } from "@/lib/templates"
import { cn } from "@/lib/utils"
import { useTranslation } from "react-i18next"
import {
  BookOpen,
  BriefcaseBusiness,
  FileText,
  FlaskConical,
  Sprout,
  type LucideIcon,
} from "lucide-react"

const templateIcons: Record<string, LucideIcon> = {
  research: FlaskConical,
  reading: BookOpen,
  personal: Sprout,
  business: BriefcaseBusiness,
  general: FileText,
}

interface TemplatePickerProps {
  selected: string
  onSelect: (id: string) => void
}

export function TemplatePicker({ selected, onSelect }: TemplatePickerProps) {
  const { t } = useTranslation()

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {templates.map((template) => {
        const Icon = templateIcons[template.id] ?? FileText
        const name = t(`templates.${template.id}.name`, { defaultValue: template.name })
        const description = t(`templates.${template.id}.description`, {
          defaultValue: template.description,
        })

        return (
          <button
            key={template.id}
            type="button"
            onClick={() => onSelect(template.id)}
            className={cn(
              "grid min-h-20 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-md border p-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected === template.id
                ? "border-primary bg-accent ring-1 ring-primary"
                : "border-border bg-background",
            )}
          >
            <Icon className="row-span-2 mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 text-sm font-medium leading-tight">{name}</span>
            <span className="min-w-0 text-xs leading-snug text-muted-foreground">{description}</span>
          </button>
        )
      })}
    </div>
  )
}
