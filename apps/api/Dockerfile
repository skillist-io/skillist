# The sandbox-shim tag MUST match the @cloudflare/sandbox version in
# apps/api/package.json. `pnpm check:catalog` enforces it. Rebuild periodically so
# base-image CVEs don't accumulate on this untrusted-code-execution surface.
FROM node:24-trixie-slim

# Skillist hosted execution: shell scripts, Node, Python, curl-based audits.
# ca-certificates is required: the HTTPS egress intercept extends its bundle.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g wrangler@4 typescript tsx

COPY --from=docker.io/cloudflare/sandbox:1.0.3 /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim

WORKDIR /workspace
CMD ["sleep", "infinity"]
