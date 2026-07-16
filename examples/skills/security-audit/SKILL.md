---
name: security-audit
description: Audit code changes for common vulnerabilities — injection, XSS, auth gaps, and secret exposure.
license: MIT
metadata:
  author: skillist
  category: security
  tags: security, audit, owasp
  level: full
---

# Security Audit

Use when reviewing PRs, auth flows, or user-input handling for security issues.

## When to activate

- Pre-merge security review
- New auth or payment integration
- User reports suspicious behavior

## Procedure

1. Trace all user-controlled input to sinks (SQL, shell, HTML, redirects).
2. Verify auth checks on every mutating endpoint.
3. Check for hardcoded secrets and overly broad CORS.
4. Flag missing rate limits on sensitive actions.
5. Map findings to OWASP categories when applicable.

## Output format

| Severity | Location | Issue | Remediation |
|----------|----------|-------|-------------|
