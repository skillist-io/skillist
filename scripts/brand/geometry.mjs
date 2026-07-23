/**
 * Skillist brand constants, defined once.
 *
 * Every brand asset in the repo is generated from what's here plus the
 * committed outlines in wordmark.json, so the favicon, the console badge, the
 * docs logo and the downloadable brand pack can never drift apart.
 *
 * The identity is wordmark-only: SKILLIST set in Inter SemiBold caps at
 * +0.14em tracking — the same equipment-label voice the product labels its
 * switches and readouts with, one step larger. The standalone stamp for the
 * places a word cannot go (favicon, avatar, app icon) is the Bold S knocked
 * out of a squared tile. (Two pictorial marks came before this: a letterform
 * `ill` cut from the middle of the name, retired because a mark that spells
 * "ill" argues with a brand built on trust, and a three-rule list glyph,
 * retired as decoration the wordmark didn't need. Both live in git history.)
 */

/**
 * Fraction of the tile's side the S occupies, by bounding-box height. Matches
 * the ink coverage the old mark had in its tile (glyph 56 / tile 84), so the
 * stamp carries the same visual weight the brand has shipped with.
 */
export const TILE_GLYPH_FRAC = 2 / 3;

/** Reference cap height, in SVG units, that vector assets are scaled to. */
export const CAP = 48;

/**
 * Clear space around the wordmark and the tile: half the cap height on every
 * side, expressed in the unit the type is set in so the rule scales with the
 * asset instead of being a pixel value that goes stale.
 */
export const SAFE_FRAC = 0.5;

/* ── Colour ──────────────────────────────────────────────────────────────
 * DESIGN.md states the palette in OKLCH. Raster formats need sRGB, so rather
 * than hand-copying hex values that will rot the moment a token moves, the
 * conversion happens here from the same OKLCH the stylesheet uses.
 */

function srgbChannel(x) {
  const v = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

/** OKLCH to sRGB hex. Hue in degrees. */
export function oklch(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  return `#${[r, g, bl].map((c) => srgbChannel(c).toString(16).padStart(2, "0")).join("")}`;
}

/** The tokens the brand assets are allowed to use, and nothing else. */
export const INK = oklch(0.145, 0, 0); // foreground, light mode
export const PAPER = oklch(0.985, 0, 0); // foreground, dark mode
export const SIGNAL = oklch(0.52, 0.21, 293); // guide strokes only — the logo carries no colour
export const SIGNAL_DARK = oklch(0.72, 0.19, 293);

/**
 * Ink per asset variant. `light`/`dark` name the *background* the asset is
 * meant to sit on, matching the convention the brand page uses. The wordmark
 * is single-ink by design, so there is no colour/mono split to maintain.
 */
export const VARIANTS = {
  light: { ink: INK },
  dark: { ink: PAPER },
};

/**
 * Inks for the S tile. The tile inverts the page: ink tile with paper glyph on
 * a light ground, paper tile with ink glyph on a dark one, because a
 * near-black tile on a near-black page is not a tile.
 */
export const TILE_VARIANTS = {
  light: { tile: INK, glyph: PAPER },
  dark: { tile: PAPER, glyph: INK },
};
