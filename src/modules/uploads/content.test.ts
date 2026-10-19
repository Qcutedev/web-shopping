import { describe, expect, it } from "vitest";

import { detectImageType } from "./content";
import { ascii, jpegBytes, pngBytes, webpBytes } from "./test-fixtures";

describe("detectImageType", () => {
  it("recognises JPEG, PNG, and WebP by their leading bytes", () => {
    expect(detectImageType(jpegBytes())).toBe("image/jpeg");
    expect(detectImageType(pngBytes())).toBe("image/png");
    expect(detectImageType(webpBytes())).toBe("image/webp");
  });

  it("accepts every WebP first chunk (lossy, lossless, extended)", () => {
    for (const chunk of ["VP8 ", "VP8L", "VP8X"]) {
      const bytes = webpBytes();
      bytes.set(ascii(chunk), 12);
      expect(detectImageType(bytes)).toBe("image/webp");
    }
  });

  it.each([
    ["GIF", ascii("GIF89a\x01\x00\x01\x00")],
    ["SVG", ascii('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ["HTML", ascii("<!doctype html><html><script>alert(1)</script>")],
    ["PDF", ascii("%PDF-1.7\n%\xe2\xe3")],
    ["script", ascii("#!/bin/sh\nrm -rf /")],
    ["empty", new Uint8Array(0)],
    ["three JPEG bytes only", Uint8Array.from([0xff, 0xd8, 0xff])],
    ["PNG signature without IHDR", pngBytes().slice(0, 8)],
    [
      "PNG signature with another chunk",
      (() => {
        const bytes = pngBytes();
        bytes.set(ascii("tEXt"), 12);
        return bytes;
      })(),
    ],
    [
      "RIFF that is not WebP (WAVE)",
      (() => {
        const bytes = webpBytes();
        bytes.set(ascii("WAVE"), 8);
        return bytes;
      })(),
    ],
    [
      "WebP with an unknown chunk",
      (() => {
        const bytes = webpBytes();
        bytes.set(ascii("ABCD"), 12);
        return bytes;
      })(),
    ],
  ])("refuses %s", (_name, bytes) => {
    expect(detectImageType(bytes)).toBeNull();
  });

  it("refuses a WebP whose RIFF size claims more bytes than the file has (truncated)", () => {
    const bytes = webpBytes(64);
    new DataView(bytes.buffer).setUint32(4, 1_000, true);
    expect(detectImageType(bytes)).toBeNull();
  });

  it("refuses a WebP whose RIFF size is too small to hold the WEBP tag", () => {
    const bytes = webpBytes(64);
    new DataView(bytes.buffer).setUint32(4, 3, true);
    expect(detectImageType(bytes)).toBeNull();
  });

  it("judges the content, so an HTML file is not an image whatever it is called", () => {
    // The name and the declared type are not inputs at all: only bytes are.
    expect(detectImageType(ascii("<html>"))).toBeNull();
  });
});
