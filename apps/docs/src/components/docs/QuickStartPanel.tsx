import { InstallSnippet } from "@/components/docs/InstallSnippet";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const steps = [
  {
    prefix: "Install the CLI",
    command: "npm install -g @skillist/cli",
  },
  // Searching and installing public skills needs no credentials, so the fastest
  // path to value has no auth step at all. (This previously showed
  // `skillist login`, which is not a command the CLI has ever had.)
  {
    prefix: "Search the registry",
    command: "skillist search performance",
  },
  {
    prefix: "Install a skill",
    command: "skillist install skillist/web-perf-audit",
  },
];

export function QuickStartPanel() {
  return (
    <Card className="not-content">
      <CardHeader>
        <CardTitle className="text-base">Quick start</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {steps.map((step) => (
          <InstallSnippet key={step.command} prefix={step.prefix} command={step.command} />
        ))}
      </CardContent>
    </Card>
  );
}
