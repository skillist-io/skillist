const API_URL = import.meta.env.VITE_API_URL ?? "";

export async function api<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? "Request failed");
  }
  if (res.headers.get("content-type")?.includes("application/json")) {
    return res.json() as Promise<T>;
  }
  return res.text() as Promise<T>;
}

export type RegistryItem = {
  orgSlug: string;
  skillSlug: string;
  name: string;
  description: string;
  latestVersion: string | null;
  stars: number;
};

export type Org = {
  id: string;
  name: string;
  slug: string;
  role: string;
};

export type Skill = {
  id: string;
  slug: string;
  visibility: string;
  description: string | null;
};

export type SkillVersion = {
  id: string;
  skillId: string;
  status: string;
  semver: string;
  publishedAt: string | null;
  createdAt: string;
};

export type Feedback = {
  id: string;
  skillId: string;
  targetVersionId: string;
  source: string;
  body: string;
  suggestedPatch: string | null;
  status: string;
  createdAt: string;
};
