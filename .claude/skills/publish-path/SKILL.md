---
name: publish-path
description: >-
  Reference for how a skill version is published and delivered — the KV/R2/DO
  hot path and realtime broadcast. Use when touching publish, delivery, KV, R2,
  or realtime code, or when debugging stale/slow reads or missing publish events.
paths:
  - apps/api/src/lib/publish.ts
  - apps/api/src/lib/delivery.ts
  - apps/api/src/lib/kv.ts
  - apps/api/src/lib/r2.ts
  - apps/api/src/durable-objects/**
---

# Publish & delivery hot path

How Skillist serves published skills at the edge. Keep these invariants when editing.

## Storage tiers

- **KV (`SKILLS_KV`)** — published `SKILL.md` and meta, for <10ms edge reads. Written by `lib/publish.ts`, read by `lib/delivery.ts` / `lib/kv.ts`. The delivery path must read KV, **never Postgres**.
- **R2 (`SKILLS_R2`)** — full bundles (all files). `lib/r2.ts` handles `r2Prefix`, `sha256`, upload/download.
- **Postgres (via `HYPERDRIVE`)** — source of truth for versions/metadata; used on writes and non-hot reads, not on the delivery hot path.

## Publish flow

1. A publish (`publishVersion` in `lib/ai.ts` / route handler) writes the bundle to R2 and the `SKILL.md` + meta to KV.
2. It broadcasts a publish event: `broadcastPublish(...)` → `SkillRealtimeHub` DO `/broadcast`.
3. `SkillRealtimeHub` (one instance per `org:repo`, keyed by `idFromName`) fans the event out to subscribers over WebSocket + SSE.

## Delivery flow (public, unauthed)

`/{org}/{repo}/SKILL.md` and `/meta` → KV read via `deliveryRoutes`. `/bundle` → R2. These are mounted at root in `index.ts` (`app.route("/", deliveryRoutes)`) and are intentionally public.

## Invariants

- Don't add a DB query to the delivery path — it defeats the <10ms budget.
- Every publish must write KV **and** R2 **and** broadcast; a partial write causes stale delivery or missing realtime updates.
- Respect per-user cache scoping and never persist credentials in KV/R2.

## Verify

`pnpm --filter @skillist/api exec vitest run src/publish-latency.test.ts` and related delivery/KV tests, then `pnpm check` + `pnpm typecheck`.
