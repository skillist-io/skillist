type DayPoint = { date: string; count: number };

export function buildDayBuckets(days: number): Record<string, number> {
  const buckets: Record<string, number> = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    buckets[d.toISOString().slice(0, 10)] = 0;
  }
  return buckets;
}

export function toDaySeries(buckets: Record<string, number>): DayPoint[] {
  return Object.entries(buckets).map(([date, count]) => ({ date, count }));
}

export function incrementDayBucket(buckets: Record<string, number>, date: Date) {
  const key = date.toISOString().slice(0, 10);
  if (key in buckets) buckets[key]! += 1;
}

/**
 * Add a pre-aggregated count to a day bucket keyed by an ISO date string
 * (`YYYY-MM-DD`). Used when day counts come from a SQL `GROUP BY` instead of
 * raw rows; the `key in buckets` guard drops days outside the requested window,
 * matching `incrementDayBucket`'s per-row behavior.
 */
export function addDayBucket(buckets: Record<string, number>, key: string, count: number) {
  if (key in buckets) buckets[key]! += count;
}
