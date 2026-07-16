---
name: stripe-integration
description: Integrate Stripe payments — Checkout Sessions, webhooks, Connect, and idempotent API patterns.
license: MIT
metadata:
  author: skillist
  category: payments
  tags: stripe, payments, billing
  level: full
---

# Stripe Integration

Use when implementing or debugging Stripe payments, subscriptions, or Connect.

## When to activate

- Adding checkout or billing
- Webhook handler implementation
- Connect marketplace payouts

## Procedure

1. Prefer Checkout Sessions for simple flows; PaymentIntents for custom UI.
2. Verify webhooks with signing secret; handle events idempotently.
3. Store Stripe customer/subscription IDs — never card data.
4. Use test mode keys in development; document required env vars.
5. Log event IDs, not full payment method details.

## Output format

- Integration pattern recommendation
- Required env vars and dashboard setup
- Webhook events to handle
- Test card numbers for verification
