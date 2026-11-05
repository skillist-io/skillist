import { cn } from "@skillist/ui";

type SkillStateStripProps = {
  liveSemver: string | undefined;
  draftSemver: string | undefined;
  visibility: string | undefined;
  realtimeConnected: boolean;
  /** Why the draft can't publish. Null when it can, or when there is no draft. */
  publishBlockedReason: string | null;
};

function Readout({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-24 px-4 py-2.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-mono text-sm text-foreground">{children}</dd>
    </div>
  );
}

/**
 * The skill's state as an instrument row, kept above every tab so the answer to
 * "what is live, and can I ship?" never scrolls away. Each value is a word, so
 * nothing depends on colour; violet appears only while the connection is live.
 */
export function SkillStateStrip({
  liveSemver,
  draftSemver,
  visibility,
  realtimeConnected,
  publishBlockedReason,
}: SkillStateStripProps) {
  const publishState = !draftSemver
    ? "nothing to publish"
    : publishBlockedReason
      ? "blocked"
      : "ready";

  return (
    <div className="border border-border bg-card">
      <dl className="flex flex-wrap divide-x divide-border">
        <Readout label="Live">{liveSemver ? `v${liveSemver}` : "none"}</Readout>
        <Readout label="Draft">{draftSemver ? `v${draftSemver}` : "none"}</Readout>
        <Readout label="Visibility">{visibility ?? "…"}</Readout>
        <Readout label="Realtime">
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className={cn(
                "size-1.5",
                realtimeConnected ? "bg-signal" : "border border-muted-foreground",
              )}
            />
            {realtimeConnected ? "connected" : "disconnected"}
          </span>
        </Readout>
        <Readout label="Publish">{publishState}</Readout>
      </dl>
      {publishBlockedReason && (
        <p className="border-t border-border px-4 py-2 text-sm text-muted-foreground">
          {publishBlockedReason}
        </p>
      )}
    </div>
  );
}
