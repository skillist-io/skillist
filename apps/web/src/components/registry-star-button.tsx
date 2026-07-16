import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

type StarButtonProps = {
  org: string;
  repo: string;
  stars: number;
  starred?: boolean;
  size?: "sm" | "default";
};

export function StarButton({ org, repo, stars, starred = false, size = "sm" }: StarButtonProps) {
  const queryClient = useQueryClient();

  const toggle = useMutation({
    mutationFn: async () => {
      if (starred) {
        await api(`/v1/registry/${org}/${repo}/star`, { method: "DELETE" });
      } else {
        await api(`/v1/registry/${org}/${repo}/star`, { method: "POST" });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["registry"] });
      queryClient.invalidateQueries({ queryKey: ["registry", org, repo] });
    },
  });

  return (
    <Button
      type="button"
      variant={starred ? "default" : "outline"}
      size={size}
      className="gap-1"
      onClick={() => toggle.mutate()}
      disabled={toggle.isPending}
    >
      <Star className={`h-4 w-4 ${starred ? "fill-current" : ""}`} />
      {stars}
    </Button>
  );
}
