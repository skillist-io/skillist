import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Play } from "lucide-react";
import { useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SkillRunResult } from "@/lib/api";
import { fetchApiUrl } from "@/lib/api-url";
import { useSession } from "@/lib/auth-client";

type SkillRunCardProps = {
  org: string;
  repo: string;
  scripts: string[];
  defaultTargetUrl?: string;
};

async function parseSseRun(
  response: Response,
  onChunk: (stream: "stdout" | "stderr", chunk: string) => void,
): Promise<SkillRunResult> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let result: SkillRunResult | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const lines = part.split("\n");
      let event = "message";
      let data = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) event = line.slice(7);
        if (line.startsWith("data: ")) data = line.slice(6);
      }
      if (!data) continue;
      const payload = JSON.parse(data) as Record<string, unknown>;
      if (event === "output") {
        onChunk(payload.stream as "stdout" | "stderr", String(payload.chunk));
      } else if (event === "done") {
        result = payload as SkillRunResult;
      } else if (event === "error") {
        throw new Error(String(payload.message ?? "Execution failed"));
      }
    }
  }

  if (!result) throw new Error("Stream ended without result");
  return result;
}

export function SkillRunCard({
  org,
  repo,
  scripts,
  defaultTargetUrl = "https://example.com",
}: SkillRunCardProps) {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const isLoggedIn = Boolean(session?.user);
  const [targetUrl, setTargetUrl] = useState(defaultTargetUrl);
  const [selectedScript, setSelectedScript] = useState(scripts[0] ?? "");
  const [runOutput, setRunOutput] = useState<string | null>(null);

  const activeScript = selectedScript || scripts[0] || "";

  const runScript = useMutation({
    mutationFn: async (scriptPath: string) => {
      setRunOutput("");
      const response = await fetch(fetchApiUrl(`/${org}/${repo}/run`), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scriptPath,
          targetUrl: targetUrl || undefined,
          stream: true,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error((err as { error?: string }).error ?? "Run failed");
      }

      if (response.headers.get("content-type")?.includes("text/event-stream")) {
        return parseSseRun(response, (_stream, chunk) => {
          setRunOutput((prev) => `${prev ?? ""}${chunk}`);
        });
      }

      return response.json() as Promise<SkillRunResult>;
    },
    onSuccess: (result) => {
      setRunOutput((prev) =>
        [
          prev,
          result.stderr ? `\nstderr:\n${result.stderr}` : "",
          `\nexit ${result.exitCode} (${result.durationMs}ms) [${result.runtime}]`,
        ]
          .filter(Boolean)
          .join(""),
      );
      queryClient.invalidateQueries({ queryKey: ["runs", org, repo] });
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
          Execute bundled scripts in an isolated environment — sign in required
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!isLoggedIn && (
          <p className="border border-border bg-muted/50 px-3 py-2 text-sm text-foreground">
            <Link
              to="/login"
              search={{ redirect: window.location.pathname }}
              className="font-medium underline"
            >
              Sign in
            </Link>{" "}
            to run scripts in the hosted sandbox.
          </p>
        )}
        <div className="space-y-1">
          <Label htmlFor="run-script-select">Script</Label>
          <select
            id="run-script-select"
            className="h-10 w-full border border-transparent border-b-input bg-transparent px-1 text-sm outline-none transition-[border-color] pointer-coarse:h-11 focus-visible:border-b-ring"
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
        <div className="space-y-1">
          <Label htmlFor="run-target-url">Target URL (optional)</Label>
          <Input
            id="run-target-url"
            type="url"
            inputMode="url"
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            placeholder="https://example.com"
          />
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 overflow-x-auto bg-muted px-2 py-1.5 font-mono text-xs">
            {`skillist run ${org}/${repo} --script ${activeScript}${targetUrl ? ` --url ${targetUrl}` : ""}`}
          </code>
          <CopyButton
            value={`skillist run ${org}/${repo} --script ${activeScript}${targetUrl ? ` --url ${targetUrl}` : ""}`}
            label="Copy"
            size="sm"
          />
        </div>
        <Button
          onClick={() => runScript.mutate(activeScript)}
          disabled={!isLoggedIn || !activeScript || runScript.isPending}
        >
          {runScript.isPending ? "Running…" : "Run script"}
        </Button>
        {runOutput && (
          <pre className="max-h-64 overflow-auto border border-border bg-muted p-3 text-xs whitespace-pre-wrap">
            {runOutput}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
