# Base image tag MUST match the @cloudflare/sandbox SDK version in
# apps/api/package.json — a mismatch breaks the DO<->container control
# protocol. Bump both together, and rebuild periodically so base-image CVEs
# don't accumulate on this untrusted-code-execution surface.
FROM docker.io/cloudflare/sandbox:0.12.3

# Skillist hosted execution: shell scripts, Node, curl-based audits
RUN npm install -g wrangler@4 typescript tsx 2>/dev/null || true

EXPOSE 8080
