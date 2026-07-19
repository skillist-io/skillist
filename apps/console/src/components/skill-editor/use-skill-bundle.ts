import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isAllowedPath, isProtectedPath, pathsUnder } from "./paths";

export type SkillBundleState = {
  files: Record<string, string>;
  activePath: string;
  dirty: boolean;
  pendingDirs: string[];
  setActivePath: (path: string) => void;
  setFileContent: (path: string, content: string) => void;
  createFile: (path: string) => boolean;
  createDir: (path: string) => void;
  renamePath: (from: string, to: string) => boolean;
  deletePath: (path: string) => void;
  overwriteSkillMd: (content: string) => void;
  reset: (files: Record<string, string>) => void;
};

function sameFiles(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((key) => b[key] === a[key]);
}

export function useSkillBundle({
  initialFiles,
  versionId,
}: {
  initialFiles: Record<string, string> | undefined;
  versionId: string | undefined;
}): SkillBundleState {
  const [files, setFilesState] = useState<Record<string, string>>({});
  const [baseline, setBaseline] = useState<Record<string, string>>({});
  const [activePath, setActivePath] = useState("SKILL.md");
  const [pendingDirs, setPendingDirs] = useState<string[]>([]);
  const loadedVersionRef = useRef<string | undefined>(undefined);

  // Mutations read current files through this ref so their callbacks can
  // return success synchronously without depending on `files` identity.
  const filesRef = useRef(files);
  filesRef.current = files;

  const setFiles = useCallback((next: Record<string, string>) => {
    filesRef.current = next;
    setFilesState(next);
  }, []);

  const dirty = useMemo(() => !sameFiles(files, baseline), [files, baseline]);

  // Baseline only re-initializes on a version switch or while clean, so a
  // background refetch can never clobber in-progress edits. SKILL.md is
  // spec-required, so an empty or partial bundle still gets an editable stub.
  useEffect(() => {
    if (!initialFiles) return;
    const loaded: Record<string, string> = { "SKILL.md": "", ...initialFiles };
    const versionChanged = versionId !== loadedVersionRef.current;
    if (!versionChanged && dirty) return;
    if (!versionChanged && sameFiles(files, loaded)) return;
    loadedVersionRef.current = versionId;
    setFiles(loaded);
    setBaseline(loaded);
    setPendingDirs([]);
    setActivePath((path) => (loaded[path] !== undefined ? path : "SKILL.md"));
  }, [initialFiles, versionId, dirty, files, setFiles]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const setFileContent = useCallback(
    (path: string, content: string) => {
      const prev = filesRef.current;
      if (prev[path] === content) return;
      setFiles({ ...prev, [path]: content });
    },
    [setFiles],
  );

  const createFile = useCallback(
    (path: string) => {
      const prev = filesRef.current;
      if (!isAllowedPath(path) || prev[path] !== undefined) return false;
      setFiles({ ...prev, [path]: "" });
      setPendingDirs((dirs) => dirs.filter((dir) => !path.startsWith(`${dir}/`)));
      setActivePath(path);
      return true;
    },
    [setFiles],
  );

  const createDir = useCallback((path: string) => {
    setPendingDirs((prev) => (prev.includes(path) ? prev : [...prev, path]));
  }, []);

  const renamePath = useCallback(
    (from: string, to: string) => {
      if (isProtectedPath(from) || from === to) return false;
      const prev = filesRef.current;
      const moves: Array<[string, string]> =
        prev[from] !== undefined
          ? [[from, to]]
          : pathsUnder(prev, from).map((path) => [path, `${to}${path.slice(from.length)}`]);
      if (moves.length === 0) return false;
      if (moves.some(([, target]) => !isAllowedPath(target) || prev[target] !== undefined)) {
        return false;
      }
      const next = { ...prev };
      for (const [source, target] of moves) {
        next[target] = next[source] ?? "";
        delete next[source];
      }
      setFiles(next);
      setActivePath((path) =>
        path === from || path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : path,
      );
      return true;
    },
    [setFiles],
  );

  const deletePath = useCallback(
    (path: string) => {
      if (isProtectedPath(path)) return;
      const prev = filesRef.current;
      const removed = prev[path] !== undefined ? [path] : pathsUnder(prev, path);
      if (removed.length > 0) {
        const next = { ...prev };
        for (const key of removed) delete next[key];
        setFiles(next);
      }
      setPendingDirs((dirs) => dirs.filter((dir) => dir !== path && !dir.startsWith(`${path}/`)));
      setActivePath((active) =>
        active === path || active.startsWith(`${path}/`) ? "SKILL.md" : active,
      );
    },
    [setFiles],
  );

  const overwriteSkillMd = useCallback(
    (content: string) => {
      setFiles({ ...filesRef.current, "SKILL.md": content });
    },
    [setFiles],
  );

  const reset = useCallback(
    (nextFiles: Record<string, string>) => {
      setFiles(nextFiles);
      setBaseline(nextFiles);
      setPendingDirs([]);
    },
    [setFiles],
  );

  return {
    files,
    activePath,
    dirty,
    pendingDirs,
    setActivePath,
    setFileContent,
    createFile,
    createDir,
    renamePath,
    deletePath,
    overwriteSkillMd,
    reset,
  };
}
