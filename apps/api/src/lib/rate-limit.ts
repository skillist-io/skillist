import { createMiddleware } from "hono/factory";

const buckets = new Map<string, { count: number; resetAt: number }>();

export const rateLimit = (limit = 120, windowMs = 60_000) =>
  createMiddleware(async (c, next) => {
    const ip = c.req.header("cf-connecting-ip") ?? "local";
    const key = `${ip}:${c.req.path.split("/").slice(0, 3).join("/")}`;
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || now > bucket.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      await next();
      return;
    }

    if (bucket.count >= limit) {
      return c.json({ error: "Rate limit exceeded" }, 429);
    }

    bucket.count += 1;
    await next();
  });
