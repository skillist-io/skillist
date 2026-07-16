import {
  ArrowUpRight,
  CheckCircle2,
  Laptop,
  Puzzle,
  Rocket,
  type LucideIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

type Feature = {
  title: string
  description: string
  href: string
  icon: LucideIcon
  badge?: string
}

const features: Feature[] = [
  {
    title: "Registry MCP",
    icon: Puzzle,
    badge: "MCP",
    href: "/mcp/",
    description:
      "Search and install skills from your agent via streamable HTTP at api.skillist.dev/mcp.",
  },
  {
    title: "CLI",
    icon: Rocket,
    badge: "Tooling",
    href: "/getting-started/cli/",
    description:
      "Install skills locally with skillist install org/slug and publish from your repo.",
  },
  {
    title: "Hosted execution",
    icon: Laptop,
    badge: "Sandbox",
    href: "/platform/sandbox/",
    description:
      "Run skill scripts in isolated Cloudflare sandboxes with streaming output.",
  },
  {
    title: "Evals",
    icon: CheckCircle2,
    badge: "Quality",
    href: "/platform/registry/",
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
          <a key={feature.title} href={feature.href} className="group block h-full">
            <Card className="h-full transition-colors hover:bg-muted/30">
              <CardHeader>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex size-9 items-center justify-center bg-muted ring-1 ring-foreground/5">
                    <Icon className="size-4 text-primary" />
                  </div>
                  {feature.badge ? (
                    <Badge variant="secondary">{feature.badge}</Badge>
                  ) : null}
                </div>
                <CardTitle className="text-base">{feature.title}</CardTitle>
                <CardDescription>{feature.description}</CardDescription>
              </CardHeader>
              <CardFooter className="pt-0">
                <span className="inline-flex items-center gap-1 text-[0.625rem] font-semibold tracking-widest text-primary uppercase">
                  Learn more
                  <ArrowUpRight className="size-3 transition-transform group-hover:-translate-y-px group-hover:translate-x-px" />
                </span>
              </CardFooter>
            </Card>
          </a>
        )
      })}
    </div>
  )
}
