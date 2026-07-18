// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSkillBundle } from "./use-skill-bundle";

const BASE: Record<string, string> = {
  "SKILL.md": "---\nname: a\ndescription: b\n---\nbody",
};

function render(initialFiles = BASE, versionId = "v1") {
  return renderHook(
    (props: { initialFiles: Record<string, string>; versionId: string }) => useSkillBundle(props),
    { initialProps: { initialFiles, versionId } },
  );
}

describe("useSkillBundle", () => {
  it("initializes from files and tracks dirty", () => {
    const { result } = render();
    expect(result.current.files).toEqual(BASE);
    expect(result.current.dirty).toBe(false);

    act(() => result.current.setFileContent("SKILL.md", "changed"));
    expect(result.current.dirty).toBe(true);

    act(() => result.current.setFileContent("SKILL.md", BASE["SKILL.md"] ?? ""));
    expect(result.current.dirty).toBe(false);
  });

  it("stubs an editable SKILL.md when the loaded bundle is empty", () => {
    const { result } = render({}, "v-empty");
    expect(result.current.files).toEqual({ "SKILL.md": "" });
    expect(result.current.dirty).toBe(false);
  });

  it("does not clobber dirty edits on a same-version refetch", () => {
    const { result, rerender } = render();
    act(() => result.current.setFileContent("SKILL.md", "edited"));
    rerender({ initialFiles: { "SKILL.md": "refetched" }, versionId: "v1" });
    expect(result.current.files["SKILL.md"]).toBe("edited");
  });

  it("re-baselines on version switch even when dirty", () => {
    const { result, rerender } = render();
    act(() => result.current.setFileContent("SKILL.md", "edited"));
    rerender({ initialFiles: { "SKILL.md": "v2 content" }, versionId: "v2" });
    expect(result.current.files["SKILL.md"]).toBe("v2 content");
    expect(result.current.dirty).toBe(false);
  });

  it("creates files only at allowed paths and activates them", () => {
    const { result } = render();
    let ok = false;
    act(() => {
      ok = result.current.createFile("scripts/run.py");
    });
    expect(ok).toBe(true);
    expect(result.current.activePath).toBe("scripts/run.py");

    act(() => {
      ok = result.current.createFile("nope/run.py");
    });
    expect(ok).toBe(false);
  });

  it("renames folders recursively and refuses collisions", () => {
    const { result } = render({
      ...BASE,
      "scripts/a.py": "a",
      "scripts/lib/b.py": "b",
      "references/keep.md": "k",
    });
    act(() => {
      result.current.setActivePath("scripts/lib/b.py");
    });
    act(() => {
      result.current.renamePath("scripts", "assets");
    });
    expect(result.current.files["assets/lib/b.py"]).toBe("b");
    expect(result.current.files["scripts/a.py"]).toBeUndefined();
    expect(result.current.activePath).toBe("assets/lib/b.py");

    let ok = true;
    act(() => {
      ok = result.current.renamePath("references/keep.md", "assets/a.py");
    });
    expect(ok).toBe(false);
  });

  it("deletes folders by prefix and falls back to SKILL.md", () => {
    const { result } = render({ ...BASE, "scripts/a.py": "", "scripts/b.py": "" });
    act(() => {
      result.current.setActivePath("scripts/a.py");
    });
    act(() => {
      result.current.deletePath("scripts");
    });
    expect(Object.keys(result.current.files)).toEqual(["SKILL.md"]);
    expect(result.current.activePath).toBe("SKILL.md");
  });

  it("never deletes or renames SKILL.md", () => {
    const { result } = render();
    act(() => {
      result.current.deletePath("SKILL.md");
      result.current.renamePath("SKILL.md", "OTHER.md");
    });
    expect(result.current.files["SKILL.md"]).toBe(BASE["SKILL.md"]);
  });

  it("overwriteSkillMd replaces content (realtime/apply-draft path)", () => {
    const { result } = render();
    act(() => result.current.overwriteSkillMd("remote"));
    expect(result.current.files["SKILL.md"]).toBe("remote");
    expect(result.current.dirty).toBe(true);
  });

  it("reset re-baselines after save", () => {
    const { result } = render();
    act(() => result.current.setFileContent("SKILL.md", "saved content"));
    act(() => result.current.reset({ "SKILL.md": "saved content" }));
    expect(result.current.dirty).toBe(false);
  });
});
