# Deploy runbook

## Preview deploy

1. `wrangler deploy --config wrangler.jsonc` (preview worker name)
2. Curl health endpoint
3. Check Cloudflare dashboard → Workers → Logs

## Production deploy

1. Run `scripts/preflight.sh wrangler.production.jsonc`
2. Run `scripts/validate-config.sh wrangler.production.jsonc`
3. `wrangler deploy --dry-run --config wrangler.production.jsonc`
4. `wrangler deploy --config wrangler.production.jsonc`
5. Smoke test custom domain
6. Monitor errors for 15 minutes

## Rollback

- Redeploy previous git tag with known-good config
- Or route traffic to previous Worker version in dashboard

## CI pattern

```yaml
- run: wrangler deploy --config wrangler.production.jsonc
  env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```
