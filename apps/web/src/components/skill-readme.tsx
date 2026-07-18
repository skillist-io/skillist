import { parseSkillMd } from "@skillist/skill-format";
import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { FrontmatterCard } from "@/components/skill-editor/frontmatter-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";

const MarkdownView = lazy(() => import("@/components/skill-editor/markdown-view"));

export type PublicBundle = { files: Record<string, string>; version: string };

export function usePublicBundle(org: string, repo: string, etag?: string) {
  return useQuery({
    queryKey: ["public-bundle", org, repo, etag],
    queryFn: () => api<PublicBundle>(`/${org}/${repo}/bundle`),
    retry: false,
  });
}

export default function SkillReadme({
  org,
  repo,
  etag,
  onOpenFile,
}: {
  org: string;
  repo: string;
  etag?: string;
  onOpenFile?: (path: string) => void;
}) {
  const { data, isError } = usePublicBundle(org, repo, etag);
  // Unpublished or delivery-miss: the page simply keeps its existing summary.
  if (isError || !data?.files["SKILL.md"]) return null;

  const parsed = parseSkillMd(data.files["SKILL.md"]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>SKILL.md</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {parsed && <FrontmatterCard frontmatter={parsed.frontmatter} />}
        <Suspense fallback={<Skeleton className="h-40 w-full rounded-none" />}>
          <MarkdownView
            markdown={parsed ? parsed.body : data.files["SKILL.md"]}
            files={data.files}
            onOpenFile={onOpenFile}
          />
        </Suspense>
      </CardContent>
    </Card>
  );
}
