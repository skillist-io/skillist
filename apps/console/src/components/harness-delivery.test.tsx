// @vitest-environment jsdom
import type { ObservabilitySummary } from "@skillist/ui";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HarnessDelivery, harnessLabel, scopeSummary } from "./harness-delivery";

afterEach(cleanup);

type HarnessRow = ObservabilitySummary["telemetry"]["byHarness"][number];

function row(overrides: Partial<HarnessRow> = {}): HarnessRow {
  return {
    harness: "claude",
    activations: 4,
    skills: 2,
    projectScoped: 4,
    userScoped: 0,
    ...overrides,
  };
}

describe("harnessLabel", () => {
  it("maps known harness ids to display names", () => {
    expect(harnessLabel("claude")).toBe("Claude Code");
    expect(harnessLabel("vscode")).toBe("VS Code");
  });

  it("shows an unrecognized harness verbatim rather than dropping it", () => {
    // A harness that ships after this map was written must still appear.
    expect(harnessLabel("some-new-agent")).toBe("some-new-agent");
  });
});

describe("scopeSummary", () => {
  it("omits a scope with no events", () => {
    expect(scopeSummary(row())).toBe("4 project");
    expect(scopeSummary(row({ projectScoped: 0, userScoped: 3 }))).toBe("3 user");
  });

  it("joins both scopes when each has events", () => {
    expect(scopeSummary(row({ projectScoped: 4, userScoped: 1 }))).toBe("4 project · 1 user");
  });

  it("returns empty when neither scope was reported", () => {
    expect(scopeSummary(row({ projectScoped: 0, userScoped: 0 }))).toBe("");
  });
});

describe("HarnessDelivery", () => {
  it("lists each harness with its skill and delivery counts", () => {
    render(
      <HarnessDelivery
        days={30}
        rows={[row(), row({ harness: "cursor", activations: 1, skills: 1, projectScoped: 1 })]}
      />,
    );

    expect(screen.getByText("Claude Code")).toBeTruthy();
    expect(screen.getByText(/2 skills · 4 deliveries · 4 project/)).toBeTruthy();
    expect(screen.getByText("Cursor")).toBeTruthy();
    // Singular forms, not "1 skills · 1 deliverys".
    expect(screen.getByText(/1 skill · 1 delivery · 1 project/)).toBeTruthy();
  });

  it("survives a response with no byHarness field", () => {
    // Regression: an API that predates (or rolls back before) the byHarness
    // field must degrade to this one panel's empty state, never take the whole
    // Observability route down. It did exactly that in production once.
    expect(() =>
      render(<HarnessDelivery days={30} rows={undefined as unknown as HarnessRow[]} />),
    ).not.toThrow();
    expect(screen.getByText("No deliveries reported yet")).toBeTruthy();
  });

  it("tells the user how to populate an empty panel", () => {
    render(<HarnessDelivery days={30} rows={[]} />);
    expect(screen.getByText("No deliveries reported yet")).toBeTruthy();
    expect(screen.getByText("skillist sync")).toBeTruthy();
  });

  it("keeps every value in text, so the bars carry no information alone", () => {
    const { container } = render(<HarnessDelivery days={7} rows={[row()]} />);
    // The bar is decorative; assistive tech reads the counts from the row text.
    const bars = container.querySelectorAll("[aria-hidden='true']");
    expect(bars.length).toBe(1);
    expect(screen.getByText(/2 skills · 4 deliveries/)).toBeTruthy();
  });
});
