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
 * places a word cannot go (favicon, avatar, app icon) is the socket (see
 * SOCKET_FRAC and socketTiles below). (Marks that came before this, all in git
 * history: a letterform `ill` cut from the middle of the name, retired because
 * a mark that spells "ill" argues with a brand built on trust; a three-rule
 * list glyph, retired as decoration the wordmark didn't need; and a Bold S
 * stamp, replaced by the socket — its outline stays in wordmark.json.)
 */

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
 * Inks for the stamp tile. The tile inverts the page: ink tile with paper glyph
 * on a light ground, paper tile with ink glyph on a dark one, because a
 * near-black tile on a near-black page is not a tile.
 */
export const TILE_VARIANTS = {
  light: { tile: INK, glyph: PAPER },
  dark: { tile: PAPER, glyph: INK },
};

/* ── The socket stamp ──────────────────────────────────────────────────────
 * The standalone mark for the places a word cannot go — favicon, app icon,
 * avatar. Four congruent L corner-tiles framing an empty centre: the tiles are
 * the registry, the socket is the slot the next skill drops into. It replaces
 * the earlier Bold-S stamp (retained in wordmark.json for git history).
 *
 * The figure is built on two mirror axes, never rotation. An earlier draft
 * pinwheeled the four tiles around the void; four arms hooking the same way is
 * the swastika topology, so the tiling was reflected instead of rotated. The
 * result is a stable aperture that reads the same flipped either way.
 *
 * Knocked into the filled tile in the glyph ink, exactly as the S was: the four
 * brackets take the glyph colour and the socket + seams fall back to the tile
 * colour, so on light it reads as a paper aperture cut into an ink square.
 */

/** Active square (the mark's own bounds) as a fraction of the tile side. The
 * remainder is the tile's built-in clear space, a touch tighter than the S so
 * the ring reads as a bold aperture rather than a thin frame floating in field. */
export const SOCKET_FRAC = 0.72;
/** Socket side as a fraction of the active square (12/32 on the reference grid).
 * This also fixes the arm thickness, since arm = (active − socket) / 2. */
export const SOCKET_VOID_FRAC = 0.375;
/** Transparent seam width as a fraction of the active square (1.6/32). Below
 * ~20px it closes up and the mark reads as a plain aperture, which is fine. */
export const SOCKET_SEAM_FRAC = 0.05;

/**
 * The eight rects (four L-tiles, two rects each) that make up the socket at a
 * given tile size. Returned as geometry so the generator can paint them in any
 * ink; the socket + seams are simply the tile ground left unpainted.
 */
export function socketTiles(size) {
  const active = size * SOCKET_FRAC;
  const c = size / 2;
  const a0 = c - active / 2; // active square, near edge
  const a1 = c + active / 2; // active square, far edge
  const t = (active * (1 - SOCKET_VOID_FRAC)) / 2; // arm thickness
  const gap = (active * SOCKET_SEAM_FRAC) / 2; // half the seam width
  const near = c - gap; // where an arm stops before the centre seam
  const far = c + gap; // where the opposite arm resumes after it
  return [
    // top-left tile
    { x: a0, y: a0, w: near - a0, h: t },
    { x: a0, y: a0, w: t, h: near - a0 },
    // top-right tile
    { x: far, y: a0, w: a1 - far, h: t },
    { x: a1 - t, y: a0, w: t, h: near - a0 },
    // bottom-right tile
    { x: far, y: a1 - t, w: a1 - far, h: t },
    { x: a1 - t, y: far, w: t, h: a1 - far },
    // bottom-left tile
    { x: a0, y: a1 - t, w: near - a0, h: t },
    { x: a0, y: far, w: t, h: a1 - far },
  ];
}

/** Below ~28px the seams turn to grey mush and the four tiles smear together, so
 * small renders (the favicon, the 16px .ico layer) take the socket with its
 * seams removed: a plain square aperture. Same outer bounds and same socket as
 * the full mark — literally the socket minus its seams — so it stays on-family.
 * Returned as the outer square and the hole; paint with fill-rule evenodd. */
export const SOCKET_MIN_PX = 28;
export function socketAperture(size) {
  const active = size * SOCKET_FRAC;
  const hole = active * SOCKET_VOID_FRAC;
  const c = size / 2;
  return {
    outer: { x: c - active / 2, y: c - active / 2, side: active },
    hole: { x: c - hole / 2, y: c - hole / 2, side: hole },
  };
}
