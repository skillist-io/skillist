import { isBinaryAssetPath } from "@skillist/skill-format";
import {
  type InvalidSkill,
  type ListedSkill,
  parseSkill,
  type Skill,
  type SkillName,
  SkillParseError,
  type SkillResourceInfo,
  type SkillResourceKind,
  SkillResourceNotFoundError,
  type SkillResourcePath,
  type SkillSource,
  SkillSourceError,
} from "agents/skills";

/**
 * A Cloudflare Agents `SkillSource` backed by Skillist's public delivery API.
 *
 *   getSkills() { return [this.skills]; }
 *   skills = skillist({ skills: ["acme/release-notes", "acme/pdf-tools@1.2.0"] });
 *
 * Think calls `list()` before every turn. Each call revalidates every unpinned
 * ref with `If-None-Match` against `GET /{org}/{repo}/bundle`, whose ETag is
 * the published version id. Unchanged skills cost one KV read and a 304, and a
 * new publish reaches the agent on its next turn. That only holds while the
 * source object lives across turns: build it once (a class field), not inside
 * `getSkills()`, or every turn downloads every bundle again.
 *
 * Public skills only. Delivery serves nothing else unauthenticated, so a
 * private ref answers 404 here exactly like a missing one.
 */
export type SkillistSourceOptions = {
  /** `org/repo`, optionally pinned as `org/repo@1.2.3`. Order decides duplicate names: first wins. */
  skills: readonly string[];
  /** Delivery origin. Defaults to https://skillist.dev. */
  baseUrl?: string;
  /** Stable id for Think's diagnostics. Defaults to `skillist:<baseUrl host>`. */
  id?: string;
  /** Override for tests or a custom transport. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /**
   * Minimum time between revalidations, in ms. 0 (the default) checks on
   * every `list()`, so a publish shows up on the very next turn.
   */
  refreshIntervalMs?: number;
  /** Where ref problems (404s, outages) are reported. Defaults to `console.warn`. */
  onWarning?: (message: string) => void;
};

export const DEFAULT_BASE_URL = "https://skillist.dev";
const USER_AGENT = "skillist-agents/0.1.0";

type Ref = { ref: string; org: string; repo: string; version?: string };

// Mirrors the delivery route's `{org}/{repo}[@version]` shape loosely. The
// server is the authority on what exists; this only rejects strings that
// couldn't form a delivery URL, so a typo fails at construction, not per turn.
const REF_PATTERN = /^([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*)(?:@([^\s/@]+))?$/;

export function parseSkillRef(ref: string): Ref {
  const match = REF_PATTERN.exec(ref);
  if (!match) throw new TypeError(`Invalid Skillist ref "${ref}": expected org/repo[@version]`);
  const [, org = "", repo = "", version] = match;
  // `@latest` is what an unpinned URL serves, so treat it as unpinned and keep revalidating.
  return version && version !== "latest" ? { ref, org, repo, version } : { ref, org, repo };
}

type Entry = {
  etag: string;
  listed: ListedSkill;
  files: Readonly<Record<string, string>>;
};

type Fetched =
  | { kind: "fresh"; entry: Entry }
  | { kind: "invalid"; invalid: InvalidSkill }
  | { kind: "unchanged" }
  | { kind: "gone" }
  | { kind: "failed"; cause: unknown };

function resourceKind(path: string): SkillResourceKind {
  const root = path.split("/", 1)[0];
  if (root === "scripts") return "script";
  if (root === "references") return "reference";
  if (root === "assets") return "asset";
  return "file";
}

const textEncoder = new TextEncoder();

function base64ByteLength(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * Describe one bundle file. Encoding follows Skillist's own rule, not the
 * SDK's extension table: Skillist bundles carry binary assets as base64 and
 * everything else as UTF-8 text, so the declared encoding always matches the
 * content we hand back.
 */
function describe(path: string, content: string): SkillResourceInfo {
  const binary = isBinaryAssetPath(path);
  return {
    // Bundle paths were validated on publish (relative, no traversal).
    path: path as SkillResourcePath,
    kind: resourceKind(path),
    encoding: binary ? "base64" : "text",
    size: binary ? base64ByteLength(content) : textEncoder.encode(content).byteLength,
  };
}

function isBundle(value: unknown): value is { files: Record<string, string>; version: string } {
  if (typeof value !== "object" || value === null) return false;
  const { files, version } = value as { files?: unknown; version?: unknown };
  if (typeof version !== "string" || typeof files !== "object" || files === null) return false;
  return Object.values(files).every((content) => typeof content === "string");
}

export function skillist(options: SkillistSourceOptions): SkillSource {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const id = options.id ?? `skillist:${new URL(baseUrl).host}`;
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const refreshIntervalMs = options.refreshIntervalMs ?? 0;
  const warn = options.onWarning ?? ((message: string) => console.warn(message));
  const refs = options.skills.map(parseSkillRef);

  const cache = new Map<string, Entry>();
  // Skill name → entry, rebuilt on every list so readResource serves the exact
  // version the model was shown, never one published since.
  let byName = new Map<string, Entry>();
  let lastListing: { skills: ListedSkill[]; invalid: InvalidSkill[] } | null = null;
  let lastListedAt = 0;
  let inFlight: ReturnType<SkillSource["list"]> | null = null;
  // Warn once per ref per state, not on every turn.
  const warned = new Map<string, string>();
  const warnOnce = (ref: string, state: string, message: string) => {
    if (warned.get(ref) === state) return;
    warned.set(ref, state);
    warn(message);
  };

  async function fetchRef(ref: Ref): Promise<Fetched> {
    const cached = cache.get(ref.ref);
    // A pinned version's bundle never changes once we hold it. (Its visibility
    // can, but we only cache what was public when fetched, and a pin is the
    // caller choosing a frozen copy.)
    if (cached && ref.version) return { kind: "unchanged" };

    // `@` stays literal: it's the delivery route's own version separator.
    const repoSegment = ref.version
      ? `${encodeURIComponent(ref.repo)}@${encodeURIComponent(ref.version)}`
      : encodeURIComponent(ref.repo);
    const url = `${baseUrl}/${encodeURIComponent(ref.org)}/${repoSegment}/bundle`;
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    };
    if (cached) headers["If-None-Match"] = cached.etag;

    let response: Response;
    try {
      response = await doFetch(url, { headers });
    } catch (cause) {
      return { kind: "failed", cause };
    }

    if (response.status === 304 && cached) return { kind: "unchanged" };
    // 404 covers missing, private, and retracted alike. All three must stop
    // being served, so drop it rather than fall back to a cached copy.
    if (response.status === 404) return { kind: "gone" };
    if (!response.ok) return { kind: "failed", cause: new Error(`HTTP ${response.status}`) };

    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      return { kind: "failed", cause };
    }
    if (!isBundle(body)) return { kind: "failed", cause: new Error("Malformed bundle response") };

    const location = `${id}/${ref.org}/${ref.repo}/SKILL.md`;
    const markdown = body.files["SKILL.md"];
    if (markdown === undefined) {
      return {
        kind: "invalid",
        invalid: {
          location,
          error: new SkillParseError("missing-frontmatter", "Bundle has no SKILL.md"),
        },
      };
    }
    // Skillist requires name === repo on publish, so the repo is the directory.
    const parsed = parseSkill(markdown, { directory: ref.repo });
    if (!parsed.ok) return { kind: "invalid", invalid: { location, error: parsed.error } };

    const resources = Object.entries(body.files)
      .filter(([path]) => path !== "SKILL.md")
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, content]) => describe(path, content));

    const etag = response.headers.get("ETag");
    const listed: ListedSkill = parsed.warnings.length
      ? { skill: parsed.value, resources, warnings: parsed.warnings }
      : { skill: parsed.value, resources };
    return {
      kind: "fresh",
      // No ETag means we can't revalidate; an empty one never matches, so the
      // next list simply refetches.
      entry: { etag: etag ?? "", listed, files: body.files },
    };
  }

  async function refresh(): ReturnType<SkillSource["list"]> {
    const results = await Promise.all(refs.map(fetchRef));
    const skills: ListedSkill[] = [];
    const invalid: InvalidSkill[] = [];
    const names = new Map<string, Entry>();
    let failures = 0;
    let firstFailure: unknown;

    results.forEach((result, index) => {
      // biome-ignore lint/style/noNonNullAssertion: results is index-aligned with refs
      const ref = refs[index]!;
      switch (result.kind) {
        case "fresh":
          cache.set(ref.ref, result.entry);
          warned.delete(ref.ref);
          break;
        case "unchanged":
          warned.delete(ref.ref);
          break;
        case "gone":
          cache.delete(ref.ref);
          warnOnce(ref.ref, "gone", `[${id}] ${ref.ref} is not a published public skill; skipping`);
          break;
        case "invalid":
          cache.delete(ref.ref);
          invalid.push(result.invalid);
          break;
        case "failed":
          // Transient: keep serving the copy we have (stale-if-error).
          failures++;
          firstFailure ??= result.cause;
          warnOnce(
            ref.ref,
            "failed",
            `[${id}] could not refresh ${ref.ref}${cache.has(ref.ref) ? "; serving cached copy" : ""}: ${String(result.cause)}`,
          );
          break;
      }

      const entry = cache.get(ref.ref);
      if (!entry) return;
      const name = entry.listed.skill.name;
      if (names.has(name)) {
        warnOnce(
          ref.ref,
          "duplicate",
          `[${id}] ${ref.ref} is named "${name}", already provided by an earlier ref; skipping`,
        );
        return;
      }
      names.set(name, entry);
      skills.push(entry.listed);
    });

    // Every ref failed and nothing is cached: report the outage instead of an
    // empty catalog, so the agent's logs say why its skills vanished.
    if (refs.length > 0 && failures === refs.length && skills.length === 0) {
      return { ok: false, error: new SkillSourceError(id, "list", firstFailure) };
    }

    byName = names;
    lastListing = { skills, invalid };
    lastListedAt = Date.now();
    return { ok: true, value: lastListing };
  }

  async function list(): ReturnType<SkillSource["list"]> {
    if (lastListing && Date.now() - lastListedAt < refreshIntervalMs) {
      return { ok: true, value: lastListing };
    }
    // Concurrent turns share one round of requests.
    inFlight ??= refresh().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return {
    id,
    list,
    async readResource(skill: SkillName, path: SkillResourcePath) {
      if (!lastListing) await list();
      const entry = byName.get(skill);
      const content = entry?.files[path];
      if (!entry || content === undefined || path === "SKILL.md") {
        return { ok: false, error: new SkillResourceNotFoundError(skill, path) };
      }
      return { ok: true, value: { ...describe(path, content), content } };
    },
  };
}

export type { Skill, SkillSource };
