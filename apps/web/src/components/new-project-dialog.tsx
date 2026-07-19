import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Lock, Users } from "lucide-react";
import * as React from "react";
import { VISIBILITY_HELP } from "@/components/project-visibility";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, type ProjectVisibility } from "@/lib/api";
import { cn } from "@/lib/utils";

/** kebab-case a name into a URL-safe slug suggestion. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

type NewProjectDialogProps = {
  orgId: string;
  /** The element that opens the dialog. Rendered via `DialogTrigger asChild`. */
  trigger: React.ReactNode;
};

/**
 * Single shared create-project implementation. Renders a squared modal Dialog
 * containing the create form. On success it closes, invalidates the org's
 * project list, and navigates into the new project workspace.
 */
export function NewProjectDialog({ orgId, trigger }: NewProjectDialogProps) {
  const [open, setOpen] = React.useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [slugEdited, setSlugEdited] = React.useState(false);
  const [description, setDescription] = React.useState("");
  const [visibility, setVisibility] = React.useState<ProjectVisibility>("private");
  const [error, setError] = React.useState<string | null>(null);

  const reset = React.useCallback(() => {
    setName("");
    setSlug("");
    setSlugEdited(false);
    setDescription("");
    setVisibility("private");
    setError(null);
  }, []);

  const createProject = useMutation({
    mutationFn: () =>
      api<{ id: string; slug: string; name: string }>(`/v1/orgs/${orgId}/projects`, {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim(),
          description: description.trim() || undefined,
          visibility,
        }),
      }),
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["projects", orgId] });
      setOpen(false);
      reset();
      void navigate({
        to: "/orgs/$orgId/projects/$projectId",
        params: { orgId, projectId: project.id },
      });
    },
    onError: (err) => {
      setError(
        err instanceof Error && err.message.includes("409")
          ? "That slug is already taken in this organization."
          : err instanceof Error
            ? err.message
            : "Could not create project",
      );
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            Group related skills into a browsable, foldered tree.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && slug.trim()) createProject.mutate();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="new-proj-name">Name</Label>
            <Input
              id="new-proj-name"
              autoFocus
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!slugEdited) setSlug(slugify(e.target.value));
              }}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-proj-slug">Slug</Label>
            <Input
              id="new-proj-slug"
              className="font-mono text-xs"
              value={slug}
              onChange={(e) => {
                setSlugEdited(true);
                setSlug(slugify(e.target.value));
              }}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-proj-desc">Description (optional)</Label>
            <Textarea
              id="new-proj-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          <fieldset className="space-y-1.5">
            <legend className="mb-1.5 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
              Visibility
            </legend>
            <div className="grid grid-cols-2 gap-px border border-border bg-border">
              <VisibilityOption
                value="private"
                icon={Lock}
                label="Private"
                current={visibility}
                onSelect={setVisibility}
              />
              <VisibilityOption
                value="shared"
                icon={Users}
                label="Shared"
                current={visibility}
                onSelect={setVisibility}
              />
            </div>
            <p className="text-xs text-muted-foreground">{VISIBILITY_HELP[visibility]}</p>
          </fieldset>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="submit"
              size="sm"
              disabled={!name.trim() || !slug.trim() || createProject.isPending}
            >
              {createProject.isPending ? "Creating…" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** One cell of the visibility segmented control: a hidden radio with a squared,
 * icon+text label so the choice is never conveyed by color alone. */
function VisibilityOption({
  value,
  icon: Icon,
  label,
  current,
  onSelect,
}: {
  value: ProjectVisibility;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  current: ProjectVisibility;
  onSelect: (value: ProjectVisibility) => void;
}) {
  const selected = current === value;
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center justify-center gap-1.5 bg-background px-3 py-2 text-xs font-semibold tracking-widest uppercase transition-colors",
        "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/30 has-[:focus-visible]:outline-none",
        selected
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <input
        type="radio"
        name="new-proj-visibility"
        value={value}
        checked={selected}
        onChange={() => onSelect(value)}
        className="sr-only"
      />
      <Icon className="size-3.5" aria-hidden />
      {label}
    </label>
  );
}
