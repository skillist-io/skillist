import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { api, type SkillRunResult } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InstallSnippet } from "@/components/score-badges";

type SkillRunCardProps = {
  org: string;
  slug: string;
  scripts: string[];
  defaultTargetUrl?: string;
};

export function SkillRunCard({
  org,
  slug,
  scripts,
  defaultTargetUrl = "https://example.com",
}: SkillRunCardProps) {
  const [targetUrl, setTargetUrl] = useState(defaultTargetUrl);
  const [selectedScript, setSelectedScript] = useState(scripts[0] ?? "");
  const [runOutput, setRunOutput] = useState<string | null>(null);

  const activeScript = selectedScript || scripts[0] || "";

  const runScript = useMutation({
    mutationFn: (scriptPath: string) =>
      api<SkillRunResult>(`/v1/skills/${org}/${slug}/run`, {
        method: "POST",
        body: JSON.stringify({
          scriptPath,
          targetUrl: targetUrl || undefined,
        }),
      }),
    onSuccess: (result) => {
      setRunOutput(
        [
          result.stdout,
          result.stderr ? `stderr:\n${result.stderr}` : "",
          `exit ${result.exitCode} (${result.durationMs}ms) [${result.runtime}]`,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    },
    onError: (err) => {
      setRunOutput(err instanceof Error ? err.message : "Run failed");
    },
  });

  if (scripts.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Play className="h-4 w-4" /> Run in Sandbox
        </CardTitle>
        <CardDescription>
          Execute bundled scripts in an isolated environment
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label>Script</Label>
          <select
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={activeScript}
            onChange={(e) => setSelectedScript(e.target.value)}
          >
            {scripts.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label>Target URL (optional)</Label>
          <Input
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            placeholder="https://example.com"
          />
        </div>
        <InstallSnippet
          command={`skillist run ${org}/${slug} --script ${activeScript}${targetUrl ? ` --url ${targetUrl}` : ""}`}
        />
        <Button
          onClick={() => runScript.mutate(activeScript)}
          disabled={!activeScript || runScript.isPending}
        >
          {runScript.isPending ? "Running…" : "Run script"}
        </Button>
        {runOutput && (
          <pre className="max-h-64 overflow-auto rounded border bg-muted p-3 text-xs">
            {runOutput}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
