import { describe, expect, it } from "vitest";
import {
  buildDayBuckets,
  incrementDayBucket,
  toDaySeries,
} from "./time-series";

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
});
