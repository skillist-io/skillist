import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { InstallSnippet } from "@/components/docs/InstallSnippet"

const steps = [
  {
    prefix: "Install the CLI",
    command: "npm install -g @skillist/cli",
  },
  {
    prefix: "Sign in",
    command: "skillist login",
  },
  {
    prefix: "Search the registry",
    command: "skillist search performance",
  },
  {
    prefix: "Install a skill",
    command: "skillist install skillist/web-perf-audit",
  },
]

export function QuickStartPanel() {
  return (
    <Card className="not-content">
      <CardHeader>
        <CardTitle className="text-base">Quick start</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {steps.map((step) => (
          <InstallSnippet
            key={step.command}
            prefix={step.prefix}
            command={step.command}
          />
        ))}
      </CardContent>
    </Card>
  )
}
