import { describe, expect, it } from "vitest";
import { cn, formatCount } from "./utils";

// Regression guard. tailwind-merge only knows Tailwind's built-in font sizes;
// our custom `text-hero/display/headline/title` tokens (DESIGN.md §3) look like
// `text-<color>` to it, so without the extendTailwindMerge config in utils.ts it
// classifies them as text-color and silently drops them whenever a real color
// like `text-foreground` is also present. That downgrades every PageTitle /
// SectionTitle to 16px body text across web and console — a change that is
// invisible in code review and has already been lost once in a refactor.
const CUSTOM_FONT_SIZES = ["hero", "display", "headline", "title"] as const;

describe("cn", () => {
  it.each(CUSTOM_FONT_SIZES)("keeps text-%s alongside a text color", (size) => {
    expect(cn(`text-${size} text-balance text-foreground`)).toBe(
      `text-${size} text-balance text-foreground`,
    );
  });

  it("keeps a custom font size when a color arrives from a later argument", () => {
    // PageTitle merges its base classes with a caller-supplied className.
    expect(cn("text-display text-foreground", "text-muted-foreground")).toBe(
      "text-display text-muted-foreground",
    );
  });

  it("still lets a later font size override a custom one", () => {
    expect(cn("text-display", "text-lg")).toBe("text-lg");
    expect(cn("text-lg", "text-display")).toBe("text-display");
  });

  it("still resolves ordinary tailwind conflicts", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-foreground", "text-muted-foreground")).toBe("text-muted-foreground");
  });
});

describe("formatCount", () => {
  it("passes through counts below 1000", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(999)).toBe("999");
  });

  it("abbreviates thousands and millions", () => {
    expect(formatCount(1240)).toBe("1.2k");
    expect(formatCount(18_420)).toBe("18k");
    expect(formatCount(1_500_000)).toBe("1.5M");
  });
});
