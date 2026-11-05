# E2E tests

Production smoke tests run against `https://skillist.dev` by default.

## Anonymous tests (`smoke.spec.ts`)

Always run in CI: homepage, registry, login guards, registry retry UI.

## Signed-in tests (`authenticated.spec.ts`)

Require a Playwright storage state file. Generate locally:

```bash
pnpm exec playwright open --save-storage=tests/e2e/.auth/user.json https://skillist.dev/login
```

Sign in with GitHub or Google, then close the browser.

Export for GitHub Actions:

```bash
./scripts/export-e2e-auth-state.sh
# validate, then push:
./scripts/setup-e2e-secrets.sh
```

`setup-e2e-secrets.sh` validates the session against production before uploading. Re-export if auth expires.

Add the output as repository secret `E2E_AUTH_STATE_B64`. CI runs authenticated tests when the secret is set.

## Optional API key smoke

Set `SKILLIST_E2E_API_KEY` for authenticated CLI/API checks in `tests/smoke/cli.test.ts`.
