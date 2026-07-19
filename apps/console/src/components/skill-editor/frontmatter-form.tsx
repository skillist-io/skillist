import {
  parseSkillMd,
  type SkillFrontmatter,
  updateSkillMdFrontmatter,
  type ValidationError,
  validateSkillName,
} from "@skillist/skill-format";
import { Badge, Button, cn, Input, Label, Textarea } from "@skillist/ui";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

const LIMITS = { name: 64, description: 1024, compatibility: 500 } as const;

function CharCount({ value, max }: { value: string; max: number }) {
  return (
    <span
      className={cn(
        "font-mono text-xs",
        value.length > max ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {value.length}/{max}
    </span>
  );
}

function FieldErrors({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <ul className="space-y-0.5 text-xs text-destructive">
      {errors.map((message) => (
        <li key={message}>{message}</li>
      ))}
    </ul>
  );
}

export function FrontmatterForm({
  content,
  repoSlug,
  errors = [],
  onChange,
}: {
  /** Full SKILL.md source — the single source of truth the form projects from. */
  content: string;
  repoSlug: string;
  errors?: ValidationError[];
  onChange: (content: string) => void;
}) {
  // A metadata row being keyed in has no object entry until its key is non-empty.
  const [draftRow, setDraftRow] = useState<{ key: string; value: string } | null>(null);

  const parsed = parseSkillMd(content);
  if (!parsed || typeof parsed.frontmatter !== "object" || parsed.frontmatter === null) {
    return (
      <div className="border border-destructive/40 p-4 text-sm">
        <p className="font-medium">Frontmatter is not valid YAML.</p>
        <p className="mt-1 text-muted-foreground">
          Fix the block between the <code>---</code> fences in the source editor to edit fields
          here.
        </p>
      </div>
    );
  }

  const fm = parsed.frontmatter as Record<string, unknown>;
  const str = (key: string) => (typeof fm[key] === "string" ? (fm[key] as string) : "");
  const metadata =
    fm.metadata && typeof fm.metadata === "object" && !Array.isArray(fm.metadata)
      ? (fm.metadata as Record<string, string>)
      : {};

  const emit = (next: Record<string, unknown>) => {
    const compact = Object.fromEntries(
      Object.entries(next).filter(([key, value]) => {
        if (key === "name" || key === "description") return true;
        if (value === undefined || value === "") return false;
        if (key === "metadata" && Object.keys(value as object).length === 0) return false;
        return true;
      }),
    );
    onChange(updateSkillMdFrontmatter(content, compact as SkillFrontmatter));
  };

  const setField = (key: string, value: string) => emit({ ...fm, [key]: value });

  const setMetadataEntry = (index: number, key: string, value: string) => {
    const entries = Object.entries(metadata);
    entries[index] = [key, value];
    emit({ ...fm, metadata: Object.fromEntries(entries.filter(([k]) => k !== "")) });
  };

  const removeMetadataEntry = (index: number) => {
    const entries = Object.entries(metadata);
    entries.splice(index, 1);
    emit({ ...fm, metadata: Object.fromEntries(entries) });
  };

  const commitDraftRow = () => {
    if (!draftRow) return;
    const key = draftRow.key.trim();
    if (key === "" || metadata[key] !== undefined) return;
    setDraftRow(null);
    emit({ ...fm, metadata: { ...metadata, [key]: draftRow.value } });
  };

  const fieldErrors = (field: string) =>
    errors.filter((e) => e.path === `frontmatter.${field}`).map((e) => e.message);
  const nameErrors = [
    ...new Set([
      ...fieldErrors("name"),
      ...validateSkillName(str("name"), repoSlug).map((e) => e.message),
    ]),
  ];

  return (
    <div className="space-y-4 p-1">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="fm-name">name</Label>
          <CharCount value={str("name")} max={LIMITS.name} />
        </div>
        <Input
          id="fm-name"
          value={str("name")}
          onChange={(e) => setField("name", e.target.value)}
          className="rounded-none font-mono text-xs"
          aria-invalid={nameErrors.length > 0}
        />
        <FieldErrors errors={nameErrors} />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="fm-description">description</Label>
          <CharCount value={str("description")} max={LIMITS.description} />
        </div>
        <Textarea
          id="fm-description"
          value={str("description")}
          onChange={(e) => setField("description", e.target.value)}
          className="min-h-20 rounded-none text-xs"
          placeholder="What the skill does and when to use it."
          aria-invalid={fieldErrors("description").length > 0}
        />
        <FieldErrors errors={fieldErrors("description")} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="fm-license">license</Label>
        <Input
          id="fm-license"
          value={str("license")}
          onChange={(e) => setField("license", e.target.value)}
          className="rounded-none text-xs"
          placeholder="MIT, Apache-2.0, or a bundled license file"
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="fm-compatibility">compatibility</Label>
          <CharCount value={str("compatibility")} max={LIMITS.compatibility} />
        </div>
        <Textarea
          id="fm-compatibility"
          value={str("compatibility")}
          onChange={(e) => setField("compatibility", e.target.value)}
          className="min-h-14 rounded-none text-xs"
          placeholder="Environment requirements — only if the skill needs them."
          aria-invalid={fieldErrors("compatibility").length > 0}
        />
        <FieldErrors errors={fieldErrors("compatibility")} />
      </div>

      <fieldset className="space-y-1.5">
        <legend className="flex w-full items-center justify-between">
          <Label asChild>
            <span>metadata</span>
          </Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-xs"
            onClick={() => setDraftRow({ key: "", value: "" })}
            disabled={draftRow !== null}
          >
            <Plus className="size-3" aria-hidden /> Add
          </Button>
        </legend>
        {Object.entries(metadata).map(([key, value], index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: keying by the key text would remount the row mid-rename and drop focus
          <div key={`${index}-metadata-row`} className="flex items-center gap-1.5">
            <Input
              value={key}
              onChange={(e) => setMetadataEntry(index, e.target.value, value)}
              className="w-2/5 rounded-none font-mono text-xs"
              aria-label={`Metadata key ${index + 1}`}
            />
            <Input
              value={value}
              onChange={(e) => setMetadataEntry(index, key, e.target.value)}
              className="flex-1 rounded-none text-xs"
              aria-label={`Metadata value for ${key}`}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="size-6 shrink-0 p-0"
              onClick={() => removeMetadataEntry(index)}
              aria-label={`Remove metadata ${key}`}
            >
              <Trash2 className="size-3" aria-hidden />
            </Button>
          </div>
        ))}
        {draftRow && (
          // biome-ignore lint/a11y/noStaticElementInteractions: blur here only observes focus leaving the row's inputs; the div is not interactive itself
          <div
            className="flex items-center gap-1.5"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) commitDraftRow();
            }}
          >
            <Input
              autoFocus
              value={draftRow.key}
              onChange={(e) => setDraftRow({ key: e.target.value, value: draftRow.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitDraftRow();
              }}
              placeholder="key"
              className="w-2/5 rounded-none font-mono text-xs"
              aria-label="New metadata key"
            />
            <Input
              value={draftRow.value}
              onChange={(e) => setDraftRow({ key: draftRow.key, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitDraftRow();
              }}
              placeholder="value"
              className="flex-1 rounded-none text-xs"
              aria-label="New metadata value"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="size-6 shrink-0 p-0"
              onClick={() => setDraftRow(null)}
              aria-label="Discard new metadata row"
            >
              <Trash2 className="size-3" aria-hidden />
            </Button>
          </div>
        )}
        <FieldErrors
          errors={errors
            .filter((e) => e.path.startsWith("frontmatter.metadata"))
            .map((e) => e.message)}
        />
      </fieldset>

      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Label htmlFor="fm-allowed-tools">allowed-tools</Label>
          <Badge variant="outline">experimental</Badge>
        </div>
        <Input
          id="fm-allowed-tools"
          value={str("allowed-tools")}
          onChange={(e) => setField("allowed-tools", e.target.value)}
          className="rounded-none font-mono text-xs"
          placeholder="Bash(git:*) Read Write"
        />
        <p className="text-xs text-muted-foreground">
          Space-separated tools pre-approved to run. Support varies by agent.
        </p>
      </div>
    </div>
  );
}
