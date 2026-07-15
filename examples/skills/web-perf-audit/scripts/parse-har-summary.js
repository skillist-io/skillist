#!/usr/bin/env node
/**
 * Summarize a HAR file: request count, transfer size, slowest entries.
 * Usage: node parse-har-summary.js path/to/file.har
 */
import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("Usage: parse-har-summary.js <har-file>");
  process.exit(1);
}

const har = JSON.parse(readFileSync(path, "utf8"));
const entries = har?.log?.entries ?? [];
let totalBytes = 0;
const durations = [];

for (const e of entries) {
  const size = e.response?.content?.size ?? 0;
  totalBytes += size;
  durations.push({
    url: e.request?.url ?? "",
    ms: e.time ?? 0,
    size,
  });
}

durations.sort((a, b) => b.ms - a.ms);
console.log(JSON.stringify({
  requests: entries.length,
  totalBytes,
  slowest: durations.slice(0, 5),
}, null, 2));
