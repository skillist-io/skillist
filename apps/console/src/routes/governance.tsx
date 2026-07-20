import { PageTitle } from "@skillist/ui";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useActiveOrg } from "@/lib/active-org";
import { requireAuth } from "@/lib/require-auth";
import { GovernancePanel } from "@/routes/settings";

export const Route = createFileRoute("/governance")({
  beforeLoad: () => requireAuth(),
  component: GovernancePage,
});

// Governance is manageable by owners and admins (the previous owner+admin
// filter semantics, now enforced as a per-org gate rather than by hiding orgs).
function canManageGovernance(role: string): boolean {
  return role === "owner" || role === "admin";
}

function GovernancePage() {
  const { activeOrg } = useActiveOrg();

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8">
      <div>
        <PageTitle>Governance</PageTitle>
        <p className="text-muted-foreground">
          Publish policies, execution quotas, required skills, and audit logs
        </p>
      </div>

      {!activeOrg ? (
        <p className="text-sm text-muted-foreground">
          Create an organization on the{" "}
          <Link to="/dashboard" className="text-primary underline">
            dashboard
          </Link>{" "}
          to manage governance.
        </p>
      ) : canManageGovernance(activeOrg.role) ? (
        <GovernancePanel orgId={activeOrg.id} />
      ) : (
        // Permission state (not an error) — the global switcher lists every org,
        // so surface the gate here instead of switching to a different org.
        <div className="border border-border p-6">
          <h2 className="text-sm font-semibold text-foreground">Owner or admin access required</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Managing governance for {activeOrg.name} needs an owner or admin role. You have the{" "}
            {activeOrg.role} role.
          </p>
        </div>
      )}
    </div>
  );
}
