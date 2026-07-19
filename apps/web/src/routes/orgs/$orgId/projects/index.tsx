import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { FolderOpen, Plus } from "lucide-react";
import { NewProjectDialog } from "@/components/new-project-dialog";
import { ProjectVisibilityBadge } from "@/components/project-visibility";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageTitle } from "@/components/ui/page-title";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Org, type Project } from "@/lib/api";
import { requireAuth } from "@/lib/require-auth";

export const Route = createFileRoute("/orgs/$orgId/projects/")({
  beforeLoad: () => requireAuth(),
  component: ProjectsIndexPage,
});

function ProjectsIndexPage() {
  const { orgId } = Route.useParams();

  const { data: orgs } = useQuery({
    queryKey: ["orgs"],
    queryFn: () => api<Org[]>("/v1/orgs"),
  });
  const org = orgs?.find((o) => o.id === orgId);

  const {
    data: projects,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["projects", orgId],
    queryFn: () => api<Project[]>(`/v1/orgs/${orgId}/projects`),
  });

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <PageTitle>Projects</PageTitle>
          <p className="text-muted-foreground">
            Curated collections of skills and links{org ? ` for ${org.name}` : ""}.
          </p>
        </div>
        <NewProjectDialog
          orgId={orgId}
          trigger={
            <Button size="sm">
              <Plus data-icon="inline-start" aria-hidden />
              New project
            </Button>
          }
        />
      </div>

      {isError ? (
        <QueryError title="Could not load projects" onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-3 border border-border p-6">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-4 w-full" />
            </div>
          ))}
        </div>
      ) : projects && projects.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {projects.map((project) => (
            <Card key={project.id} className="flex flex-col">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FolderOpen className="size-4 text-muted-foreground" aria-hidden />
                  <Link
                    to="/orgs/$orgId/projects/$projectId"
                    params={{ orgId, projectId: project.id }}
                    className="rounded-none hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
                  >
                    {project.name}
                  </Link>
                </CardTitle>
                <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs">
                  <span>
                    {project.slug} · {project.itemCount} item{project.itemCount === 1 ? "" : "s"}
                  </span>
                  <ProjectVisibilityBadge visibility={project.visibility} />
                </CardDescription>
              </CardHeader>
              {project.description && (
                <CardContent>
                  <p className="text-sm text-muted-foreground text-pretty">{project.description}</p>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No projects yet. Use “New project” to create one, then curate it with “Add to project”
          from the registry, inventory, or a skill workspace.
        </p>
      )}
    </div>
  );
}
