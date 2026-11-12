---
name: sandbox-egress-check
description: Internal platform check that hosted skill sandboxes block outbound traffic they should not allow. Not for agents.
license: MIT
metadata:
  author: skillist
  category: utilities
  tags: internal, platform-check
---

# Sandbox egress check

Internal. `scripts/check-sandbox-egress.sh` publishes this as a private skill and runs it
in both sandboxes after a deploy that touches skill execution. Every line of output is
`PASS` or `FAIL`, and any `FAIL` makes the run exit non-zero.
