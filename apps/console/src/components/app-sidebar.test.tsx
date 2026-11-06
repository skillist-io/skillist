// @vitest-environment jsdom
import {
  ApiError,
  api,
  type Org,
  SidebarProvider,
  SidebarTrigger,
  type Skill,
  TooltipProvider,
} from "@skillist/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActiveOrgProvider } from "@/lib/active-org";
import { AppSidebar } from "./app-sidebar";

vi.mock("@skillist/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@skillist/ui")>()),
  api: vi.fn(),
  useSession: () => ({ data: null }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params: _params,
    children,
    ...rest
  }: {
    to: string;
    params?: unknown;
    children: React.ReactNode;
  }) => (
    <a href={to} {...rest} onClick={(event) => event.preventDefault()}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
  useRouterState: () => "/dashboard",
}));

vi.mock("@/components/nav-user", () => ({ NavUser: () => null }));
vi.mock("@/components/new-project-dialog", () => ({
  NewProjectDialog: ({ trigger }: { trigger: React.ReactNode }) => trigger,
}));

const orgs = [
  { id: "o1", name: "Acme Platform", slug: "acme" },
  { id: "o2", name: "Research Lab", slug: "research" },
] as Org[];

const skillsByOrg: Record<string, Skill[]> = {
  o1: [{ id: "s1", repo: "deploy-checklist", visibility: "private" }] as Skill[],
  o2: [{ id: "s2", repo: "paper-summarizer", visibility: "public" }] as Skill[],
};

type Route = (path: string) => unknown;

/** Answers like the API: orgs, then per-org lists; admin is refused unless overridden. */
function serve(override: Route = () => undefined) {
  vi.mocked(api).mockImplementation(async (path: string) => {
    const answer = override(path);
    if (answer !== undefined) return answer;
    if (path === "/v1/admin/sources") throw new ApiError("Admin only", 403, {});
    if (path === "/v1/orgs") return orgs;
    const skills = path.match(/orgs\/(\w+)\/skills$/);
    if (skills?.[1]) return skillsByOrg[skills[1]] ?? [];
    return [];
  });
}

function setViewport(width: number) {
  window.innerWidth = width;
}

function renderSidebar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ActiveOrgProvider>
          <SidebarProvider>
            <AppSidebar />
            <SidebarTrigger />
          </SidebarProvider>
        </ActiveOrgProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const filterBox = () => screen.getByRole("textbox", { name: /filter/i });
const typeFilter = (value: string) => fireEvent.change(filterBox(), { target: { value } });

beforeEach(() => {
  setViewport(1440);
  // This jsdom setup has no localStorage, and the active org reads it.
  const stored = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    },
  });
  document.cookie = "sidebar_state=; max-age=0; path=/";
  window.matchMedia = vi.fn().mockReturnValue({
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  // Radix measures and captures pointers through APIs jsdom doesn't implement.
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  serve();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("filter", () => {
  it("finds a skill in an org whose name doesn't match", async () => {
    renderSidebar();
    await screen.findByText("deploy-checklist");

    typeFilter("paper");

    expect(await screen.findByText("paper-summarizer")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("deploy-checklist")).toBeNull());
    expect(screen.queryByText("No skills match your filters.")).toBeNull();
  });

  it("says so when nothing matches, on screen and to screen readers", async () => {
    renderSidebar();
    await screen.findByText("deploy-checklist");

    typeFilter("zzz");

    expect(await screen.findByText("No skills match your filters.")).toBeTruthy();
    expect(screen.getByText("No matches").getAttribute("role")).toBe("status");
  });

  it("doesn't call a failed org a non-match", async () => {
    serve((path) => {
      if (path === "/v1/orgs/o2/skills") throw new ApiError("boom", 500, {});
    });
    renderSidebar();
    await screen.findByText("deploy-checklist");

    typeFilter("zzz");

    await screen.findByText("Some results couldn't be loaded");
    expect(screen.getByText("Couldn't load skills.")).toBeTruthy();
    expect(screen.queryByText("No skills match your filters.")).toBeNull();
  });
});

describe("org scope", () => {
  const orgButton = (name: string) => screen.getByRole("button", { name });

  it("opens the active org and leaves the others collapsed", async () => {
    renderSidebar();

    await screen.findByText("deploy-checklist");
    expect(orgButton("Acme Platform").getAttribute("aria-expanded")).toBe("true");
    expect(orgButton("Research Lab").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("paper-summarizer")).toBeNull();
  });

  it("pins the stored active org first", async () => {
    window.localStorage.setItem("skillist:active-org", "o2");
    renderSidebar();

    await screen.findByText("paper-summarizer");
    const names = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(names).toEqual(["Research Lab", "Acme Platform"]);
  });

  it("doesn't fetch a collapsed org until it's opened", async () => {
    renderSidebar();
    await screen.findByText("deploy-checklist");
    expect(vi.mocked(api).mock.calls.map(([path]) => path)).not.toContain("/v1/orgs/o2/skills");

    fireEvent.click(orgButton("Research Lab"));

    expect(await screen.findByText("paper-summarizer")).toBeTruthy();
  });
});

describe("skill rows", () => {
  it("says what state a skill is in, with failures first", async () => {
    serve((path) => {
      if (path === "/v1/orgs/o1/skills") {
        return [
          { id: "a", repo: "broken", visibility: "private", publishedSemver: "1.0.0" },
          {
            id: "b",
            repo: "waiting",
            visibility: "org",
            publishedSemver: "1.0.0",
            draftSemver: "1.1.0",
          },
          { id: "c", repo: "shipped", visibility: "public", publishedSemver: "2.3.1" },
        ];
      }
      if (path.includes("failure-patterns")) return { patterns: [{ skillRepo: "broken" }] };
    });
    renderSidebar();

    const row = async (repo: string) => (await screen.findByText(repo)).closest("a")?.textContent;
    await screen.findByText("1 failing");
    expect(await row("broken")).toContain("1 failing");
    expect(await row("waiting")).toContain("draft");
    expect(await row("shipped")).toContain("2.3.1");
  });

  it("doesn't claim anything when failure data is refused", async () => {
    serve((path) => {
      if (path.includes("failure-patterns")) throw new ApiError("Forbidden", 403, {});
    });
    renderSidebar();

    await screen.findByText("deploy-checklist");
    expect(screen.queryByText(/failing/)).toBeNull();
  });
});

describe("keyboard", () => {
  const treeLinks = () =>
    within(screen.getByRole("navigation", { name: /orgs, projects/i })).getAllByRole("link");

  it("makes the tree one Tab stop, with arrows inside it", async () => {
    serve((path) =>
      path === "/v1/orgs/o1/skills"
        ? [
            { id: "a", repo: "first", visibility: "private" },
            { id: "b", repo: "second", visibility: "private" },
          ]
        : undefined,
    );
    renderSidebar();
    await screen.findByText("second");

    const tree = screen.getByRole("navigation", { name: /orgs, projects/i });
    const stops = [...tree.querySelectorAll<HTMLElement>("a, button")].filter(
      (el) => el.tabIndex === 0,
    );
    expect(stops).toHaveLength(1);

    const [first, second] = treeLinks();
    first?.focus();
    fireEvent.keyDown(first as HTMLElement, { key: "ArrowDown" });

    expect(document.activeElement).toBe(second);
    expect(second?.tabIndex).toBe(0);
    expect(first?.tabIndex).toBe(-1);
  });

  it("opens and closes an org with the arrow keys", async () => {
    renderSidebar();
    await screen.findByText("deploy-checklist");
    const org = screen.getByRole("button", { name: "Research Lab" });
    org.focus();

    fireEvent.keyDown(org, { key: "ArrowRight" });
    expect(await screen.findByText("paper-summarizer")).toBeTruthy();

    fireEvent.keyDown(org, { key: "ArrowLeft" });
    await waitFor(() => expect(screen.queryByText("paper-summarizer")).toBeNull());
  });

  it("focuses the filter on / but not while typing elsewhere", async () => {
    renderSidebar();
    await screen.findByText("deploy-checklist");

    fireEvent.keyDown(document.body, { key: "/" });
    expect(document.activeElement).toBe(filterBox());

    const other = document.body.appendChild(document.createElement("textarea"));
    other.focus();
    fireEvent.keyDown(other, { key: "/" });
    expect(document.activeElement).toBe(other);
    other.remove();
  });

  it("clears the filter on Esc", async () => {
    renderSidebar();
    await screen.findByText("deploy-checklist");
    typeFilter("zzz");

    fireEvent.keyDown(filterBox(), { key: "Escape" });

    expect((filterBox() as HTMLInputElement).value).toBe("");
  });

  it("names which org a New button creates in", async () => {
    renderSidebar();

    expect(
      await screen.findByRole("button", { name: "New project in Acme Platform" }),
    ).toBeTruthy();
  });
});

describe("private-only", () => {
  it("shows the empty message rather than a blank panel", async () => {
    serve((path) => (path.endsWith("/skills") ? skillsByOrg.o2 : undefined));
    renderSidebar();
    await screen.findAllByText("paper-summarizer");

    fireEvent.click(screen.getByRole("button", { name: "Show only private skills" }));

    expect(await screen.findByText("No private skills match your filters.")).toBeTruthy();
  });
});

describe("loading and failure", () => {
  it("doesn't claim there are no orgs while they load", async () => {
    serve((path) => (path === "/v1/orgs" ? new Promise(() => {}) : undefined));
    renderSidebar();

    expect(await screen.findByText("Loading organizations…")).toBeTruthy();
    expect(screen.queryByText(/No organizations yet/)).toBeNull();
  });

  it("reports a failed org request and recovers on retry", async () => {
    let healthy = false;
    serve((path) => {
      if (path === "/v1/orgs" && !healthy) throw new ApiError("boom", 500, {});
    });
    renderSidebar();

    await screen.findByText("Couldn't load organizations.");
    expect(screen.queryByText(/No organizations yet/)).toBeNull();

    healthy = true;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("deploy-checklist")).toBeTruthy();
  });

  it("still says so when there really are no orgs", async () => {
    serve((path) => (path === "/v1/orgs" ? [] : undefined));
    renderSidebar();

    expect(await screen.findByText(/No organizations yet/)).toBeTruthy();
  });
});

describe("Mirrors", () => {
  const mirrorsLink = () => document.querySelector('a[href="/admin/mirrors"]');

  it("stays hidden when the API refuses", async () => {
    renderSidebar();
    await screen.findByText("deploy-checklist");

    expect(mirrorsLink()).toBeNull();
  });

  it("appears once the API confirms access", async () => {
    serve((path) => (path === "/v1/admin/sources" ? { items: [] } : undefined));
    renderSidebar();

    await waitFor(() => expect(mirrorsLink()).not.toBeNull());
  });
});

describe("collapsing", () => {
  it("hands focus to the trigger instead of dropping it", async () => {
    renderSidebar();
    await screen.findByText("deploy-checklist");
    filterBox().focus();

    fireEvent.keyDown(window, { key: "b", metaKey: true });

    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    const trigger = screen.getByRole("button", { name: "Toggle Sidebar" });
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("mobile sheet", () => {
  async function openSheet() {
    setViewport(390);
    renderSidebar();
    fireEvent.click(await screen.findByRole("button", { name: "Toggle Sidebar", hidden: true }));
    return within(await screen.findByRole("dialog"));
  }

  it("carries the filter and the tree", async () => {
    const sheet = await openSheet();

    expect(sheet.getByRole("textbox", { name: /filter/i })).toBeTruthy();
    expect(await sheet.findByText("deploy-checklist")).toBeTruthy();
  });

  it("closes when a link is tapped", async () => {
    const sheet = await openSheet();

    fireEvent.click(sheet.getByRole("link", { name: "Inventory" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("stays open for controls that aren't links", async () => {
    const sheet = await openSheet();

    fireEvent.click(sheet.getByRole("button", { name: "Show only private skills" }));

    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
