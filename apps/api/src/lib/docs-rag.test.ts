import { describe, expect, it } from "vitest";
import { chunkDocByHeading, docChunkId, stripMdx } from "./docs-rag";

// NOTE: embedText / searchDocs call env.AI + env.VECTORIZE, which are not
// available in the vitest-pool-workers harness, so only the pure chunking /
// stripping helpers are exercised here. The AI/Vectorize paths are covered by
// running `pnpm embed:docs` against a real account.

const sampleMdx = `---
title: Coverage
description: How coverage works.
---

import { DocAlert } from "@/components/docs/DocAlert";

<DocAlert title="Note" client:load>Inline component.</DocAlert>

Coverage tracks three layers.

## Published

A skill is published when it is in the registry.

## Covered

A skill is covered when it appears in scanned inventory.
`;

describe("stripMdx", () => {
  it("lifts the title and strips frontmatter + MDX scaffolding", () => {
    const { title, body } = stripMdx(sampleMdx);
    expect(title).toBe("Coverage");
    expect(body).not.toContain("import {");
    expect(body).not.toContain("<DocAlert");
    expect(body).not.toContain("---");
    expect(body).toContain("Coverage tracks three layers.");
    expect(body).toContain("## Published");
  });
});

describe("chunkDocByHeading", () => {
  it("splits into heading-anchored chunks", () => {
    const { title, body } = stripMdx(sampleMdx);
    const chunks = chunkDocByHeading(body, title ?? "page");
    const headings = chunks.map((c) => c.heading);
    expect(headings).toContain("Published");
    expect(headings).toContain("Covered");
    // The lead paragraph (before any heading) keeps the fallback heading.
    expect(headings).toContain("Coverage");
    for (const c of chunks) expect(c.text.trim().length).toBeGreaterThan(0);
  });

  it("is deterministic for the same input", () => {
    const { body } = stripMdx(sampleMdx);
    expect(chunkDocByHeading(body, "x")).toEqual(chunkDocByHeading(body, "x"));
  });
});

describe("docChunkId", () => {
  it("builds a deterministic id from page + index", () => {
    expect(docChunkId("platform/coverage", 2)).toBe("doc:platform/coverage#2");
  });
});
