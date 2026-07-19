import {
  api,
  Button,
  Label,
  NativeSelect,
  type Org,
  Popover,
  PopoverContent,
  PopoverTrigger,
  type Project,
  type ProjectDetail,
} from "@skillist/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, FolderPlus } from "lucide-react";
import { useState } from "react";
import { FolderInput } from "@/components/folder-input";
import { projectFolderPaths } from "@/lib/project-tree";

/**
 * What gets pinned into the project. A native skill item carries its `skillId`;
 * registry/inventory rows (where the web app only knows org/repo) pin an
 * external link to the public skill instead.
 */
export type AddToProjectTarget =
  | { kind: "skill"; skillId: string; label?: string; note?: string }
  | { kind: "external"; externalUrl: string; externalName?: string; note?: string };

type AddToProjectButtonProps = {
  target: AddToProjectTarget;
  /** Weight parity with the star control; icon-only for dense rows. */
  variant?: "outline" | "ghost";
  size?: "xs" | "sm" | "default";
  iconOnly?: boolean;
};

export function AddToProjectButton({
  target,
  variant = "outline",
  size = "sm",
  iconOnly = false,
}: AddToProjectButtonProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [folder, setFolder] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  const { data: orgs } = useQuery({
    queryKey: ["orgs"],
    queryFn: () => api<Org[]>("/v1/orgs"),
  });
  const orgId = selectedOrgId || orgs?.[0]?.id || "";

  const { data: projects } = useQuery({
    queryKey: ["projects", orgId],
    queryFn: () => api<Project[]>(`/v1/orgs/${orgId}/projects`),
    enabled: open && !!orgId,
  });
  // Only offer projects the user can curate into; readers/viewers are excluded.
  const writableProjects = projects?.filter((p) => p.canWrite);
  const projectId = selectedProjectId || writableProjects?.[0]?.id || "";

  // Seed folder autocomplete from the chosen project's existing folders.
  const { data: projectDetail } = useQuery({
    queryKey: ["project", orgId, projectId],
    queryFn: () => api<ProjectDetail>(`/v1/orgs/${orgId}/projects/${projectId}`),
    enabled: open && !!orgId && !!projectId,
  });
  const folders = projectDetail ? projectFolderPaths(projectDetail.items) : [];

  const add = useMutation({
    mutationFn: () => {
      const path = folder.trim() || undefined;
      const body =
        target.kind === "skill"
          ? { kind: "skill", skillId: target.skillId, path, label: target.label, note: target.note }
          : {
              kind: "external",
              externalUrl: target.externalUrl,
              externalName: target.externalName,
              path,
              note: target.note,
            };
      return api<{ id: string }>(`/v1/orgs/${orgId}/projects/${projectId}/items`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects", orgId] });
      queryClient.invalidateQueries({ queryKey: ["project", orgId, projectId] });
      setAdded(writableProjects?.find((p) => p.id === projectId)?.name ?? "project");
      setError(null);
      setFolder("");
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Could not add to project");
      setAdded(null);
    },
  });

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setError(null);
          setAdded(null);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={variant}
          size={iconOnly ? undefined : size}
          className={iconOnly ? "size-9 p-0" : "gap-1"}
          aria-label="Add to project"
        >
          <FolderPlus className="size-4" aria-hidden />
          {iconOnly ? <span className="sr-only">Add to project</span> : "Project"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        {orgs && orgs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Create an organization first.</p>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (projectId) add.mutate();
            }}
          >
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Add to project
            </p>

            {orgs && orgs.length > 1 && (
              <div className="space-y-1">
                <Label htmlFor="atp-org">Organization</Label>
                <NativeSelect
                  id="atp-org"
                  className="w-full"
                  value={orgId}
                  onChange={(e) => {
                    setSelectedOrgId(e.target.value);
                    setSelectedProjectId("");
                    setAdded(null);
                  }}
                >
                  {orgs.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            )}

            {writableProjects && writableProjects.length > 0 ? (
              <>
                <div className="space-y-1">
                  <Label htmlFor="atp-project">Project</Label>
                  <NativeSelect
                    id="atp-project"
                    className="w-full"
                    value={projectId}
                    onChange={(e) => {
                      setSelectedProjectId(e.target.value);
                      setAdded(null);
                    }}
                  >
                    {writableProjects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="atp-folder">Folder (optional)</Label>
                  <FolderInput
                    id="atp-folder"
                    folders={folders}
                    placeholder="e.g. backend/review"
                    value={folder}
                    onChange={(e) => setFolder(e.target.value)}
                  />
                </div>

                {error && <p className="text-sm text-destructive">{error}</p>}
                {added && (
                  <p className="flex items-center gap-1.5 text-sm text-foreground">
                    <Check className="size-3.5" aria-hidden />
                    Added to {added}
                  </p>
                )}

                <Button type="submit" size="sm" className="w-full" disabled={add.isPending}>
                  {add.isPending ? "Adding…" : "Add"}
                </Button>
              </>
            ) : writableProjects ? (
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  {projects && projects.length > 0
                    ? "No projects you can curate into here."
                    : "No projects in this organization yet."}
                </p>
                <Button asChild variant="outline" size="sm" className="w-full">
                  <Link
                    to="/orgs/$orgId/projects"
                    params={{ orgId }}
                    onClick={() => setOpen(false)}
                  >
                    New project
                  </Link>
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Loading projects…</p>
            )}
          </form>
        )}
      </PopoverContent>
    </Popover>
  );
}
