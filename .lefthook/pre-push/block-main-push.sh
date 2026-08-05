#!/bin/sh
# GitHub's enforced branch protection needs Pro on private repos, so the
# PR-only flow for main is enforced client-side. Git feeds pre-push one
# "<local_ref> <local_sha> <remote_ref> <remote_sha>" line per ref being
# pushed, which also catches `git push origin HEAD:main` from a feature
# branch — not just pushing while main is checked out.
# Deliberate bypass: git push --no-verify.
while read -r local_ref local_sha remote_ref remote_sha; do
  if [ "$remote_ref" = "refs/heads/main" ]; then
    echo "Direct pushes to main are blocked — open a PR instead (bypass: git push --no-verify)." >&2
    exit 1
  fi
done
exit 0
