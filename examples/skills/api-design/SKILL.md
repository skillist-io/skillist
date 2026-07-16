---
name: api-design
description: Design REST and RPC APIs with consistent naming, versioning, error shapes, and OpenAPI documentation.
license: MIT
metadata:
  author: skillist
  category: development
  tags: api, design, openapi
  level: mid
---

# API Design

Use when designing or reviewing HTTP APIs, route naming, or OpenAPI specs.

## When to activate

- New endpoint or resource design
- API consistency review
- Error response standardization

## Procedure

1. Model resources as nouns; use HTTP verbs for actions.
2. Version via URL prefix (`/v1/`) or header — pick one and document it.
3. Use consistent error envelope: `{ error, code, details? }`.
4. Paginate list endpoints with `page`, `limit`, `total`.
5. Document with OpenAPI; include examples for success and error cases.

## Output format

- Resource diagram or route table
- Example request/response payloads
- Breaking-change notes if versioning
