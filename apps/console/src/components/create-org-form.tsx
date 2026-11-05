import { api, Button, Input, Label, type Org } from "@skillist/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

/** Creating an org is rare, so this lives behind the switcher, not on a page. */
export function CreateOrgForm({ onCreated }: { onCreated?: (org: Org) => void }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const queryClient = useQueryClient();

  const createOrg = useMutation({
    meta: { failure: "Could not create the organization" },
    mutationFn: () =>
      api<Org>("/v1/orgs", {
        method: "POST",
        body: JSON.stringify({ name, slug }),
      }),
    onSuccess: async (org) => {
      await queryClient.invalidateQueries({ queryKey: ["orgs"] });
      setName("");
      setSlug("");
      onCreated?.(org);
    },
  });

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        createOrg.mutate();
      }}
    >
      <div className="min-w-40 flex-1 space-y-1.5">
        <Label htmlFor="org-name">Name</Label>
        <Input
          id="org-name"
          placeholder="Acme Inc"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="min-w-40 flex-1 space-y-1.5">
        <Label htmlFor="org-slug">Slug</Label>
        <Input
          id="org-slug"
          placeholder="acme"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={!name || !slug || createOrg.isPending}>
        {createOrg.isPending ? "Creating…" : "Create organization"}
      </Button>
    </form>
  );
}
