---
name: roll-dice
description: Roll virtual dice when users ask for random numbers, tabletop RPG checks, or quick probability demos. Works in any agentskills.io-compatible agent.
license: MIT
compatibility: Cursor, Claude Code, Codex, VS Code Copilot, and other agentskills.io clients
metadata:
  author: skillist
  category: utilities
  level: minimal
---

# Roll Dice

Use this skill when the user wants random dice rolls, RPG checks, or fair random integers.

## When to activate

- User asks to "roll dice", "roll a d20", or "pick a random number in a range"
- Tabletop / RPG session needs ability checks or damage rolls
- Demo or test needs reproducible randomness with visible notation

## Procedure

1. Parse the request into standard dice notation (`NdM` or `NdM+K`).
2. Roll each die independently with uniform random integers in `[1, M]`.
3. Sum results and apply modifiers.
4. Show the breakdown: individual die values, modifier, and total.
5. Offer to roll again or change notation.

## Output format

```
Roll: 2d6+3
Dice: [4, 2] + 3
Total: 9
```

## Constraints

- Use fair randomness; do not bias toward specific outcomes.
- If notation is ambiguous, ask one clarifying question before rolling.
- For cryptographically secure needs, say this skill uses PRNG suitable for games only.

## Examples

- "Roll a d20" → `1d20`
- "Roll 3d8 for fireball damage" → `3d8`
- "Roll 4d6 drop lowest for stats" → roll four d6, remove lowest, sum remaining
