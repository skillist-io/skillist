import { ArrowRight, ExternalLink, Settings } from "lucide-react"

import { Button } from "@/components/ui/button"

type HeroAction = {
  text: string
  link: string
  variant?: "primary" | "minimal"
  icon?: string
}

const iconMap = {
  "right-arrow": ArrowRight,
  setting: Settings,
  external: ExternalLink,
} as const

function toButtonVariant(variant?: HeroAction["variant"]) {
  return variant === "primary" ? "default" : "outline"
}

export function HeroActions({ actions }: { actions: HeroAction[] }) {
  if (actions.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-3">
      {actions.map((action) => {
        const Icon = action.icon
          ? iconMap[action.icon as keyof typeof iconMap]
          : undefined
        const isExternal = action.link.startsWith("http")

        return (
          <Button
            key={action.link}
            variant={toButtonVariant(action.variant)}
            size="lg"
            asChild
          >
            <a
              href={action.link}
              {...(isExternal
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
            >
              {action.text}
              {Icon ? <Icon /> : null}
            </a>
          </Button>
        )
      })}
    </div>
  )
}
