#!/usr/bin/env node
/**
 * Fail when dependency versions can drift apart again.
 *
 *   pnpm check:catalog
 *
 * `catalogMode: strict` only guards `pnpm add`. `pnpm install` happily accepts a
 * hand-written range, so nothing else stops a manifest from quietly leaving the
 * catalog. This checks the three things that have actually gone wrong:
 *
 *   1. A package in the catalog is hardcoded in a manifest.
 *   2. A package used by two or more manifests is missing from the catalog.
 *   3. The Sandbox base image disagrees with the @cloudflare/sandbox SDK. A
 *      catalog can't reach a Dockerfile, and a mismatch breaks the DO<->container
 *      control protocol at runtime rather than at build time.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

const SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const DOCKERFILES = ["apps/api/Dockerfile", "apps/api/Dockerfile.heavy"];

const workspace = parse(read("pnpm-workspace.yaml"));
const catalog = workspace.catalog ?? {};

// Workspace globs here are all `dir/*`, so a directory listing is enough.
const manifests = ["package.json"];
for (const pattern of workspace.packages) {
  const dir = pattern.replace(/\/\*$/, "");
  for (const entry of readdirSync(join(root, dir))) {
    if (existsSync(join(root, dir, entry, "package.json"))) {
      manifests.push(`${dir}/${entry}/package.json`);
    }
  }
}

const errors = [];
const usedBy = new Map();

for (const path of manifests) {
  const manifest = JSON.parse(read(path));
  for (const section of SECTIONS) {
    for (const [name, range] of Object.entries(manifest[section] ?? {})) {
      if (range.startsWith("workspace:")) continue;
      if (!usedBy.has(name)) usedBy.set(name, new Set());
      usedBy.get(name).add(path);
      if (name in catalog && !range.startsWith("catalog:")) {
        errors.push(`${path}: ${name} is "${range}", use "catalog:"`);
      }
    }
  }
}

for (const [name, paths] of usedBy) {
  if (paths.size > 1 && !(name in catalog)) {
    errors.push(`${name} is used by ${[...paths].join(", ")}, add it to the catalog`);
  }
}

// Compare against the lockfile, not the manifest: the range can stay the same
// while the installed SDK moves, and the installed version is what must match.
const lockfile = parse(read("pnpm-lock.yaml"));
const sandbox = lockfile.importers["apps/api"].dependencies["@cloudflare/sandbox"].version;
for (const path of DOCKERFILES) {
  const tag = read(path).match(/^FROM\s+\S*cloudflare\/sandbox:(\S+)/m)?.[1];
  if (tag !== sandbox) {
    errors.push(`${path}: base image is ${tag}, but @cloudflare/sandbox is ${sandbox}`);
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`ok    ${manifests.length} manifests, ${Object.keys(catalog).length} catalog entries`);
