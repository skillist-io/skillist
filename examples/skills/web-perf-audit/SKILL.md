---
name: web-perf-audit
description: Audit web application performance using Core Web Vitals, Lighthouse-style checks, and actionable remediation steps. Includes scripts and reference thresholds for LCP, INP, and CLS.
license: MIT
compatibility: Cursor, Claude Code, VS Code Copilot — requires Node.js 20+ and optional Chrome for local audits
metadata:
  author: skillist
  category: performance
  level: mid
---

# Web Performance Audit

Systematically measure and improve web performance using bundled scripts and reference docs.

## When to activate

- User asks to improve page speed, Core Web Vitals, or Lighthouse scores
- Before a production launch or after a large frontend change
- When investigating LCP, INP, CLS, TBT, or bundle size regressions

## Workflow

1. **Baseline** — Run `scripts/collect-metrics.sh` against the target URL (or use DevTools if unavailable).
2. **Compare** — Load `references/core-web-vitals.md` and `references/thresholds.md` to classify pass/advisory/fail.
3. **Diagnose** — Identify top offenders: render-blocking CSS/JS, large images, layout shifts, long tasks.
4. **Recommend** — Produce a prioritized fix list with estimated impact (high/medium/low).
5. **Verify** — Re-run metrics after changes; report delta vs baseline.

## Progressive disclosure

- Start with discovery metadata only until the user confirms a URL or repo.
- Load `references/core-web-vitals.md` when explaining metric definitions.
- Run scripts only when the user wants automated collection.

## Output template

```markdown
## Performance audit — {url}

| Metric | Value | Rating |
|--------|-------|--------|
| LCP    | …     | …      |
| INP    | …     | …      |
| CLS    | …     | …      |

### Top issues
1. …
2. …

### Recommended fixes
1. …
```

## Safety

- Do not run audits against URLs the user does not own without permission.
- Scripts are read-only against public URLs; they do not modify remote systems.
- Redact auth tokens and cookies from any logged output.

## Bundled resources

- `scripts/collect-metrics.sh` — fetch timing headers and basic vitals proxies
- `scripts/parse-har-summary.js` — summarize a HAR export if provided
- `references/core-web-vitals.md` — metric definitions
- `references/thresholds.md` — good / needs improvement / poor bands
