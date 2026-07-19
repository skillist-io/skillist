import { api, type ProjectDetail } from "@skillist/ui";
import { useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";

export type Crumb = { label: string; href?: string; current?: boolean };

/**
 * The trail for the current route. Lives here rather than in <AppShell> because
 * it is also how the agent learns where the user is — one derivation, so the
 * breadcrumb and the agent's idea of "this page" can never disagree.
 */
export function useBreadcrumbs(): Crumb[] {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const segments = pathname.split("/").filter(Boolean);

  // On a project detail route the third segment is a UUID, so resolve the real
  // name from the same query key the detail page uses (dedupes, no extra fetch).
  const onProjectDetail =
    segments[0] === "orgs" && segments[2] === "projects" && segments.length >= 4;
  const orgId = segments[1];
  const projectId = segments[3];
  const { data: project } = useQuery({
    queryKey: ["project", orgId, projectId],
    queryFn: () => api<ProjectDetail>(`/v1/orgs/${orgId}/projects/${projectId}`),
    enabled: onProjectDetail,
  });

  if (segments[0] === "dashboard") {
    return [{ label: "Dashboard", href: "/dashboard", current: true }];
  }

  if (segments[0] === "agent") {
    return [{ label: "Agent", href: "/agent", current: true }];
  }

  if (segments[0] === "account") {
    return [{ label: "Account", href: "/account", current: true }];
  }

  if (segments[0] === "settings") {
    return [{ label: "Settings", href: "/settings", current: true }];
  }

  if (segments[0] === "inventory") {
    return [{ label: "Inventory", href: "/inventory", current: true }];
  }

  if (segments[0] === "observability") {
    return [{ label: "Observability", href: "/observability", current: true }];
  }

  if (segments[0] === "coverage") {
    return [{ label: "Coverage", href: "/coverage", current: true }];
  }

  if (segments[0] === "admin" && segments[1] === "mirrors") {
    return [{ label: "Official mirrors", href: "/admin/mirrors", current: true }];
  }

  if (segments[0] === "governance") {
    return [{ label: "Governance", href: "/governance", current: true }];
  }

  if (segments[0] === "orgs") {
    if (segments[2] === "skills" && segments.length >= 4) {
      return [
        { label: "Dashboard", href: "/dashboard" },
        { label: segments[3] ?? "Skill", current: true },
      ];
    }
    if (segments[2] === "projects") {
      if (segments.length >= 4) {
        return [
          { label: "Dashboard", href: "/dashboard" },
          { label: "Projects", href: `/orgs/${orgId}/projects` },
          { label: project?.name ?? "Project", current: true },
        ];
      }
      return [
        { label: "Dashboard", href: "/dashboard" },
        { label: "Projects", current: true },
      ];
    }
  }

  return [{ label: "Skillist", href: "/dashboard", current: true }];
}
