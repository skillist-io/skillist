import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const entry = fileURLToPath(new URL("./index.ts", import.meta.url));

// index.ts runs main() on import, so this drives the real entry point.
describe("skillist --version", () => {
  it.each(["--version", "-v", "version"])(
    "prints only the package version for %s",
    async (flag) => {
      const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
      const { stdout } = await run(process.execPath, ["--import", "tsx", entry, flag]);
      expect(stdout.trim()).toBe(pkg.version);
    },
  );
});
