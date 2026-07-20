import {
  api,
  Badge,
  Button,
  ConfirmDialog,
  cn,
  Input,
  Label,
  NativeSelect,
  type Org,
  type OrgMember,
  PageTitle,
  type ProjectDetail,
  type ProjectItem,
  type ProjectMember,
  type ProjectRole,
  type ProjectVisibility,
  QueryError,
  SectionTitle,
  Skeleton,
  Textarea,
  webUrl,
} from "@skillist/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ExternalLink, FileText, Folder, Lock, Pencil, Plus, Trash2, Users, X } from "lucide-react";
import { useState } from "react";
import { FolderInput } from "@/components/folder-input";
import {
  ProjectVisibilityBadge,
  VISIBILITY_HELP,
  VISIBILITY_LABEL,
} from "@/components/project-visibility";
import type { TreeNode } from "@/components/skill-editor/paths";
import { useSyncActiveOrgFromParam } from "@/lib/active-org";
import { buildProjectTree, projectFolderPaths, projectItemLeafName } from "@/lib/project-tree";
import { requireAuth } from "@/lib/require-auth";

const ROLES: ProjectRole[] = ["viewer", "editor", "admin"];

// Invisible hit-area expansion so dense icon buttons keep their compact look
// while offering a comfortable touch target.
const iconHitArea = "relative after:absolute after:-inset-1 after:content-['']";

export const Route = createFileRoute("/orgs/$orgId/projects/$projectId")({
  beforeLoad: () => requireAuth(),
  component: ProjectDetailPage,
});

/** Uppercase micro-label heading for the settings rail sections. */
function RailLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
      {children}
    </h2>
  );
}

function ProjectDetailPage() {
  const { orgId, projectId } = Route.useParams();
  useSyncActiveOrgFromParam(orgId);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [addingExternal, setAddingExternal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: orgs } = useQuery({
    queryKey: ["orgs"],
    queryFn: () => api<Org[]>("/v1/orgs"),
  });

  const {
    data: project,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["project", orgId, projectId],
    queryFn: () => api<ProjectDetail>(`/v1/orgs/${orgId}/projects/${projectId}`),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["project", orgId, projectId] });
    queryClient.invalidateQueries({ queryKey: ["projects", orgId] });
  };

  const updateProject = useMutation({
    mutationFn: (body: { name?: string; description?: string; visibility?: ProjectVisibility }) =>
      api(`/v1/orgs/${orgId}/projects/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      invalidate();
      setEditing(false);
    },
  });

  const setVisibility = useMutation({
    mutationFn: (visibility: ProjectVisibility) =>
      api(`/v1/orgs/${orgId}/projects/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify({ visibility }),
      }),
    onSuccess: invalidate,
  });

  const deleteProject = useMutation({
    mutationFn: () =>
      api<{ ok: true }>(`/v1/orgs/${orgId}/projects/${projectId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects", orgId] });
      navigate({ to: "/orgs/$orgId/projects", params: { orgId } });
    },
  });

  const moveItem = useMutation({
    mutationFn: ({ itemId, path }: { itemId: string; path: string }) =>
      api(`/v1/orgs/${orgId}/projects/${projectId}/items/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify({ path }),
      }),
    onSuccess: invalidate,
  });

  const removeItem = useMutation({
    mutationFn: (itemId: string) =>
      api<{ ok: true }>(`/v1/orgs/${orgId}/projects/${projectId}/items/${itemId}`, {
        method: "DELETE",
      }),
    onSuccess: invalidate,
  });

  if (isError) {
    return <QueryError title="Could not load this project" onRetry={() => void refetch()} />;
  }

  if (isLoading || !project) {
    return <ProjectSkeleton />;
  }

  const tree = buildProjectTree(project.items);
  const folders = projectFolderPaths(project.items);
  const canWrite = project.canWrite;
  const canManage = project.canManage;
  const itemCount = project.items.length;

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <PageTitle>{project.name}</PageTitle>
              <ProjectVisibilityBadge visibility={project.visibility} />
            </div>
            <p className="font-mono text-sm text-muted-foreground">
              {project.slug} · {itemCount} item{itemCount === 1 ? "" : "s"}
            </p>
            {project.description && !editing && (
              <p className="max-w-prose text-sm text-muted-foreground text-pretty">
                {project.description}
              </p>
            )}
          </div>
          {canWrite && (
            <Button
              variant="outline"
              size="sm"
              aria-expanded={editing}
              onClick={() => setEditing((v) => !v)}
            >
              {editing ? (
                <>
                  <X data-icon="inline-start" aria-hidden />
                  Close editor
                </>
              ) : (
                <>
                  <Pencil data-icon="inline-start" aria-hidden />
                  Edit details
                </>
              )}
            </Button>
          )}
        </div>
        {editing && canWrite && (
          <EditProjectForm
            project={project}
            onSave={(body) => updateProject.mutate(body)}
            isSaving={updateProject.isPending}
          />
        )}
      </header>

      <div className="flex flex-col gap-8 lg:flex-row lg:gap-8">
        <section className="min-w-0 flex-1 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <SectionTitle>Curated items</SectionTitle>
              <p className="max-w-prose text-sm text-muted-foreground text-pretty">
                Skills and external links, grouped into folders. Move an item to re-file it, or
                remove it to unpin.
              </p>
            </div>
            {canWrite && (
              <Button
                variant="outline"
                size="sm"
                aria-expanded={addingExternal}
                onClick={() => setAddingExternal((v) => !v)}
              >
                {addingExternal ? (
                  <>
                    <X data-icon="inline-start" aria-hidden />
                    Close
                  </>
                ) : (
                  <>
                    <Plus data-icon="inline-start" aria-hidden />
                    Add external link
                  </>
                )}
              </Button>
            )}
          </div>

          {canWrite && addingExternal && (
            <AddExternalForm
              orgId={orgId}
              projectId={projectId}
              folders={folders}
              onAdded={() => {
                invalidate();
                setAddingExternal(false);
              }}
            />
          )}

          {tree.nodes.length ? (
            <div className="border-t border-border">
              <ManagedTreeNodes
                nodes={tree.nodes}
                itemByPath={tree.itemByPath}
                orgs={orgs ?? []}
                folders={folders}
                depth={0}
                canWrite={canWrite}
                onMove={(itemId, path) => moveItem.mutate({ itemId, path })}
                onRemove={(itemId) => removeItem.mutate(itemId)}
                isMutating={moveItem.isPending || removeItem.isPending}
              />
            </div>
          ) : (
            <EmptyItems canWrite={canWrite} onAddExternal={() => setAddingExternal(true)} />
          )}
        </section>

        <aside className="space-y-8 lg:w-80 lg:shrink-0 lg:border-l lg:border-border lg:pl-8">
          {canManage && (
            <VisibilitySection
              visibility={project.visibility}
              onChange={(v) => setVisibility.mutate(v)}
              isSaving={setVisibility.isPending}
            />
          )}

          <MembersSection orgId={orgId} projectId={projectId} canManage={canManage} />

          {canManage && (
            <section className="space-y-3">
              <RailLabel>Danger zone</RailLabel>
              <p className="text-sm text-muted-foreground text-pretty">
                Delete this project. Curated items are unpinned, not deleted.
              </p>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setConfirmDelete(true)}
                disabled={deleteProject.isPending}
              >
                <Trash2 data-icon="inline-start" aria-hidden />
                Delete project
              </Button>
              <ConfirmDialog
                open={confirmDelete}
                onOpenChange={setConfirmDelete}
                title="Delete project"
                description="This removes the project and its curation. The curated skills and links are unpinned, not deleted."
                confirmLabel="Delete project"
                destructive
                isPending={deleteProject.isPending}
                onConfirm={() => deleteProject.mutate()}
              />
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function ProjectSkeleton() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="flex flex-col gap-8 lg:flex-row lg:gap-8">
        <div className="min-w-0 flex-1 space-y-4">
          <Skeleton className="h-6 w-40" />
          <div className="space-y-px border-t border-border pt-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </div>
        <div className="space-y-6 lg:w-80 lg:shrink-0">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    </div>
  );
}

function EmptyItems({ canWrite, onAddExternal }: { canWrite: boolean; onAddExternal: () => void }) {
  return (
    <div className="border border-dashed border-border p-8 text-center">
      <Folder className="mx-auto size-6 text-muted-foreground" aria-hidden />
      <p className="mt-3 text-sm font-medium text-foreground">No curated items yet</p>
      {canWrite ? (
        <>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground text-pretty">
            Add an external link below, or use Add to project from the registry, inventory, or a
            skill workspace to pin skills here.
          </p>
          <Button variant="outline" size="sm" className="mt-4" onClick={onAddExternal}>
            <Plus data-icon="inline-start" aria-hidden />
            Add external link
          </Button>
        </>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">Nothing has been curated here yet.</p>
      )}
    </div>
  );
}

function EditProjectForm({
  project,
  onSave,
  isSaving,
}: {
  project: ProjectDetail;
  onSave: (body: { name: string; description: string }) => void;
  isSaving: boolean;
}) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  return (
    <form
      className="flex max-w-xl flex-col gap-4 border-t border-border pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ name: name.trim(), description: description.trim() });
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="proj-name">Name</Label>
        <Input id="proj-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="proj-desc">Description</Label>
        <Textarea
          id="proj-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
        />
      </div>
      <Button type="submit" size="sm" className="self-start" disabled={!name.trim() || isSaving}>
        {isSaving ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}

function AddExternalForm({
  orgId,
  projectId,
  folders,
  onAdded,
}: {
  orgId: string;
  projectId: string;
  folders: string[];
  onAdded: () => void;
}) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const [error, setError] = useState<string | null>(null);

  const addExternal = useMutation({
    mutationFn: () =>
      api<{ id: string }>(`/v1/orgs/${orgId}/projects/${projectId}/items`, {
        method: "POST",
        body: JSON.stringify({
          kind: "external",
          externalUrl: url.trim(),
          externalName: name.trim() || undefined,
          path: folder.trim() || undefined,
        }),
      }),
    onSuccess: () => {
      onAdded();
      setUrl("");
      setName("");
      setFolder("");
      setError(null);
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Could not add link"),
  });

  return (
    <form
      className="flex flex-col gap-4 border border-border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (url.trim()) addExternal.mutate();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="ext-url">URL</Label>
          <Input
            id="ext-url"
            type="url"
            className="font-mono text-xs"
            placeholder="https://github.com/org/repo"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ext-name">Name (optional)</Label>
          <Input
            id="ext-name"
            placeholder="Display name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-1 sm:max-w-xs">
        <Label htmlFor="ext-folder">Folder (optional)</Label>
        <FolderInput
          id="ext-folder"
          folders={folders}
          placeholder="e.g. references"
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
        />
      </div>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button
        type="submit"
        size="sm"
        className="self-start"
        disabled={!url.trim() || addExternal.isPending}
      >
        {addExternal.isPending ? "Adding…" : "Add link"}
      </Button>
    </form>
  );
}

function VisibilitySection({
  visibility,
  onChange,
  isSaving,
}: {
  visibility: ProjectVisibility;
  onChange: (visibility: ProjectVisibility) => void;
  isSaving: boolean;
}) {
  const next: ProjectVisibility = visibility === "private" ? "shared" : "private";
  const NextIcon = next === "private" ? Lock : Users;
  return (
    <section className="space-y-3">
      <RailLabel>Visibility</RailLabel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ProjectVisibilityBadge visibility={visibility} />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange(next)}
          disabled={isSaving}
        >
          <NextIcon data-icon="inline-start" aria-hidden />
          {isSaving ? "Saving…" : `Make ${VISIBILITY_LABEL[next].toLowerCase()}`}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground text-pretty">{VISIBILITY_HELP[visibility]}</p>
    </section>
  );
}

function roleLabel(role: ProjectRole): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function MembersSection({
  orgId,
  projectId,
  canManage,
}: {
  orgId: string;
  projectId: string;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const [rowError, setRowError] = useState<{ userId: string; message: string } | null>(null);

  const {
    data: members,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["project-members", orgId, projectId],
    queryFn: () => api<ProjectMember[]>(`/v1/orgs/${orgId}/projects/${projectId}/members`),
  });

  const invalidateMembers = () =>
    queryClient.invalidateQueries({ queryKey: ["project-members", orgId, projectId] });

  const updateRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: ProjectRole }) =>
      api(`/v1/orgs/${orgId}/projects/${projectId}/members/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      }),
    onSuccess: () => {
      setRowError(null);
      invalidateMembers();
    },
    onError: (err, vars) =>
      setRowError({
        userId: vars.userId,
        message: err instanceof Error ? err.message : "Could not change role",
      }),
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) =>
      api<{ ok: true }>(`/v1/orgs/${orgId}/projects/${projectId}/members/${userId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      setRowError(null);
      invalidateMembers();
    },
    onError: (err, userId) =>
      setRowError({
        userId,
        message: err instanceof Error ? err.message : "Could not remove member",
      }),
  });

  if (isError) {
    return (
      <section className="space-y-3">
        <RailLabel>Members</RailLabel>
        <QueryError title="Could not load members" onRetry={() => void refetch()} />
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <RailLabel>Members</RailLabel>
      <p className="text-sm text-muted-foreground text-pretty">
        {canManage
          ? "People with access, and their role. Admins can manage visibility, members, and deletion."
          : "People with access to this project, and their role."}
      </p>

      {canManage && members && (
        <AddMemberForm
          orgId={orgId}
          projectId={projectId}
          existing={members}
          onAdded={invalidateMembers}
        />
      )}

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : members && members.length > 0 ? (
        <ul className="border-t border-border">
          {members.map((member) => {
            const busy =
              (updateRole.isPending && updateRole.variables?.userId === member.userId) ||
              (removeMember.isPending && removeMember.variables === member.userId);
            return (
              <li key={member.userId} className="flex flex-col gap-2 border-b border-border py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{member.name}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">{member.email}</p>
                  {rowError?.userId === member.userId && (
                    <p className="text-xs text-destructive" role="alert">
                      {rowError.message}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {canManage ? (
                    <>
                      <NativeSelect
                        aria-label={`Role for ${member.name}`}
                        className="h-9 w-28"
                        value={member.role}
                        disabled={busy}
                        onChange={(e) =>
                          updateRole.mutate({
                            userId: member.userId,
                            role: e.target.value as ProjectRole,
                          })
                        }
                      >
                        {ROLES.map((role) => (
                          <option key={role} value={role}>
                            {roleLabel(role)}
                          </option>
                        ))}
                      </NativeSelect>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        className={iconHitArea}
                        aria-label={`Remove ${member.name}`}
                        disabled={busy}
                        onClick={() => removeMember.mutate(member.userId)}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </Button>
                    </>
                  ) : (
                    <Badge variant="outline">{roleLabel(member.role)}</Badge>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No members yet.</p>
      )}
    </section>
  );
}

function AddMemberForm({
  orgId,
  projectId,
  existing,
  onAdded,
}: {
  orgId: string;
  projectId: string;
  existing: ProjectMember[];
  onAdded: () => void;
}) {
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<ProjectRole>("viewer");
  const [error, setError] = useState<string | null>(null);

  const { data: orgMembers } = useQuery({
    queryKey: ["org-members", orgId],
    queryFn: () => api<OrgMember[]>(`/v1/orgs/${orgId}/members`),
  });

  const existingIds = new Set(existing.map((m) => m.userId));
  const eligible = (orgMembers ?? []).filter((m) => !existingIds.has(m.userId));
  const selectedId = userId || eligible[0]?.userId || "";

  const addMember = useMutation({
    mutationFn: () =>
      api<ProjectMember>(`/v1/orgs/${orgId}/projects/${projectId}/members`, {
        method: "POST",
        body: JSON.stringify({ userId: selectedId, role }),
      }),
    onSuccess: () => {
      onAdded();
      setUserId("");
      setRole("viewer");
      setError(null);
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Could not add member"),
  });

  if (orgMembers && eligible.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Everyone in this organization is already a member.
      </p>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (selectedId) addMember.mutate();
      }}
    >
      <div className="min-w-0 space-y-1">
        <Label htmlFor="add-member-user">Add member</Label>
        <NativeSelect
          id="add-member-user"
          className="w-full"
          value={selectedId}
          onChange={(e) => setUserId(e.target.value)}
          disabled={!eligible.length}
        >
          {eligible.length ? (
            eligible.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name} · {m.email}
              </option>
            ))
          ) : (
            <option value="">Loading…</option>
          )}
        </NativeSelect>
      </div>
      <div className="flex items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="add-member-role">Role</Label>
          <NativeSelect
            id="add-member-role"
            className="w-28"
            value={role}
            onChange={(e) => setRole(e.target.value as ProjectRole)}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" size="sm" disabled={!selectedId || addMember.isPending}>
          {addMember.isPending ? "Adding…" : "Add member"}
        </Button>
      </div>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function ManagedTreeNodes({
  nodes,
  itemByPath,
  orgs,
  folders,
  depth,
  canWrite,
  onMove,
  onRemove,
  isMutating,
}: {
  nodes: TreeNode[];
  itemByPath: Map<string, ProjectItem>;
  orgs: Org[];
  folders: string[];
  depth: number;
  canWrite: boolean;
  onMove: (itemId: string, path: string) => void;
  onRemove: (itemId: string) => void;
  isMutating: boolean;
}) {
  return (
    <>
      {nodes.map((node) =>
        node.children ? (
          <div key={node.path}>
            <div
              className="flex items-center gap-1.5 border-b border-border py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
              style={{ paddingLeft: `${depth * 16}px` }}
            >
              <Folder className="size-3.5" aria-hidden />
              {node.name}/
            </div>
            <ManagedTreeNodes
              nodes={node.children}
              itemByPath={itemByPath}
              orgs={orgs}
              folders={folders}
              depth={depth + 1}
              canWrite={canWrite}
              onMove={onMove}
              onRemove={onRemove}
              isMutating={isMutating}
            />
          </div>
        ) : (
          <ManagedLeaf
            key={node.path}
            item={itemByPath.get(node.path)}
            orgs={orgs}
            folders={folders}
            depth={depth}
            canWrite={canWrite}
            onMove={onMove}
            onRemove={onRemove}
            isMutating={isMutating}
          />
        ),
      )}
    </>
  );
}

function ManagedLeaf({
  item,
  orgs,
  folders,
  depth,
  canWrite,
  onMove,
  onRemove,
  isMutating,
}: {
  item: ProjectItem | undefined;
  orgs: Org[];
  folders: string[];
  depth: number;
  canWrite: boolean;
  onMove: (itemId: string, path: string) => void;
  onRemove: (itemId: string) => void;
  isMutating: boolean;
}) {
  const [moving, setMoving] = useState(false);
  const [folder, setFolder] = useState(item?.path ?? "");
  if (!item) return null;

  const label = projectItemLeafName(item);

  return (
    <div
      className="flex flex-col gap-2 border-b border-border py-3 sm:flex-row sm:items-center sm:justify-between"
      style={{ paddingLeft: `${depth * 16}px` }}
    >
      <div className="flex min-w-0 items-start gap-2">
        {item.kind === "external" ? (
          <ExternalLink className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <ItemLink item={item} orgs={orgs} label={label} />
            {item.kind === "skill" && <Badge variant="outline">{item.visibility}</Badge>}
          </div>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {item.kind === "skill" ? `${item.orgSlug}/${item.repo}` : item.externalUrl}
          </p>
          {item.note && <p className="text-xs text-muted-foreground text-pretty">{item.note}</p>}
        </div>
      </div>

      {canWrite && (
        <div className="flex shrink-0 items-center gap-2">
          {moving ? (
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                onMove(item.id, folder.trim());
                setMoving(false);
              }}
            >
              <FolderInput
                // Focus the folder field as soon as it mounts.
                ref={(el) => {
                  if (el) requestAnimationFrame(() => el.focus());
                }}
                folders={folders}
                className="h-9 w-44"
                placeholder="folder path"
                aria-label={`New folder for ${label}`}
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setMoving(false);
                }}
              />
              <Button type="submit" size="sm" disabled={isMutating}>
                Save
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setMoving(false)}>
                Cancel
              </Button>
            </form>
          ) : (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setFolder(item.path);
                  setMoving(true);
                }}
              >
                Move
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className={iconHitArea}
                aria-label={`Remove ${label}`}
                onClick={() => onRemove(item.id)}
                disabled={isMutating}
              >
                <Trash2 className="size-3.5" aria-hidden />
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ItemLink({ item, orgs, label }: { item: ProjectItem; orgs: Org[]; label: string }) {
  const linkClass =
    "rounded-none font-medium hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none";

  if (item.kind === "external") {
    return (
      <a href={item.externalUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
        {label}
        <span className="sr-only"> (external link, opens in new tab)</span>
      </a>
    );
  }
  if (item.visibility === "public") {
    return (
      <a href={webUrl(`/${item.orgSlug}/${item.repo}`)} className={linkClass}>
        {label}
      </a>
    );
  }
  const ownerOrgId = orgs.find((o) => o.slug === item.orgSlug)?.id;
  if (!ownerOrgId) {
    return <span className={cn(linkClass, "cursor-default hover:no-underline")}>{label}</span>;
  }
  return (
    <Link
      to="/orgs/$orgId/skills/$repo"
      params={{ orgId: ownerOrgId, repo: item.repo }}
      className={linkClass}
    >
      {label}
    </Link>
  );
}
