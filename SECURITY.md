# Security

## Reporting a vulnerability

Email **security@skillist.io**. Please do not open a public issue for anything
exploitable.

Include enough to reproduce it — a request, a skill bundle, a sequence of steps.
If it is sensitive, say so and we will arrange another channel before you send
details.

You should get an acknowledgement within 3 working days. Skillist is run by one
person, so that is a realistic commitment rather than an aspirational SLA. If a
week passes with no reply, assume the mail went astray and chase it.

We will not pursue legal action against anyone acting in good faith under this
policy. There is no bug bounty.

## Scope

In scope:

- `skillist.io`, `console.skillist.io`, `docs.skillist.io`, `api.skillist.io`
- The published packages: `@skillist/cli`, `@skillist/skill-format`
- The MCP server at `api.skillist.io/mcp`

Out of scope:

- Third-party services we build on (Cloudflare, Neon, GitHub, Google) — report
  those to the vendor
- Findings that require a compromised device or a stolen credential you already
  hold
- Volumetric denial of service
- Missing hardening headers with no demonstrated impact

## What runs untrusted code, and how

Skillist executes skill-authored scripts. That is a deliberate product feature,
so the isolation around it is the most interesting part of the attack surface
and worth stating plainly:

- Scripts run in Cloudflare Sandbox containers, never in the Worker.
- Script paths are allow-listed from the published bundle; `..` and absolute
  paths are rejected at validation and again at execution.
- Outbound requests from a sandbox are blocked to loopback, private, link-local,
  CGNAT, and multicast ranges (v4 and v6), including numerically-encoded forms.
- Runs are quota-limited per org and per anonymous caller, with output size and
  wall-clock caps.
- Execution requires authentication. Anonymous users can read public skills but
  cannot run them.

If you find a way out of that, it is exactly what we want to hear about.

## Handling of your data

Covered in the [privacy policy](https://skillist.io/privacy), including what is
stored, for how long, and which processors are involved.

Two things worth repeating here: **API keys are stored hashed** (SHA-256, shown
once at creation), and **skill run output is user data** — whatever a script
prints is persisted and shown back to you, so do not print secrets in a skill.
