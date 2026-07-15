# Cloudflare bindings checklist

Use when reviewing `wrangler.jsonc` before deploy.

## KV Namespace

```jsonc
"kv_namespaces": [{ "binding": "MY_KV", "id": "<namespace-id>" }]
```

- Binding name must match `env.MY_KV` in code
- Create namespace before deploy: `wrangler kv namespace create`

## R2 Bucket

```jsonc
"r2_buckets": [{ "binding": "MY_BUCKET", "bucket_name": "my-bucket" }]
```

- Bucket must exist in account
- Use `--remote` for production data in dev

## Hyperdrive

```jsonc
"hyperdrive": [{ "binding": "HYPERDRIVE", "id": "<config-id>" }]
```

- `localConnectionString` for `wrangler dev` only
- Production uses Hyperdrive config ID

## Durable Objects

Requires `migrations` tag when adding new classes:

```jsonc
"durable_objects": { "bindings": [{ "name": "HUB", "class_name": "MyHub" }] },
"migrations": [{ "tag": "v1", "new_sqlite_classes": ["MyHub"] }]
```

## Queues

Producer + consumer bindings must reference the same queue name.

## Secrets

Set via `wrangler secret put NAME` — never commit to config.
