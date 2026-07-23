#!/usr/bin/env node
/**
 * Generate every Skillist brand asset from one geometry definition.
 *
 *   pnpm brand:assets
 *
 * Writes the wordmark, the S-tile stamp, safe-area guides, favicons and the
 * apple touch icon into apps/web, apps/console and apps/docs, plus a brand pack
 * under apps/web/public/brand that the /brand page serves for download.
 *
 * The wordmark is real outline data — SKILLIST in Inter SemiBold caps at
 * +0.14em tracking, extracted from the exact woff2 the apps self-host and
 * committed to scripts/brand/wordmark.json (which also carries the Bold S the
 * tile uses). Shipping a logo as live <text> would mean anyone without Inter
 * installed downloads a different logo than the one we drew.
 */

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import {
  CAP,
  INK,
  PAPER,
  SAFE_FRAC,
  SIGNAL,
  TILE_GLYPH_FRAC,
  TILE_VARIANTS,
  VARIANTS,
} from "./brand/geometry.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const wordmark = JSON.parse(readFileSync(join(ROOT, "scripts/brand/wordmark.json"), "utf8"));

const round = (n) => Number.parseFloat(n.toFixed(3));

/* ── Wordmark ──────────────────────────────────────────────────────────── */

/**
 * Font units are y-up with the baseline at zero; SVG is y-down. The wordmark is
 * therefore emitted as a group that flips and scales in one transform, so the
 * committed path data stays exactly as the font drew it.
 */
function wordmarkGroup(ink, { x, scale, baseline }) {
  const t = `translate(${round(x)} ${round(baseline)}) scale(${round(scale)} ${round(-scale)})`;
  const body = wordmark.word
    .map((p) => `    <path d="${p.d}" transform="translate(${round(p.dx)} 0)"/>`)
    .join("\n");
  return `  <g fill="${ink}" transform="${t}">\n${body}\n  </g>`;
}

/**
 * Layout of the standalone wordmark, scaled so the cap height lands on the
 * reference CAP. The box is the ink's own bounds — the S overshoots the cap
 * line a whisker in both directions, and clipping it would shave the curves.
 */
function wordmarkLayout() {
  const [fx0, fy0, fx1, fy1] = wordmark.bbox;
  const scale = CAP / wordmark.capHeight;
  const baseline = fy1 * scale; // ink top sits at y = 0
  return {
    scale,
    x: -fx0 * scale,
    baseline,
    width: (fx1 - fx0) * scale,
    height: (fy1 - fy0) * scale,
  };
}

function logoSvg(variant) {
  const { ink } = VARIANTS[variant];
  const { scale, x, baseline, width, height } = wordmarkLayout();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${round(width)} ${round(
    height,
  )}" width="${round(width)}" height="${round(height)}" fill="none" role="img" aria-label="Skillist">
${wordmarkGroup(ink, { x, scale, baseline })}
</svg>
`;
}

/* ── The S tile ────────────────────────────────────────────────────────── */

/**
 * The Bold S centred in a filled square: the stamp for every surface where the
 * word cannot go — favicon, app icon, avatar. Bold rather than the wordmark's
 * SemiBold because a lone glyph carries less area than a word and reads a step
 * lighter than the same weight in running text.
 */
function tileArtwork(size, { tile, glyph }, { radius = 0 } = {}) {
  const [sx0, sy0, sx1, sy1] = wordmark.mark.bbox;
  const scale = (size * TILE_GLYPH_FRAC) / (sy1 - sy0);
  const x = (size - (sx1 - sx0) * scale) / 2 - sx0 * scale;
  const baseline = (size + (sy1 - sy0) * scale) / 2 + sy0 * scale;
  const t = `translate(${round(x)} ${round(baseline)}) scale(${round(scale)} ${round(-scale)})`;
  return `  <rect width="${size}" height="${size}"${
    radius ? ` rx="${radius}"` : ""
  } fill="${tile}"/>
  <g fill="${glyph}" transform="${t}">
    <path d="${wordmark.mark.d}"/>
  </g>`;
}

/** Standalone tile asset for the brand pack. */
function logomarkSvg(variant) {
  const size = 96;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" fill="none" role="img" aria-label="Skillist">
${tileArtwork(size, TILE_VARIANTS[variant])}
</svg>
`;
}

/* ── Safe area guides ──────────────────────────────────────────────────── */

const GUIDE = "#8a8a8a";

/** Clear space: half the cap height (or tile side) on every side. */
function safeAreaSvg(inner, pad, artwork) {
  const vb = {
    x: inner.x - pad * 2,
    y: inner.y - pad * 2,
    width: inner.width + pad * 4,
    height: inner.height + pad * 4,
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${round(vb.x)} ${round(vb.y)} ${round(
    vb.width,
  )} ${round(vb.height)}" width="${round(vb.width)}" height="${round(
    vb.height,
  )}" fill="none" role="img" aria-label="Skillist, with clear space marked">
  <rect x="${round(inner.x - pad)}" y="${round(inner.y - pad)}" width="${round(
    inner.width + pad * 2,
  )}" height="${round(
    inner.height + pad * 2,
  )}" fill="none" stroke="${GUIDE}" stroke-width="1" opacity="0.55"/>
  <rect x="${round(inner.x)}" y="${round(inner.y)}" width="${round(inner.width)}" height="${round(
    inner.height,
  )}" fill="none" stroke="${SIGNAL}" stroke-width="1" stroke-dasharray="4 4" opacity="0.9"/>
${artwork}
</svg>
`;
}

function logoSafeAreaSvg(variant) {
  const { ink } = VARIANTS[variant];
  const { scale, x, baseline, width, height } = wordmarkLayout();
  return safeAreaSvg(
    { x: 0, y: 0, width, height },
    CAP * SAFE_FRAC,
    wordmarkGroup(ink, { x, scale, baseline }),
  );
}

function logomarkSafeAreaSvg(variant) {
  const size = 96;
  return safeAreaSvg(
    { x: 0, y: 0, width: size, height: size },
    size * SAFE_FRAC,
    tileArtwork(size, TILE_VARIANTS[variant]),
  );
}

/* ── Favicons ──────────────────────────────────────────────────────────── */

/**
 * The SVG favicon follows the tab strip's own theme: ink tile with paper S on
 * a light strip, inverted on a dark one — the same inversion the tile uses
 * everywhere. Browsers that take SVG favicons are exactly the ones that
 * support the media query.
 */
function faviconSvg() {
  const size = 32;
  const light = tileArtwork(size, { tile: "var(--tile)", glyph: "var(--glyph)" });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="Skillist">
  <style>
    :root { --tile: ${INK}; --glyph: ${PAPER}; }
    @media (prefers-color-scheme: dark) {
      :root { --tile: ${PAPER}; --glyph: ${INK}; }
    }
  </style>
${light}
</svg>
`;
}

/** Raster icons cannot adapt, so they take the light-ground tile: ink with the
 * S knocked out in paper, which reads on any tab strip and matches how an app
 * icon is expected to behave. */
function tileSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
${tileArtwork(size, TILE_VARIANTS.light)}
</svg>
`;
}

/**
 * Pack PNGs into an .ico container.
 *
 * Hand-rolled rather than shelled out to ImageMagick so the script needs no
 * system binaries. The format is a 6-byte header, one 16-byte directory entry
 * per image, then the payloads; PNG-in-ICO has been valid since Windows Vista
 * and every browser we care about reads it.
 */
function encodeIco(images) {
  const HEADER = 6;
  const ENTRY = 16;
  const header = Buffer.alloc(HEADER);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);

  let offset = HEADER + ENTRY * images.length;
  const entries = images.map(({ size, buf }) => {
    const e = Buffer.alloc(ENTRY);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // 0 encodes 256
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // palette size, 0 for truecolour
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += buf.length;
    return e;
  });

  return Buffer.concat([header, ...entries, ...images.map((i) => i.buf)]);
}

/**
 * Pack files into a ZIP, stored (no compression).
 *
 * Hand-rolled for the same reason as the ICO: no dependency, no shelled-out
 * `zip` binary that CI might lack. The members are SVG and PNG that are already
 * near their entropy floor, so store rather than deflate costs almost nothing
 * and keeps the encoder to the two record types every unzip tool has read since
 * 1989. CRC-32 is computed per file because the central directory requires it.
 */
function crc32(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function encodeZip(files) {
  const enc = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const { name, data } of files) {
    const nameBytes = enc.encode(name);
    const crc = crc32(data);

    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method 0 = store
    local.writeUInt16LE(0, 10); // mod time (fixed; Date is unavailable here)
    local.writeUInt16LE(0x21, 12); // mod date = 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // uncompressed size
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    Buffer.from(nameBytes).copy(local, 30);

    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0); // central directory signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42); // local header offset
    Buffer.from(nameBytes).copy(central, 46);

    locals.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  }

  const centralSize = centrals.reduce((a, c) => a + c.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  end.writeUInt16LE(files.length, 8); // entries on this disk
  end.writeUInt16LE(files.length, 10); // total entries
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16); // central directory offset
  return Buffer.concat([...locals, ...centrals, end]);
}

/* ── Emit ──────────────────────────────────────────────────────────────── */

const OUT_BRAND = join(ROOT, "apps/web/public/brand");
const PUBLIC_DIRS = [
  join(ROOT, "apps/web/public"),
  join(ROOT, "apps/console/public"),
  join(ROOT, "apps/docs/public"),
];
const DOCS_ASSETS = join(ROOT, "apps/docs/src/assets");

const written = [];
function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  written.push(path.replace(`${ROOT}/`, ""));
}

async function png(svg, size, path) {
  const buf = await sharp(Buffer.from(svg))
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
  written.push(path.replace(`${ROOT}/`, ""));
  return buf;
}

async function main() {
  rmSync(OUT_BRAND, { recursive: true, force: true });

  // 1. Brand pack: wordmark and S tile, per ground, with and without guides.
  for (const variant of Object.keys(VARIANTS)) {
    const logo = logoSvg(variant);
    const mark = logomarkSvg(variant);
    write(join(OUT_BRAND, `skillist-logo-${variant}.svg`), logo);
    write(join(OUT_BRAND, `skillist-logomark-${variant}.svg`), mark);
    write(join(OUT_BRAND, `skillist-logo-${variant}-safe-area.svg`), logoSafeAreaSvg(variant));
    write(
      join(OUT_BRAND, `skillist-logomark-${variant}-safe-area.svg`),
      logomarkSafeAreaSvg(variant),
    );

    // PNGs at a usable presentation size, transparent ground.
    for (const [name, svg, height] of [
      [`skillist-logo-${variant}`, logo, 128],
      [`skillist-logomark-${variant}`, mark, 512],
    ]) {
      await sharp(Buffer.from(svg))
        .resize({ height })
        .png({ compressionLevel: 9 })
        .toFile(join(OUT_BRAND, `${name}.png`));
      written.push(`apps/web/public/brand/${name}.png`);
    }
  }

  // 2. Favicons and touch icons, into every app that serves an index.html.
  const favicon = faviconSvg();
  const touch = tileSvg(180);
  for (const dir of PUBLIC_DIRS) {
    write(join(dir, "favicon.svg"), favicon);
    await png(touch, 180, join(dir, "apple-touch-icon.png"));
  }

  // 3. .ico at the classic 16/32/48. A letterform cannot be hand-snapped to
  //    whole pixels the way the old rect mark was; each layer renders from its
  //    own exact-size SVG so the rasterizer at least never scales twice.
  const layers = [];
  for (const size of [16, 32, 48]) {
    const buf = await sharp(Buffer.from(tileSvg(size)))
      .resize(size, size)
      .png()
      .toBuffer();
    layers.push({ size, buf });
  }
  const ico = encodeIco(layers);
  for (const dir of PUBLIC_DIRS) {
    write(join(dir, "favicon.ico"), ico);
  }

  // 4. Docs logos. Starlight swaps by theme, so these are ground-specific.
  write(join(DOCS_ASSETS, "logo-light.svg"), logoSvg("light"));
  write(join(DOCS_ASSETS, "logo-dark.svg"), logoSvg("dark"));
  write(join(DOCS_ASSETS, "logo.svg"), logoSvg("light"));

  // 5. Open Graph card. Near-black, matching where the marketing surface is
  //    heading, with the wordmark at a size that survives the ~1.9:1 crop that
  //    most timelines apply.
  const OG = { w: 1200, h: 630 };
  const wordW = 760;
  const { scale, x, baseline, width: lw, height: lh } = wordmarkLayout();
  const s = wordW / lw;
  const tx = (OG.w - wordW) / 2;
  const ty = (OG.h - lh * s) / 2;
  const og = `<svg xmlns="http://www.w3.org/2000/svg" width="${OG.w}" height="${OG.h}" viewBox="0 0 ${OG.w} ${OG.h}">
  <rect width="${OG.w}" height="${OG.h}" fill="${INK}"/>
  <g transform="translate(${round(tx)} ${round(ty)}) scale(${round(s)})">
${wordmarkGroup(PAPER, { x, scale, baseline })}
  </g>
</svg>
`;
  const ogBuf = await sharp(Buffer.from(og)).png({ compressionLevel: 9 }).toBuffer();
  write(join(ROOT, "apps/web/public/og-default.png"), ogBuf);

  // 6. Manifest + zip. The /brand page renders from this manifest, so the page
  //    and the files on disk cannot drift: add a variant here and the page
  //    grows a tile for it automatically. The zip is the "download everything"
  //    pack the hero button serves.
  const GROUNDS = {
    light: { label: "On light", ground: "light" },
    dark: { label: "On dark", ground: "dark" },
  };
  const base = "/brand";
  const manifest = {
    logo: Object.entries(GROUNDS).map(([v, meta]) => ({
      ...meta,
      variant: v,
      svg: `${base}/skillist-logo-${v}.svg`,
      png: `${base}/skillist-logo-${v}.png`,
    })),
    logomark: Object.entries(GROUNDS).map(([v, meta]) => ({
      ...meta,
      variant: v,
      svg: `${base}/skillist-logomark-${v}.svg`,
      png: `${base}/skillist-logomark-${v}.png`,
    })),
    zip: `${base}/skillist-brand-assets.zip`,
  };

  // Zip every file in the brand dir (before the manifest and zip themselves are
  // written into it), read straight off disk so the archive can never disagree
  // with what the page links to.
  const packNames = readdirSync(OUT_BRAND).sort();
  const zip = encodeZip(
    packNames.map((name) => ({ name, data: readFileSync(join(OUT_BRAND, name)) })),
  );
  write(join(OUT_BRAND, "skillist-brand-assets.zip"), zip);
  // Trailing newline so the emitted file is already in the shape biome expects.
  write(join(OUT_BRAND, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`Wrote ${written.length} files:`);
  for (const f of written.sort()) console.log(`  ${f}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
