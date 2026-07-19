import { api, Label, NativeSelect, type Org, PageTitle } from "@skillist/ui";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
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
    <div className="mx-auto w-full max-w-6xl space-y-8">
      <div>
        <PageTitle>Governance</PageTitle>
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
              <NativeSelect
                className="mt-1 w-full max-w-md"
                value={activeOrgId}
                onChange={(e) => setSelectedOrgId(e.target.value)}
              >
                {ownerOrgs.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name} ({org.slug})
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
          {activeOrgId && <GovernancePanel orgId={activeOrgId} />}
        </>
      )}
    </div>
  );
}
