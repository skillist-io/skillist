import { formatCount, useSession } from "@skillist/ui";
import { Star } from "lucide-react";
import { StarButton } from "@/components/registry-star-button";

type StarStatProps = {
  org: string;
  repo: string;
  stars: number;
  starred?: boolean;
  withIcon?: boolean;
};

/**
 * Stars as an interactive toggle when signed in, and a static readout
 * otherwise, so signed-out visitors never hit an action that 401s with no
 * feedback.
 */
export function StarStat({ org, repo, stars, starred, withIcon = false }: StarStatProps) {
  const { data: session } = useSession();
  if (session?.user) {
    return <StarButton org={org} repo={repo} stars={stars} starred={starred} />;
  }
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground tabular-nums">
      {withIcon && <Star className="size-4" aria-hidden />}
      {formatCount(stars)}
      <span className="sr-only"> stars</span>
    </span>
  );
}
