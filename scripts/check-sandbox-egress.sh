#!/usr/bin/env bash
set -euo pipefail

# Verifies hosted skill sandboxes block what they should, against a live API.
#
#   SKILLIST_API_KEY=sk_... scripts/check-sandbox-egress.sh <org-slug>
#
# Run it right after any deploy that touches skill execution. It publishes two
# private skills to <org-slug>, one per sandbox, and runs the same checks in each.
# Every line is PASS or FAIL, and the script exits non-zero if anything got out.
#
# If it fails, stop execution first and investigate after:
#   echo true | pnpm --filter @skillist/api exec wrangler secret put SKILL_EXECUTION_DISABLED --config wrangler.production.jsonc

ORG="${1:?usage: scripts/check-sandbox-egress.sh <org-slug>}"
: "${SKILLIST_API_KEY:?SKILLIST_API_KEY must be an sk_ key with publish and execute access to $ORG}"

cd "$(dirname "$0")/.."
pnpm -s cli:build
CLI=(node packages/cli/dist/index.js)

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Same check twice. The heavy copy is renamed (the bundle name must match the repo)
# and forced onto SandboxHeavy with metadata.runtime.
cp -R scripts/sandbox-egress-check "$work/sandbox-egress-check"
cp -R scripts/sandbox-egress-check "$work/sandbox-egress-check-heavy"
heavy="$work/sandbox-egress-check-heavy"
sed -i.bak 's/^name: sandbox-egress-check$/name: sandbox-egress-check-heavy/' "$heavy/SKILL.md" && rm "$heavy/SKILL.md.bak"
node -e '
  const fs = require("node:fs");
  const file = process.argv[1];
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  manifest.name = "sandbox-egress-check-heavy";
  manifest.metadata = { runtime: "container" };
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
' "$heavy/plugin.json"

status=0
for repo in sandbox-egress-check sandbox-egress-check-heavy; do
  echo "== $repo"
  "${CLI[@]}" publish "$ORG/$repo" "$work/$repo"
  "${CLI[@]}" run "$ORG/$repo" --script scripts/egress-check.sh || status=1
done

if [ "$status" -ne 0 ]; then
  echo "EGRESS CHECK FAILED. Turn execution off (see the top of this script), then investigate." >&2
fi
exit "$status"
