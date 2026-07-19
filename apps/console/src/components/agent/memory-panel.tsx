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
import { Brain, Trash2 } from "lucide-react";
import { useState } from "react";
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
export function MemoryPanel({ orgId }: { orgId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <Brain className="size-3.5" aria-hidden />
          Memory
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

function MemoryBody({ orgId }: { orgId: string }) {
  const { memories, isPending, isError, refetch, upsert, forget } = useAgentMemory(orgId);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [scope, setScope] = useState<"org" | "user">("org");
  const [redaction, setRedaction] = useState<RedactionMatch[] | null>(null);

  const canSave = key.trim().length > 0 && value.trim().length > 0 && !upsert.isPending;

  const handleSave = async () => {
    if (!canSave) return;
    const res = await upsert.mutateAsync({ key: key.trim(), value: value.trim(), scope });
    setRedaction(res.redacted);
    setKey("");
    setValue("");
  };

  return (
    <div className="flex flex-col gap-5">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSave();
        }}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="memory-key">Fact</Label>
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
              <option value="org">Org-wide</option>
              <option value="user">Just me</option>
            </NativeSelect>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="memory-value">Detail</Label>
          <Textarea
            id="memory-value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Every skill must pass a security review before publish."
            maxLength={4000}
            rows={2}
          />
        </div>
        {upsert.isError && (
          <p className="text-xs text-destructive">Couldn't save. Check the values and retry.</p>
        )}
        {redaction && redaction.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Saved with {redaction.map((r) => `${r.count} ${r.name.replace("_", " ")}`).join(", ")}{" "}
            redacted.
          </p>
        )}
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={!canSave}>
            {upsert.isPending ? "Saving…" : "Save fact"}
          </Button>
        </div>
      </form>

      <div className="flex flex-col gap-2">
        <span className="text-[0.625rem] font-semibold tracking-widest text-muted-foreground uppercase">
          Remembered
        </span>
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
            No durable facts yet. Save one above, or just tell the agent to remember something.
          </p>
        ) : (
          <ul className="flex max-h-64 flex-col divide-y divide-border overflow-y-auto border-y border-border">
            {memories.map((m) => (
              <MemoryRow
                key={m.id}
                memory={m}
                onForget={() => forget.mutate(m.key)}
                isForgetting={forget.isPending && forget.variables === m.key}
              />
            ))}
          </ul>
        )}
      </div>
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
