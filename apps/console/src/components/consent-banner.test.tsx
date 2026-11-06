// @vitest-environment jsdom
import { ConsentBanner } from "@skillist/ui";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const inset = () => document.documentElement.style.getPropertyValue("--consent-inset");

describe("ConsentBanner", () => {
  let resize: () => void;

  beforeEach(() => {
    document.cookie = "skillist-consent=; path=/; max-age=0";
    // jsdom has no layout, so the banner's height and its observer are both stubbed.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      height: 72,
    } as DOMRect);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reserves its height while undecided, so the page can scroll clear of it", () => {
    render(<ConsentBanner />);
    expect(inset()).toBe("72px");
  });

  it("follows the banner when its copy wraps", () => {
    render(<ConsentBanner />);
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({
      height: 128,
    } as DOMRect);
    act(() => resize());
    expect(inset()).toBe("128px");
  });

  it("gives the space back once answered", () => {
    render(<ConsentBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(screen.queryByRole("region", { name: "Cookie consent" })).toBeNull();
    expect(inset()).toBe("");
  });

  it("gives the space back if it unmounts undecided", () => {
    const { unmount } = render(<ConsentBanner />);
    unmount();
    expect(inset()).toBe("");
  });

  it("reserves nothing for someone who already chose", () => {
    document.cookie = "skillist-consent=denied; path=/";
    render(<ConsentBanner />);
    expect(inset()).toBe("");
  });
});
