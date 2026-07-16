---
target: $org/$repo skill detail
total_score: 21
p0_count: 0
p1_count: 3
timestamp: 2026-07-16T18-12-35Z
slug: apps-web-src-routes-org-repo-tsx
---
# Critique: Skill Detail (`/$org/$repo`)

Target: `apps/web/src/routes/$org/$repo.tsx` + skill-run-card, agent-install-buttons, public-eval-badge, skill-run-history, skill-analytics-chart. Rendered in PublicLayout.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Great Live indicator + streamed run output, but no page skeleton, no error state, silent copy actions |
| 2 | Match System / Real World | 3 | Strong domain language; "Discovery metadata / progressive disclosure" leaks an internal concept |
| 3 | User Control and Freedom | 2 | No cancel on a running script; Subscribe/star give no undo |
| 4 | Consistency and Standards | 1 | Hardcoded green/amber/red palette + stray radii across page and 4 children; diverges from polished registry and DESIGN.md |
| 5 | Error Prevention | 2 | Run is auth-gated (good); target URL is unvalidated free text |
| 6 | Recognition Rather Than Recall | 3 | Everything visible; install command shown |
| 7 | Flexibility and Efficiency | 2 | One-click per-agent install, but copies silently with no feedback |
| 8 | Aesthetic and Minimalist Design | 2 | 8+ equal-weight stacked cards; agent list repeated 3x; a Card for 2 metadata fields |
| 9 | Error Recovery | 2 | Run errors dumped as raw text in output pre; no QueryError on failed loads |
| 10 | Help and Documentation | 2 | Old ScoreBadges with no tooltips; security status unexplained |
| **Total** | | **21/40** | **Acceptable** |

## Anti-Patterns Verdict

Fails the product slop test worse than the registry did, because it now sits next to a polished surface. Clicking "View" from the registry lands on a different generation: green Live badges, amber sign-in box, red error panels, rounded-md selects, tall pile of identical cards. detect.mjs returned [] (false negative). Grep found: text-green-700, green-50, amber-200/50/900, red-200/50/900, rounded/rounded-md across $repo.tsx + skill-run-card + skill-run-history + agent-install-buttons. Browser overlays not run: page needs full API/DB stack AND an authenticated session (scripts/run gated).

## Overall Impression

Substance is strong: live indicator, streamed sandbox execution, run history, eval uplift, MCP servers, agent compat. The trust-and-control payload is here and "realtime made legible" is happening. But presentation buries it in a flat card-pile with wrong hierarchy, and color/radius drift makes a serious page look unfinished. Biggest opportunity: give it a real hierarchy (one clear adopt path up top, execution/history second, reference collapsed) and bring it onto the monochrome doctrine.

## What's Working

1. Realtime run experience: Live/Offline presence + SSE-streamed stdout/stderr with a Running state. The differentiator, working; needs de-greening + a completion status.
2. Honest complete trust signals: score, eval uplift (baseline -> with-skill), security, run history, MCP servers, agent compat.
3. Per-agent install shortcuts generating the right -o path per agent.

## Priority Issues

[P1] Hardcoded palette colors + stray radii, page-wide. green (Live/Published), amber (sign-in), red (errors), rounded/rounded-md everywhere; no tokens, off monochrome+destructive doctrine. Green Live is the worst: realtime status is the signature, rendered in off-brand raw green. Fix: errors -> destructive, neutral -> foreground/muted, Live/Published -> deliberate on-doctrine treatment (foreground+icon or reserved accent), square all radii. Command: /impeccable colorize $org/$repo

[P1] Flat card-pile IA with inverted hierarchy. 8+ equal-weight full-width cards; Run in Sandbox + Run history appear above Install; agent list repeated 3x. Fix: tiers (trust/adopt header with Install up top, execution+history second, reference collapsed), 2-column layout, dedupe agent list. Command: /impeccable layout $org/$repo

[P1] No loading or error states on primary data. entry/meta queries have no isError/isLoading; on failure renders repo slug + empty scaffolding. QueryError + skeletons exist and aren't used. Fix: QueryError w/ retry + page skeleton matching registry. Command: /impeccable harden $org/$repo

[P2] Silent copy actions + drift from polished registry. AgentInstallButtons + InstallSnippet copy with zero feedback; counts unformatted (18420 vs 18k); h1 text-2xl vs registry text-3xl; tooltip-less ScoreBadges. Fix: CopyButton, formatCount, registry ScoreReadout, align heading. Command: /impeccable polish $org/$repo

## Persona Red Flags

Priya (governing platform eng): arrives from registry, hits differently-styled page (trust dip); security + eval are small unexplained badges with no tooltip; run-history/sandbox is what she wants but security rationale is a 3-word badge.

Jordan (first-timer): eight cards, no obvious start; Run in Sandbox sits above Install so the optional power-feature reads as step one; clicks Add to Cursor, nothing happens (silent copy), assumes broken.

Sam (a11y): Live/Offline uses green+icon+text (text saves it); silent copy announces nothing; score badges no tooltip/focus; red error pre relies on color.

Casey (mobile): single-column pile is mobile-friendly but very long; Install far down means scrolling past runner + history to adopt.

## Minor Observations

- compatibleAgents renders in 3 places (header, install buttons, Agent-compatibility card).
- "Discovery metadata / progressive disclosure, name and description only" exposes internal architecture to end users.
- Green Published banner never dismisses.
- <strong>Description:</strong> inline labels are crude vs the Label vocabulary.
- Analytics bars (bg-primary/80) and eval badge are already monochrome/on-doctrine; leave them.

## Questions to Consider

- What is the ONE action this page exists to drive: install or run-in-sandbox? They compete for the top slot.
- Could scattered trust badges (score, eval, security, live) consolidate into one compact trust header under the title?
- Does every section need to be a Card? Reference material could collapse behind disclosure.
