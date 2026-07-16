import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Label } from "@/components/ui/label";
import { api, type Org } from "@/lib/api";
import { requireAuth } from "@/lib/require-auth";
import { GovernancePanel } from "@/routes/settings";

export const Route = createFileRoute("/governance")({
  beforeLoad: () => requireAuth(),
  component: GovernancePage,
});

function GovernancePage() {
  const { data: orgs } = useQuery({
    queryKey: ["orgs"],
    queryFn: () => api<Org[]>("/v1/orgs"),
  });
  const ownerOrgs = orgs?.filter((o) => o.role === "owner" || o.role === "admin") ?? [];
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const activeOrgId = selectedOrgId || ownerOrgs[0]?.id || "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Governance</h1>
        <p className="text-muted-foreground">
          Publish policies, execution quotas, required skills, and audit logs
        </p>
      </div>

      {ownerOrgs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Create an organization on the{" "}
          <Link to="/dashboard" className="text-primary underline">
            dashboard
          </Link>{" "}
          to manage governance.
        </p>
      ) : (
        <>
          {ownerOrgs.length > 1 && (
            <div>
              <Label>Organization</Label>
              <select
                className="mt-1 w-full max-w-md rounded-md border bg-background px-3 py-2 text-sm"
                value={activeOrgId}
                onChange={(e) => setSelectedOrgId(e.target.value)}
              >
                {ownerOrgs.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name} ({org.slug})
                  </option>
                ))}
              </select>
            </div>
          )}
          {activeOrgId && <GovernancePanel orgId={activeOrgId} />}
        </>
      )}
    </div>
  );
}
