// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useAutoExpand } from "./use-auto-expand";

describe("useAutoExpand", () => {
  it("starts open when the branch is already active", () => {
    const { result } = renderHook(() => useAutoExpand(true));
    expect(result.current[0]).toBe(true);
  });

  it("starts closed when the branch is not active", () => {
    const { result } = renderHook(() => useAutoExpand(false));
    expect(result.current[0]).toBe(false);
  });

  it("opens when the branch becomes active", () => {
    const { result, rerender } = renderHook(({ active }) => useAutoExpand(active), {
      initialProps: { active: false },
    });
    expect(result.current[0]).toBe(false);

    rerender({ active: true });
    expect(result.current[0]).toBe(true);
  });

  it("does NOT close when the branch stops being active", () => {
    // The asymmetry that makes the sidebar feel co-operative: navigating away
    // must not fold up the branch you are looking at.
    const { result, rerender } = renderHook(({ active }) => useAutoExpand(active), {
      initialProps: { active: true },
    });

    rerender({ active: false });
    expect(result.current[0]).toBe(true);
  });

  it("keeps a branch the reader opened by hand open across navigation", () => {
    const { result, rerender } = renderHook(({ active }) => useAutoExpand(active), {
      initialProps: { active: false },
    });

    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);

    // Somewhere else entirely — still theirs.
    rerender({ active: false });
    expect(result.current[0]).toBe(true);
  });

  it("respects a manual close, and reopens only on becoming active again", () => {
    const { result, rerender } = renderHook(({ active }) => useAutoExpand(active), {
      initialProps: { active: true },
    });

    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);

    // Still active — no re-open, because it never *became* active again.
    rerender({ active: true });
    expect(result.current[0]).toBe(false);

    // Leaving and returning is what re-opens it.
    rerender({ active: false });
    rerender({ active: true });
    expect(result.current[0]).toBe(true);
  });
});
