import { describe, expect, it } from "vitest";
import { addDayBucket, buildDayBuckets, incrementDayBucket, toDaySeries } from "./time-series";

describe("time-series", () => {
  it("builds daily buckets and increments counts", () => {
    const buckets = buildDayBuckets(3);
    const keys = Object.keys(buckets);
    expect(keys).toHaveLength(3);
    incrementDayBucket(buckets, new Date(keys[1]!));
    incrementDayBucket(buckets, new Date(keys[1]!));
    const series = toDaySeries(buckets);
    expect(series.find((p) => p.date === keys[1])?.count).toBe(2);
  });

  it("adds pre-aggregated counts and ignores out-of-window keys", () => {
    const buckets = buildDayBuckets(3);
    const keys = Object.keys(buckets);
    addDayBucket(buckets, keys[0]!, 5);
    addDayBucket(buckets, keys[0]!, 2);
    addDayBucket(buckets, "1999-01-01", 9); // outside the window — dropped
    const series = toDaySeries(buckets);
    expect(series.find((p) => p.date === keys[0])?.count).toBe(7);
    expect(series.reduce((sum, p) => sum + p.count, 0)).toBe(7);
  });
});
