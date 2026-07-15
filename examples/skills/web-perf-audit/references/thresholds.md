# Performance thresholds

Use these bands when rating audit results (field data preferred over lab).

| Metric | Good | Needs improvement | Poor |
|--------|------|-------------------|------|
| LCP    | ≤ 2.5s | 2.5s – 4.0s | > 4.0s |
| INP    | ≤ 200ms | 200ms – 500ms | > 500ms |
| CLS    | ≤ 0.1 | 0.1 – 0.25 | > 0.25 |
| TTFB   | ≤ 800ms | 800ms – 1.8s | > 1.8s |

## Priority order for fixes

1. LCP image/font optimization and server response time
2. INP — reduce main-thread long tasks and defer non-critical JS
3. CLS — reserve space for images/ads, avoid inserting content above existing UI
