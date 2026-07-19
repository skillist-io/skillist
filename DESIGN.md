---
name: Skillist
description: Realtime registry and control surface for Agent Skills.
colors:
  ink: "oklch(0.145 0 0)"
  surface: "oklch(1 0 0)"
  raised: "oklch(0.97 0 0)"
  muted-ink: "oklch(0.556 0 0)"
  hairline: "oklch(0.922 0 0)"
  primary: "oklch(0.205 0 0)"
  primary-ink: "oklch(0.985 0 0)"
  ring: "oklch(0.708 0 0)"
  destructive: "oklch(0.577 0.245 27.325)"
  signal: "oklch(0.52 0.21 293)"
  signal-dark: "oklch(0.72 0.19 293)"
  ink-dark: "oklch(0.985 0 0)"
  surface-dark: "oklch(0.145 0 0)"
  raised-dark: "oklch(0.205 0 0)"
  muted-ink-dark: "oklch(0.708 0 0)"
  destructive-dark: "oklch(0.704 0.191 22.216)"
typography:
  display:
    fontFamily: "Inter Variable, system-ui, sans-serif"
    fontSize: "clamp(2.25rem, 5vw, 3rem)"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Inter Variable, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Inter Variable, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
  body:
    fontFamily: "Inter Variable, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: "Inter Variable, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.1em"
  mono:
    fontFamily: "Geist Mono Variable, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  square: "0px"
  base: "0.625rem"
spacing:
  field: "1.25rem"
  card: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-ink}"
    rounded: "{rounded.square}"
    typography: "{typography.label}"
    padding: "0 1.5rem"
    height: "2.5rem"
  button-primary-hover:
    backgroundColor: "oklch(0.205 0 0 / 0.8)"
    textColor: "{colors.primary-ink}"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.square}"
    typography: "{typography.label}"
    height: "2.5rem"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.square}"
    typography: "{typography.label}"
  badge-default:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.square}"
    typography: "{typography.label}"
    padding: "0"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.square}"
    padding: "{spacing.card}"
  input:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.square}"
    height: "2.5rem"
    padding: "0"
---

# Design System: Skillist

## 1. Overview

**Creative North Star: "The Control Surface"**

Skillist is an instrument panel for production agent behavior. It looks the way a well-built piece of engineering hardware looks: monochrome, squared, precisely ruled, nothing on the surface that isn't a control or a readout. The people using it are staking production agents on the skills catalogued here, so the interface earns trust the way an instrument does, by being legible, honest about state, and free of decoration that could be mistaken for meaning.

The system is deliberately quiet. Hierarchy comes from scale, weight, and space, not from color or heavy borders. Chrome is treated as a cost: surfaces are flat with a single hairline ring, depth is implied rather than dramatized, and the two chromatic voices on screen (destructive red for failure, a violet signal for live/realtime) each mean exactly one thing. Labels are set in small uppercase with wide tracking, the way switches and ports are labeled on real equipment. This is an information-dense product that still reads as calm because every element is squared to the same grid and speaks in the same restrained voice.

It explicitly rejects four things. It is not the **generic shadcn / AI-default** look it started from (rounded cards, soft grays, a decorative purple accent). It is not **playful / consumer / rounded** (no bubbly radii, no emoji, no illustration). It is not a **cluttered enterprise dashboard** (density without hierarchy, gray-on-gray tables, heavy chrome). And it is not **loud SaaS marketing** (gradient heroes, glassmorphism, hero-metric templates). Dense is welcome; cluttered is forbidden.

**Key Characteristics:**
- Monochrome by default; grayscale ink ramp carries the entire UI.
- Squared geometry everywhere (0px radius on controls, cards, and images) — avatars are the single exception.
- Sentence-case, medium-weight labels on buttons and nav; uppercase wide-tracked micro-labels reserved for badges, eyebrows, and status/readouts.
- Underline inputs, not boxed fields.
- Hairline rings instead of shadows; flat at rest.
- One signal accent (violet) for live/realtime and active state, used sparingly (≤10% of any screen).

## 2. Colors

A pure grayscale ink ramp from paper-white to near-black, plus exactly two committed chromatic voices: destructive red for failure and signal violet for live/realtime.

### Primary
- **Ink** (`oklch(0.145 0 0)`): The near-black foreground. All primary text, icon strokes, and the fill of primary buttons (as `Primary`, `oklch(0.205 0 0)`). This is the darkest voice and the default for anything that must be read first.
- **Primary Ink** (`oklch(0.985 0 0)`): Paper-white text that sits on the dark primary fill (button labels) and becomes the foreground in dark mode.

### Neutral
- **Surface** (`oklch(1 0 0)` light / `oklch(0.145 0 0)` dark): The base canvas and card background. In light mode it is literal white, not a warm-tinted near-white; the calm comes from restraint, not from cream.
- **Raised** (`oklch(0.97 0 0)` light / `oklch(0.205 0 0)` dark): Secondary and muted fills, hover washes, and inset panels. The only step between surface and hairline.
- **Muted Ink** (`oklch(0.556 0 0)` light / `oklch(0.708 0 0)` dark): Secondary text, captions, and inactive labels. Held light enough to recede but dark enough to clear 4.5:1 on surface; never lighter than this for body-length text.
- **Hairline** (`oklch(0.922 0 0)` light / `oklch(1 0 0 / 10%)` dark): Borders, dividers, and the 1px card ring. The primary structural device in a system with almost no shadow.
- **Ring** (`oklch(0.708 0 0)`): Focus indication, distinct from hairline so keyboard focus is unmistakable.

### Tertiary
- **Destructive** (`oklch(0.577 0.245 27.325)` light / `oklch(0.704 0.191 22.216)` dark): One of the two chromatic voices — the color of failure. Deletion, failed evals, error state, invalid fields. Its rarity is what makes it legible.
- **Signal** (`oklch(0.52 0.21 293)` light / `oklch(0.72 0.19 293)` dark): A deliberate violet (hue ~293), the one chromatic voice for **live / realtime** moments — publish fan-out, presence, a running eval, active/selected state. This is a specific, committed violet used narrowly and on purpose; it is not the generic shadcn *default* purple (a scattered, decorative blue-violet ~264) the system rejects. Do not scatter it; it stays ≤10% of any screen.

### Named Rules
**The Chromatic Voice Rule.** In normal operation the screen is grayscale plus at most two saturated voices: **destructive red** (failure) and the **signal violet** (live/realtime, ≤10%). Any other hue is a bug — including the generic default purple (`oklch(0.488 0.243 264.376)`), a different, decorative blue-violet that must not appear. The signal violet is the *only* sanctioned violet, and only for live/active state.

**The Literal White Rule.** Light surface is exactly `oklch(1 0 0)`. Never warm-tint the background toward cream, sand, or paper. Color on screen lives in the two signals (red, violet), never in the canvas.

## 3. Typography

**Display Font:** Inter Variable (with system-ui, sans-serif fallback)
**Body Font:** Inter Variable (same family, weight-differentiated)
**Mono Font:** Geist Mono Variable (SIL OFL 1.1, self-hosted, falling back to ui-monospace, SFMono-Regular, Menlo) for values and code

**Character:** One *proportional* family, worked across weight and case, plus one mono companion. Inter's neutrality is the point: it disappears, letting numbers, IDs, and status do the talking. The mono pairing is functional rather than decorative — it is the Machine-Voice Rule made literal, so a reader can tell at a glance whether a human or a machine is speaking. That is the only sanctioned reason to add a face; a second *proportional* family remains prohibited. Hierarchy is built from a ≥1.25 scale ratio and a hard weight jump (400 body → 600 labels → 700 display), plus the uppercase/tracked treatment on the smallest labels.

**Tracking rides size.** The larger the type, the tighter it is set, so the display steps sit on one optical curve instead of sharing a flat value (hero -0.035em → display -0.025em → headline -0.01em → body normal). Uppercase micro-labels invert this and take positive tracking (+0.1em); at small sizes and in caps, letterforms need air, not compression.

### Hierarchy
- **Hero** (700, `clamp(2.5rem, 5.5vw, 4rem)`, 1.02, -0.035em): The landing hero headline, and nothing else. This is the one place the system is allowed to raise its voice, because a first-time visitor has no other cue. **Marketing surface only** — it must never appear in the console. Use `text-wrap: balance`.
- **Display** (700, `clamp(2.25rem, 5vw, 3rem)`, 1.05, -0.025em): Page headings everywhere else, including every product page. Capped at ~3rem; inside the product this system states, it doesn't shout. Use `text-wrap: balance`.
- **Headline** (600, 1.125rem, 1.3): Section and card titles.
- **Title** (600, 1rem, 1.4): Sub-section headings, list group headers.
- **Body** (400, 0.875rem, 1.55): Default running text, descriptions, table cells. Cap prose measure at 65–75ch.
- **Label** (600, 0.75rem, tracking 0.1em, UPPERCASE): Badges, eyebrows, status, and control captions. This is the signature voice, borrowed from equipment labeling. **Not** buttons or nav — those are sentence-case, medium-weight (see Buttons).
- **Mono** (400, 0.75rem): Skill IDs, version hashes, eval values, `SKILL.md` snippets. Anything a machine emitted is set in mono.

### Named Rules
**The Equipment-Label Rule.** Uppercase + wide tracking is reserved for short labels (≤4 words): badges, section eyebrows, status, and control captions. **Buttons and nav are sentence-case, medium-weight** (a deliberate hybrid — the interactive elements read clean while the readouts keep the instrument voice). Never set a sentence or body copy in all caps; at reading length it becomes unreadable.

**The Machine-Voice Rule.** Any literal machine value (id, hash, path, JSON) is set in mono. Human prose is never mono; machine output is never proportional. The typeface tells you who is speaking.

## 4. Elevation

This system is flat by conviction. It uses tonal layering and a single hairline ring, not shadows, to convey structure. Cards sit on the surface with a `ring-1` at `oklch(0.145 0 0 / 0.05)` (foreground at 5%) and at most a `shadow-sm`; there is no ambient drop shadow, no lifted card, no glow. Depth reads from the hairline and from the raised-vs-surface tonal step, the way panels on an instrument are inset rather than floated.

### Shadow Vocabulary
- **Hairline ring** (`box-shadow: 0 0 0 1px oklch(0.145 0 0 / 0.05)` / `ring-1 ring-foreground/5`): The default and near-only elevation device. Defines a card's edge without weight.
- **shadow-sm** (`box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05)`): The maximum. Used sparingly on cards and popovers; anything heavier is out of register.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest. If you reach for a shadow larger than `shadow-sm`, stop: the answer is a hairline, a tonal step, or nothing. Floating, lifted, and glowing cards are prohibited.

## 5. Components

### Buttons
- **Shape:** Squared, no radius (`rounded-none`, 0px). A 1px transparent border reserves space so outline and filled variants share a footprint.
- **Primary:** Ink fill (`oklch(0.205 0 0)`) with paper-white label, `height: 2.5rem`, `padding: 0 1.5rem`, **sentence-case, medium weight (0.875rem)** — not uppercase. Hover shifts the fill opaquely (`color-mix` toward background ~16%), never an opacity fade.
- **Hover / Focus:** `active:translate-y-px` for a physical press; focus shows a 2px `ring/30` plus a `ring`-colored border. Transitions are `transition-all` at the default duration, transform + opacity only.
- **Outline / Ghost / Secondary:** Outline uses a hairline border on transparent, hover fills with `raised`. Ghost is chromeless until hover (`raised` wash). Secondary is a `raised` fill. Destructive is a translucent red wash (`destructive/10`), not a solid red block. Link is underlined ink.

### Badges
- **Style:** Text-only. No fill, no border, no pill (`rounded-none border-0 bg-transparent px-0`). Set in the smallest label (0.625rem, uppercase, tracking-widest, weight 600).
- **State:** Meaning comes from the word plus an optional inline SVG icon, and from ink-vs-muted color, never from a colored background chip. Status (running / failed / stale) pairs a word with a shape or icon, never color alone.

### Cards / Containers
- **Corner Style:** Squared (`rounded-none`, 0px), including images inside them.
- **Background:** `surface`; nested content that needs separation uses `raised`, never a second card.
- **Shadow Strategy:** Hairline ring + `shadow-sm` only (see Elevation).
- **Border:** The ring is the border. No additional heavy stroke.
- **Internal Padding:** Generous and consistent, `2rem` (`--card-spacing`), tightening to `1.25rem` at `data-size=sm`. The roominess is what keeps density calm.

### Inputs / Fields
- **Style:** Underline only. Transparent background, no side or top border, bottom border in `hairline` (`border-b-input`), `px-0`, `height: 2.5rem`. Fields read as ruled lines on paper, not boxes.
- **Focus:** The bottom border shifts to `ring`; no glow, no box-shadow. Motion is a color transition on the border only.
- **Error / Disabled:** Invalid shifts the bottom border to `destructive`; disabled drops to 50% opacity with `cursor-not-allowed`.

### Navigation
- **Style:** A sidebar app-shell for the product surface, a slim sticky top bar (`h-14`, `bg-card/80 backdrop-blur`, hairline bottom border) for public pages. Nav items are ghost buttons; active state is a `raised` wash plus ink text, never an underline or colored bar.
- **Mobile:** The sidebar collapses to a sheet; the top bar keeps the wordmark and a compact action set.

### Signature Component — Status & Eval Readouts
The product's distinctive surfaces are its live readouts: eval panels, run history, analytics bars, and score badges. These are the "instruments." Set values in mono, label them in uppercase micro-labels, keep charts grayscale (`chart-1…5` are all chroma 0), let the single destructive red mark failure, and let the signal violet mark live/active state. A readout should look like a gauge, not a marketing stat.

## 6. Do's and Don'ts

### Do:
- **Do** keep geometry squared: 0px radius on buttons, badges, cards, and images. The `base` radius token (0.625rem) exists for third-party primitives only; the Skillist voice is square. **Avatars are the one exception and are round** — they depict a person rather than a control or a readout, a squared portrait reads as an ID-badge mugshot, and the roundness is what tells an avatar apart from every other small square on screen at a glance.
- **Do** build hierarchy from scale, weight, and space (400 → 600 → 700), then a hairline, then tonal layering. Reach for color last.
- **Do** set every machine value (skill id, version hash, path, JSON, eval number) in mono, and every short control label in uppercase tracked micro-type.
- **Do** hold the surface at literal white `oklch(1 0 0)` in light mode and near-black `oklch(0.145 0 0)` in dark; both themes must pass 4.5:1 for body text.
- **Do** use the signal violet only for live/realtime and active/selected state, and cap it at ≤10% of any screen.
- **Do** pair every status with a word or shape, and give every animation a `prefers-reduced-motion: reduce` fallback.
- **Do** confine ambient motion to surfaces you pass *through* — the marketing hero, the registry header, sign-in. The authenticated workspace gets the same grid as a **static** texture. Two reasons, and the first is the serious one: perpetual signal-violet motion spends the accent on decoration, so a real fan-out ends up competing with wallpaper for the same colour and the signal stops meaning anything. Second, a surface read for hours pays the attention cost on every screen, and indefinitely-running motion is exactly what WCAG 2.2.2 (Pause, Stop, Hide) targets — `prefers-reduced-motion` is the floor, not the answer.

### Don't:
- **Don't** ship the **generic shadcn / AI-default** look: no soft rounded cards, no *decorative* / scattered purple (delete the stray dark-sidebar `oklch(0.488 0.243 264.376)`) — the only sanctioned violet is the signal, used for live/active state, no gray-on-tinted body text.
- **Don't** drift **playful / consumer / rounded**: no bubbly radii, no emoji-forward UI, no illustration where a control belongs.
- **Don't** become a **cluttered enterprise dashboard**: no heavy borders, no gray-on-gray tables without hierarchy, no density for its own sake. Roomy padding stays.
- **Don't** dress up like **loud SaaS marketing**: no gradient heroes, no `background-clip: text` gradient headings, no glassmorphism (the one `backdrop-blur` on the top bar is the only sanctioned use), no hero-metric template.
- **Don't** use a shadow larger than `shadow-sm`, a colored background chip for a badge, or a boxed input; those are the three fastest ways off-register.
- **Don't** encode status in color alone, set body copy in all caps, or introduce a second *proportional* typeface. One proportional family worked hard, plus the mono companion for machine output — nothing else.
