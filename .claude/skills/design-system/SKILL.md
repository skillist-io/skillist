---
name: design-system
description: >-
  Skillist's visual system ("The Control Surface") and WCAG 2.2 AA rules for any
  UI work in apps/web or apps/docs. Use when creating/editing components, routes,
  styles, or tokens, or reviewing UI. Full detail lives in DESIGN.md / PRODUCT.md.
paths:
  - apps/web/**
  - apps/docs/**
---

# Design system — "The Control Surface"

An instrument panel: precise, technical, calm. Borrow the *composure* of Linear/Vercel/Warp, not their palettes. Full spec: `DESIGN.md`, `PRODUCT.md`, tokens in `DESIGN.json` and `apps/web/src/index.css`.

## Visual rules

- **Squared geometry** — 0px radius on buttons, badges, cards, inputs, images. No rounded corners anywhere.
- **Monochrome ink ramp** (OKLCH, chroma 0) for all structure, plus exactly **two chromatic voices**:
  - destructive **red** = failure/danger
  - signal **violet** `oklch(0.52 0.21 293)` light / `oklch(0.72 0.19 293)` dark = "live right now" (≤10% of screen; four surfaces max)
  - No other accent colors. **Badges are text-only** — no colored chips.
- **Underline inputs**, not boxed boxes. **Hairline rings, not shadows** (flat by default, `shadow-sm` max).
- Uppercase, wide-tracked micro-labels for badges/eyebrows/status; **buttons and nav are sentence-case, medium-weight** (deliberate hybrid). **Machine values in mono; prose never mono.** Literal white `oklch(1 0 0)` light background. Display capped ~3rem (hero up to ~4rem).

## Anti-references (do NOT drift toward these)

Generic shadcn/AI-default (grayscale-neutral + Inter + default-purple); playful/consumer/rounded; cluttered enterprise dashboard; loud SaaS marketing.

## Accessibility — WCAG 2.2 AA (required)

- Body contrast ≥4.5:1 (≥3:1 large/bold); placeholders held to 4.5:1.
- Full keyboard nav + visible, high-contrast focus rings.
- **Light and dark themes must both pass.**
- `prefers-reduced-motion` fallback for every animation.
- **Never encode status by color alone** — always pair a word, icon, or shape.

## Practice

- Use tokens from `src/index.css` (`@theme inline`, OKLCH vars, `.dark`) over literal colors. Compose with `cn()` (`@/lib/utils`) and `cva`, matching the squared/ink/uppercase geometry of existing `src/components/ui/*`.
- For live visual iteration, use the `/impeccable` skill (live mode configured) rather than eyeballing screenshots.
