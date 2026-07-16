---
name: test-generator
description: Generate meaningful unit and integration tests that cover real behavior, not trivial assertions.
license: MIT
metadata:
  author: skillist
  category: testing
  tags: testing, vitest, jest
  level: mid
---

# Test Generator

Use when adding test coverage for new or changed code.

## When to activate

- New module or API route without tests
- Bug fix that needs a regression test
- User requests test coverage

## Procedure

1. Read the implementation; list inputs, outputs, and edge cases.
2. Test behavior, not implementation details.
3. One assertion theme per test; descriptive test names.
4. Mock external I/O; use real logic for pure functions.
5. Skip tests that only assert mocks or constants.

## Output format

- Test file path
- Cases: happy path, edge cases, error paths
- Any fixtures or setup needed
