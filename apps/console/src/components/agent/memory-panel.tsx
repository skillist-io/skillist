import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  NativeSelect,
  QueryError,
  Skeleton,
  Textarea,
} from "@skillist/ui";
import { Brain, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { relativeTime } from "@/lib/relative-time";
import { type AgentMemory, type RedactionMatch, useAgentMemory } from "@/lib/use-agent-memory";

/**
 * Manage the agent's durable governance memory: the facts injected into its
 * system prompt every turn. Org-wide facts are visible to every member; a
 * user-scoped fact is pinned to the person who saved it. Values are PII-redacted
 * server-side on save, so we surface the redaction tally back rather than
 * silently altering what the user typed.
 *
 * Rendered as a self-contained trigger + dialog so it drops into both the
 * /agent page header and the ⌘K drawer toolbar unchanged.
 */
export function MemoryPanel({
  orgId,
  compact = false,
}: {
  orgId: string;
  /** Icon only, for the drawer's narrow toolbar. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2" title={compact ? "Memory" : undefined}>
          <Brain className="size-3.5" aria-hidden />
          <span className={compact ? "sr-only" : undefined}>Memory</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg gap-6">
        <DialogHeader>
          <DialogTitle>Agent memory</DialogTitle>
          <DialogDescription>
            Durable facts the agent recalls in every conversation. Personal data is redacted on
            save.
          </DialogDescription>
        </DialogHeader>
        {open && <MemoryBody orgId={orgId} />}
      </DialogContent>
    </Dialog>
  );
}

function provenance(memory: AgentMemory): string {
  const by = memory.updatedByName ? ` for ${memory.updatedByName}` : "";
  const how =
    memory.source === "agent"
      ? `Saved by the agent${by}`
      : memory.source === "console"
        ? `Saved in the console${memory.updatedByName ? ` by ${memory.updatedByName}` : ""}`
        : "Source not recorded";
  return `${how} · updated ${relativeTime(memory.updatedAt)}`;
}

function MemoryBody({ orgId }: { orgId: string }) {
  const { memories, isPending, isError, refetch, upsert, forget } = useAgentMemory(orgId);
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  // Personal by default: an org-wide fact reaches every member's prompt, so that
  // reach should be a choice rather than what happens if nobody touches the select.
  const [scope, setScope] = useState<"org" | "user">("user");
  const [redaction, setRedaction] = useState<RedactionMatch[] | null>(null);
  const [forgotten, setForgotten] = useState<AgentMemory | null>(null);

  const canSave = key.trim().length > 0 && value.trim().length > 0 && !upsert.isPending;
  // Saving over an existing key replaces it, so say that before it happens.
  const replaces = memories.find(
    (m) => m.key === key.trim() && (scope === "org" ? m.userId === null : m.userId !== null),
  );

  const handleSave = async () => {
    if (!canSave) return;
    const res = await upsert.mutateAsync({ key: key.trim(), value: value.trim(), scope });
    setRedaction(res.redacted);
    setKey("");
    setValue("");
    setAdding(false);
  };

  const handleForget = (memory: AgentMemory) => {
    setForgotten(null);
    forget.mutate(memory.key, { onSuccess: () => setForgotten(memory) });
  };

  const handleUndo = () => {
    if (!forgotten) return;
    upsert.mutate(
      {
        key: forgotten.key,
        value: forgotten.value,
        scope: forgotten.userId ? "user" : "org",
      },
      { onSuccess: () => setForgotten(null) },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {isError ? (
        <QueryError title="Couldn't load memory" onRetry={() => void refetch()} />
      ) : isPending ? (
        <div className="flex flex-col gap-2" aria-busy role="status">
          <span className="sr-only">Loading memory</span>
          {[80, 64, 72].map((w) => (
            <Skeleton key={w} className="h-12" style={{ width: `${w}%` }} />
          ))}
        </div>
      ) : memories.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">
          No durable facts yet. Add one below, or tell the agent to remember something.
        </p>
      ) : (
        <ul className="flex max-h-72 flex-col divide-y divide-border overflow-y-auto border-y border-border">
          {memories.map((m) => (
            <MemoryRow
              key={m.id}
              memory={m}
              onForget={() => handleForget(m)}
              isForgetting={forget.isPending && forget.variables === m.key}
            />
          ))}
        </ul>
      )}

      {forget.isError && (
        <p role="alert" className="text-xs text-destructive">
          Couldn't forget that fact. Try again.
        </p>
      )}
      {forgotten && (
        <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
          Forgot {forgotten.key}.
          <button
            type="button"
            onClick={handleUndo}
            disabled={upsert.isPending}
            className="underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            Undo
          </button>
        </p>
      )}
      {redaction && redaction.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Saved with {redaction.map((r) => `${r.count} ${r.name.replace("_", " ")}`).join(", ")}{" "}
          redacted.
        </p>
      )}

      {adding ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSave();
          }}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="memory-key">Key</Label>
              <Input
                id="memory-key"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="e.g. security-policy"
                maxLength={128}
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="memory-scope">Scope</Label>
              <NativeSelect
                id="memory-scope"
                value={scope}
                onChange={(e) => setScope(e.target.value as "org" | "user")}
                className="h-9 sm:w-28"
              >
                <option value="user">Just me</option>
                <option value="org">Org-wide</option>
              </NativeSelect>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="memory-value">Fact</Label>
            <Textarea
              id="memory-value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Every skill must pass a security review before publish."
              maxLength={4000}
              rows={2}
            />
          </div>
          {replaces && (
            <p className="text-xs text-muted-foreground">
              This replaces the existing fact: {replaces.value}
            </p>
          )}
          {upsert.isError && (
            <p className="text-xs text-destructive">Couldn't save. Check the values and retry.</p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!canSave}>
              {upsert.isPending ? "Saving…" : replaces ? "Replace fact" : "Save fact"}
            </Button>
          </div>
        </form>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit gap-2"
          onClick={() => setAdding(true)}
        >
          <Plus className="size-3.5" aria-hidden />
          Add a fact
        </Button>
      )}
    </div>
  );
}

function MemoryRow({
  memory,
  onForget,
  isForgetting,
}: {
  memory: AgentMemory;
  onForget: () => void;
  isForgetting: boolean;
}) {
  return (
    <li className="group/mem flex items-start justify-between gap-3 py-2.5">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-xs text-foreground">{memory.key}</span>
          <Badge variant={memory.userId ? "secondary" : "default"}>
            {memory.userId ? "Personal" : "Org"}
          </Badge>
        </div>
        <p className="text-sm break-words text-muted-foreground">{memory.value}</p>
        <p className="text-xs text-muted-foreground">{provenance(memory)}</p>
      </div>
      <button
        type="button"
        onClick={onForget}
        disabled={isForgetting}
        aria-label={`Forget: ${memory.key}`}
        className="mt-0.5 flex size-6 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-destructive focus-visible:text-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50 motion-reduce:opacity-100 sm:opacity-0 sm:group-hover/mem:opacity-100 sm:group-focus-within/mem:opacity-100"
      >
        <Trash2 className="size-3.5" aria-hidden />
      </button>
    </li>
  );
}
