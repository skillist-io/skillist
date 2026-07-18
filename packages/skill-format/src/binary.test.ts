import { describe, expect, it } from "vitest";
import {
  base64DecodedSize,
  binaryAssetMimeType,
  decodeBase64,
  encodeBase64,
  isBinaryAssetPath,
  isValidBase64,
  MAX_BINARY_ASSET_BYTES,
} from "./binary";

describe("isBinaryAssetPath", () => {
  it("recognizes known binary extensions", () => {
    expect(isBinaryAssetPath("assets/logo.png")).toBe(true);
    expect(isBinaryAssetPath("assets/Logo.PNG")).toBe(true);
    expect(isBinaryAssetPath("assets/manual.pdf")).toBe(true);
    expect(isBinaryAssetPath("assets/data.json")).toBe(false);
    expect(isBinaryAssetPath("SKILL.md")).toBe(false);
  });
});

describe("binaryAssetMimeType", () => {
  it("maps known extensions and falls back for unknown ones", () => {
    expect(binaryAssetMimeType("assets/logo.png")).toBe("image/png");
    expect(binaryAssetMimeType("assets/photo.JPG")).toBe("image/jpeg");
    expect(binaryAssetMimeType("assets/mystery.bin")).toBe("application/octet-stream");
  });
});

describe("base64 round trip", () => {
  it("encodes and decodes bytes losslessly, including all byte values", () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    const encoded = encodeBase64(bytes);
    expect(isValidBase64(encoded)).toBe(true);
    expect(decodeBase64(encoded)).toEqual(bytes);
  });

  it("handles large arrays without a call-stack overflow", () => {
    const bytes = new Uint8Array(2_000_000).fill(7);
    const encoded = encodeBase64(bytes);
    expect(decodeBase64(encoded).length).toBe(bytes.length);
  });

  it("round-trips an empty array", () => {
    expect(decodeBase64(encodeBase64(new Uint8Array(0)))).toEqual(new Uint8Array(0));
  });
});

describe("base64DecodedSize", () => {
  it("matches the actual decoded length across padding cases", () => {
    for (const length of [0, 1, 2, 3, 4, 5, 100, 4095]) {
      const bytes = new Uint8Array(length).fill(1);
      const encoded = encodeBase64(bytes);
      expect(base64DecodedSize(encoded)).toBe(bytes.length);
    }
  });
});

describe("isValidBase64", () => {
  it("rejects malformed base64", () => {
    expect(isValidBase64("not base64!!")).toBe(false);
    expect(isValidBase64("abc")).toBe(false); // not a multiple of 4
  });

  it("accepts valid base64 including padding", () => {
    expect(isValidBase64("aGVsbG8=")).toBe(true);
    expect(isValidBase64("")).toBe(true);
  });
});

describe("MAX_BINARY_ASSET_BYTES", () => {
  it("is 5 MiB", () => {
    expect(MAX_BINARY_ASSET_BYTES).toBe(5 * 1024 * 1024);
  });
});
