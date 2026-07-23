# Product

## Register

product

> Skillist spans two surfaces that matter equally, now shipped as two apps: the authenticated **product** tool `apps/console` (console.skillist.io — dashboard, governance, registry management, observability, feedback inbox) and a public **brand** surface `apps/web` (skillist.io — landing + registry discovery). The default above is `product` because the daily-driver is the management tool and it holds the center of gravity. Treat the marketing/registry-discovery pages as a co-equal brand register and override per task (`/impeccable craft landing`, etc.) when working on them. The two share one design system (`packages/ui`) and must stay visibly one system.

## Users

Three audiences, weighted toward the product tool:

- **Skill authors** (individual engineers and AI builders) — write, version, and publish `SKILL.md` bundles for their agents (Claude Code, Cursor, VS Code, any agentskills.io client). Context: focused authoring sessions, iterating on a skill and watching it deliver.
- **Governing teams** (platform / AI-infra) — curate an org catalog: set required skills, review agent/human feedback, run evals, watch observability. Context: they are accountable for what production agents do; they need to see state and act on it deliberately.
- **Registry consumers** — browse the public registry to discover and install skills via CLI or MCP. Context: evaluation and trust before adoption.

The primary job across all three: **manage the lifecycle of agent skills with confidence** — publish, version, govern, and deliver — knowing exactly what state each skill is in.

## Product Purpose

Skillist is a realtime registry and management plane for Agent Skills, compliant with the agentskills.io spec. It stores, versions, evaluates, and delivers `SKILL.md` bundles with sub-10ms edge fan-out, and closes the loop with AI-drafted improvements from approved feedback.

It exists because agent skills are becoming production infrastructure — they change what an agent does — and there was no dependable place to author, govern, and deliver them. Success looks like: an author ships a version and sees it live instantly; a governing team trusts the catalog enough to make skills required; a consumer installs from the registry without second-guessing quality.

## Brand Personality

**Precise, technical, calm.** Engineering-grade restraint: the interface is quiet so the information is loud. Confidence comes from clarity and truthful state, not decoration. Terminal-adjacent seriousness without coldness — legible, deliberate, and fast. Voice is specific and direct: name the thing, say what happened, show the real value.

Directional references (the *specific* quality to borrow): Linear (density that stays calm, motion that clarifies), Vercel (restraint and typographic confidence), Warp (technical surfaces that feel modern, not retro). Borrow their composure and information discipline, not their exact palettes.

## Anti-references

Explicitly avoid all four:

- **Generic shadcn / AI-default.** The current stock grayscale-neutral + Inter + *default*-purple-accent look — a scattered, decorative blue-violet with no committed identity; that is the thing to leave behind. (Distinct from Skillist's **signal violet**, a deliberate live/realtime accent used narrowly at ≤10% — see DESIGN.md.)
- **Playful / consumer / rounded.** Bubbly illustrations, oversized rounded cards, emoji-forward, gamified. Too casual for infrastructure people stake production on.
- **Cluttered enterprise dashboard.** Legacy-admin density: heavy borders, cramped gray-on-gray tables, no hierarchy (old Jira / SAP). Dense is fine; cluttered is not.
- **Loud SaaS marketing.** Gradient heroes, decorative glassmorphism, hero-metric templates, buzzword copy. The brand surface earns attention through substance, not spectacle.

## Design Principles

1. **Practice what you preach.** A platform for crafting skills must itself be exceptionally crafted. Every surface is evidence that the people who built this care about the details.
2. **Truthful state over reassurance.** Show real status — published, running, failed, stale eval, pending approval — plainly and immediately. Governance requires trust, and trust requires never hiding or prettifying the actual state.
3. **Restraint is the aesthetic.** Chrome is a cost. Hierarchy comes from scale, weight, and space before color or borders. When in doubt, remove. One committed brand signal beats five decorations.
4. **Realtime made legible.** The product's edge is that things happen live (sub-10ms fan-out, presence, eval results). Motion and updates should make that legibility a felt quality, never a gimmick, and never at the expense of calm.
5. **One system, two registers.** The marketing surface and the tool are the same brand seen from two distances. A visitor who converts on the landing should recognize the exact same identity inside the app. The landing hero is the one sanctioned divergence: it sits on the near-black ground in both themes, because it is the only surface with no prior context and it has to show realtime fan-out, which needs a dark room to read. The identity carrying across is the wordmark and its socket mark, the type, the squared geometry, and the two chromatic voices — not the canvas. See DESIGN.md, *The Dark Hero Exception*.

## Accessibility & Inclusion

Target **WCAG 2.2 AA**:

- Body text ≥4.5:1 contrast (≥3:1 for large/bold text); placeholder text held to the same 4.5:1 — no washed-out muted gray on tinted backgrounds.
- Full keyboard navigation with visible, high-contrast focus states; this is a developer tool, so keyboard operability is first-class, not an afterthought.
- Both light and dark themes are supported and must each pass contrast (the app already ships a theme toggle).
- Every animation has a `prefers-reduced-motion: reduce` alternative (crossfade or instant).
- Don't encode meaning in color alone (status, eval pass/fail): pair with text, icon, or shape for color-vision accessibility.
