import {
  CheckCircle2,
  Laptop,
  Puzzle,
  Rocket,
  type LucideIcon,
} from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

type Feature = {
  title: string
  description: string
  icon: LucideIcon
}

const features: Feature[] = [
  {
    title: "Registry MCP",
    icon: Puzzle,
    description:
      "Search and install skills from your agent via streamable HTTP at api.skillist.dev/mcp.",
  },
  {
    title: "CLI",
    icon: Rocket,
    description:
      "Install skills locally with skillist install org/slug and publish from your repo.",
  },
  {
    title: "Hosted execution",
    icon: Laptop,
    description:
      "Run skill scripts in isolated Cloudflare sandboxes with streaming output.",
  },
  {
    title: "Evals",
    icon: CheckCircle2,
    description:
      "Measure skill uplift across versions before publishing to the registry.",
  },
]

export function FeatureCards() {
  return (
    <div className="not-content grid gap-4 sm:grid-cols-2">
      {features.map((feature) => {
        const Icon = feature.icon
        return (
          <Card key={feature.title} className="h-full">
            <CardHeader>
              <div className="mb-2 flex size-9 items-center justify-center rounded-lg border bg-muted">
                <Icon className="size-4 text-primary" />
              </div>
              <CardTitle>{feature.title}</CardTitle>
              <CardDescription>{feature.description}</CardDescription>
            </CardHeader>
            <CardContent />
          </Card>
        )
      })}
    </div>
  )
}
