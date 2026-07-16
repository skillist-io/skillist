---
target: registry
total_score: 21
p0_count: 0
p1_count: 4
timestamp: 2026-07-16T17-06-33Z
slug: apps-web-src-routes-registry-index-tsx
---
# Critique: Public Registry (`/registry`)

Target: `apps/web/src/routes/registry/index.tsx` + `score-badges.tsx`, `registry-star-button.tsx`, `query-error.tsx`, rendered inside `PublicLayout`.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Bare `Loading...` text (line 243), no skeletons; search has no pending state |
| 2 | Match System / Real World | 3 | Clear domain language (quality/impact/security/installs); solid |
| 3 | User Control and Freedom | 2 | No "clear all filters" reset; empty state offers no escape |
| 4 | Consistency and Standards | 1 | Three radii on one page (rounded-full pills, rounded-md selects, squared cards); native <select> ignores existing Select component AND contradicts DESIGN.md |
| 5 | Error Prevention | 2 | Star button likely 401s when logged-out with no guard/feedback |
| 6 | Recognition Rather Than Recall | 3 | Filters and install command visible; good |
| 7 | Flexibility and Efficiency | 2 | No copy button on install command, no keyboard shortcuts |
| 8 | Aesthetic and Minimalist Design | 2 | Card is a wall of badges + stats + snippet + link; three pill filter rows |
| 9 | Error Recovery | 3 | QueryError is genuinely good: plain language + retry |
| 10 | Help and Documentation | 1 | "Impact 72" / "Quality 88" are unexplained numbers; no tooltip or legend |
| **Total** | | **21/40** | **Acceptable — significant improvements needed** |

## Anti-Patterns Verdict

Not flashy-slop (no gradients/glass). Fails the product slop test: a Linear/Vercel/Raycast-fluent user pauses at nearly every control. The tell is inconsistency, not decoration. The page reads as an early shadcn scaffold written before the design system existed and never reconciled with it.

Deterministic scan: detect.mjs returned [] (exit 0). Clean, but a false negative — the violations break the project's own DESIGN.md, which no generic detector knows.

Visual overlays: not available. No dev server running; surface needs full API/DB stack to render data. No browser pass fabricated.

## Overall Impression

The information model (quality/impact/security scoring) is the strong part and the hard part to get right. Presentation undercuts it: every card shouts all metadata at equal weight; filter chrome (three pill rows + four boxed selects) competes with results; the surface predates the "Control Surface" doctrine. Biggest opportunity: reconcile with DESIGN.md, and give each card one clear hierarchy and one obvious action.

## What's Working

1. QueryError (query-error.tsx): plain-language message, icon, working Retry. The quality bar to reuse.
2. The score vocabulary: quality/impact/security triad is the right trust signal; needs explaining + calmer presentation, not removal.
3. Correct fundamentals: debounced search (300ms), native selects (accessible), server-driven facets. Plumbing right, surface wrong.

## Priority Issues

[P1] Page contradicts the design system. Native selects (lines 108, 125, 149) and rounded-full pills (168, 179, 195, 223) = three radii next to squared cards. DESIGN.md mandates squared geometry, underline inputs, text-only badges; a Select component already exists. Fix: use Select; convert pills to squared toggle chips; kill rounded-md. Command: /impeccable polish registry

[P1] Loading and empty states are placeholders. Bare "Loading..." (243); empty state is one muted sentence rendered inside the grid (302-304), lands misaligned in column one. product.md wants skeletons + teaching empty states with an exit. Fix: card skeleton grid; centered full-width empty state with "Clear filters". Command: /impeccable onboard registry

[P1] Result card has no hierarchy and no clear action. Header crams version + star + 3 score badges + runtime + N tags + N agents (256-278); body adds description + 3 stats + install code + faint "View skill" link. All equal weight. Conversion action (copy install) is a passive code block with no copy button. Fix: demote metadata, promote one primary action, add copy button. Command: /impeccable layout registry

[P1] Scores are unexplained numbers. "Quality 88", "Impact 72", "advisory" with no definition (Help=1). These numbers are the basis for trusting a skill. Fix: tooltip per score + "How scores work" docs link. Command: /impeccable clarify registry

[P2] Filter selection conveyed by color alone, no ARIA. Active pills use bg-primary only (169, 180, 196, 224); no aria-pressed. Breaks WCAG 2.2 AA and the "never status by color alone" rule. Fix: aria-pressed + a glyph, not just background. Command: /impeccable audit registry

## Persona Red Flags

Jordan (First-Timer): "Impact 72" and "activations" unexplained; over-filters, hits dead-end empty state, must manually reset ~7 controls. Abandons.

Sam (Accessibility): filter pills announce no pressed state; can't tell active filter; score meaning partly via color. Multiple AA failures on the primary flow.

Casey (Mobile): tall stack of selects before results; install code block awkward to copy by thumb, no copy button. Primary job is hardest one-handed.

Priya (Platform engineer, from Design Context): wants to trust the catalog enough to make skills required; the scores that would earn trust are undefined, and inconsistent UI undercuts the "precise, auditable" promise.

## Minor Observations

- mt-0 on selects (108, 125, 149) fights default margins — symptom of not using the form-control component.
- Result count at ml-auto on the security filter row (234) — arbitrary home for a page-level total.
- H1 is text-2xl font-bold no tracking, vs homepage hero text-4xl tracking-tight — inconsistent heading treatment.
- InstallSnippet uses rounded bg-muted — stray radius; should match squared code-surface vocabulary.

## Questions to Consider

- What if one card had exactly one primary action (Copy install) and everything else demoted to a quiet metadata line?
- Does the page need three pill filter rows visible at once, or a single "Filters" disclosure with an active-count?
- What would make Priya trust a score at a glance without clicking to docs?
