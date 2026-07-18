// btoa/atob are real globals in Node 18+, browsers, and Workers — this
// package's tsconfig just doesn't pull in the DOM lib that normally
// declares them, since it also runs in Workers/Node contexts without it.
declare function btoa(data: string): string;
declare function atob(data: string): string;

// Binary skill assets (assets/*.png, .pdf, ...) travel through the same
// `SkillBundle = Map<string, string>` used everywhere else in this package —
// represented as base64 text, symmetric on upload and download. This keeps
// every call site (validators, R2 storage, the CLI, the browser editor)
// working with plain strings; only the boundary encode/decode here needs to
// know bytes exist. No Buffer dependency, so this runs in Workers, Node, and
// the browser alike.

const BINARY_ASSET_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
};

export const BINARY_ASSET_EXTENSIONS = Object.keys(BINARY_ASSET_MIME_TYPES);

/** 5 MiB decoded — generous for the templates/icons/data files the spec describes, small enough to keep bundles cheap to move. */
export const MAX_BINARY_ASSET_BYTES = 5 * 1024 * 1024;

export function isBinaryAssetPath(path: string): boolean {
  const lower = path.toLowerCase();
  return BINARY_ASSET_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function binaryAssetMimeType(path: string): string {
  const lower = path.toLowerCase();
  for (const [ext, mime] of Object.entries(BINARY_ASSET_MIME_TYPES)) {
    if (lower.endsWith(ext)) return mime;
  }
  return "application/octet-stream";
}

const CHUNK_SIZE = 8192; // avoids String.fromCharCode(...bytes) blowing the call stack on large assets

export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    const chunk = bytes.subarray(offset, offset + CHUNK_SIZE);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Decoded byte length of base64 text, without materializing the bytes. Assumes valid, padded base64 (see isValidBase64). */
export function base64DecodedSize(base64: string): number {
  if (base64.length === 0) return 0;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

export function isValidBase64(value: string): boolean {
  return /^[A-Za-z0-9+/]*={0,2}$/.test(value) && value.length % 4 === 0;
}
