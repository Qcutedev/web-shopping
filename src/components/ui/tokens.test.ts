import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Contrast check of the implemented tokens. The pairs and ratios below are the contrast tables of
 * docs/DESIGN_SYSTEM.md; the ratios are computed from the values in src/app/globals.css, so a
 * token change that breaks a pair, or that makes the document stale, fails here.
 */

const css = readFileSync(fileURLToPath(new URL("../../app/globals.css", import.meta.url)), "utf8");

function readRootTokens(source: string): Map<string, string> {
  const root = /:root\s*\{([^}]*)\}/.exec(source);
  if (!root?.[1]) throw new Error("No :root block found in globals.css");
  const tokens = new Map<string, string>();
  for (const match of root[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens.set(match[1] ?? "", (match[2] ?? "").trim());
  }
  return tokens;
}

const tokens = readRootTokens(css);

/** Resolves a token to its hex value, following var() references. */
function hex(name: string): string {
  let value = tokens.get(name);
  for (let depth = 0; depth < 5 && value !== undefined; depth += 1) {
    const reference = /^var\((--[\w-]+)\)$/.exec(value);
    if (!reference?.[1]) break;
    value = tokens.get(reference[1]);
  }
  if (value === undefined || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`Token ${name} does not resolve to a six-digit hex colour`);
  }
  return value.toLowerCase();
}

function luminance(colour: string): number {
  const channels = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(colour.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
}

/** WCAG 2.1 contrast ratio, rounded down to two decimals as in the design document. */
function contrast(foreground: string, background: string): number {
  const a = luminance(hex(foreground));
  const b = luminance(hex(background));
  const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  return Math.floor(ratio * 100) / 100;
}

const PLACEHOLDERS = [
  "--placeholder-1",
  "--placeholder-2",
  "--placeholder-3",
  "--placeholder-4",
  "--placeholder-5",
];

function lowestOnPlaceholders(foreground: string): number {
  return Math.min(...PLACEHOLDERS.map((tint) => contrast(foreground, tint)));
}

// [foreground, background, documented ratio]. Every pair must reach 4.5:1.
const TEXT_PAIRS: Array<[string, string, number]> = [
  ["--text", "--background", 17.99],
  ["--text", "--surface-muted", 16.45],
  ["--text-secondary", "--background", 8.04],
  ["--text-secondary", "--surface-muted", 7.35],
  ["--text-muted", "--background", 6.08],
  ["--text-muted", "--surface-muted", 5.56],
  ["--text-nav", "--background", 9.87],
  ["--text-nav", "--surface-muted", 9.02],
  ["--on-primary", "--primary", 5.12],
  ["--on-primary", "--primary-hover", 6.9],
  ["--on-primary", "--primary-active", 8.86],
  ["--primary", "--background", 5.12],
  ["--primary", "--surface-muted", 4.69],
  ["--primary", "--primary-soft", 4.69],
  ["--on-ink", "--ink", 17.99],
  ["--on-ink", "--ink-hover", 13.3],
  ["--on-ink", "--ink-active", 9.87],
  ["--on-selected", "--selected", 17.99],
  ["--success", "--background", 5.01],
  ["--success", "--surface-muted", 4.58],
  ["--success", "--success-soft", 4.66],
  ["--warning", "--warning-soft", 6.17],
  ["--warning", "--background", 6.79],
  ["--warning", "--surface-muted", 6.21],
  ["--danger", "--background", 6.57],
  ["--danger", "--surface-muted", 6.01],
  ["--danger", "--danger-soft", 5.74],
  ["--on-danger", "--danger", 6.57],
  ["--on-danger", "--danger-hover", 8.66],
  ["--on-danger", "--danger-active", 10.52],
  ["--info", "--background", 7.1],
  ["--info", "--surface-muted", 6.49],
  ["--info", "--info-soft", 6.16],
  ["--text", "--primary-soft", 16.45],
  ["--text", "--success-soft", 16.73],
  ["--text", "--warning-soft", 16.34],
  ["--text", "--danger-soft", 15.73],
  ["--text", "--info-soft", 15.6],
  ["--text", "--border", 14.64],
];

// [element, against, documented ratio]. Every pair must reach 3:1.
const BOUNDARY_PAIRS: Array<[string, string, number]> = [
  ["--primary", "--background", 5.12],
  ["--ink", "--background", 17.99],
  ["--selected", "--background", 17.99],
  ["--focus-ring", "--background", 5.12],
  ["--focus-ring", "--surface-muted", 4.69],
  ["--focus-ring-on-ink", "--ink", 17.99],
  ["--border-contrast", "--background", 3.63],
  ["--border-contrast", "--surface-muted", 3.32],
  ["--control-border", "--background", 3.63],
  ["--control-border", "--surface-muted", 3.32],
  ["--danger", "--background", 6.57],
  ["--info", "--info-soft", 6.16],
  ["--success", "--success-soft", 4.66],
  ["--warning", "--warning-soft", 6.17],
  ["--danger", "--danger-soft", 5.74],
];

describe("design tokens", () => {
  it.each(TEXT_PAIRS)("text %s on %s is %d:1 and passes 4.5:1", (foreground, background, ratio) => {
    const measured = contrast(foreground, background);
    expect(measured).toBe(ratio);
    expect(measured).toBeGreaterThanOrEqual(4.5);
  });

  it.each(BOUNDARY_PAIRS)("boundary %s on %s is %d:1 and passes 3:1", (element, against, ratio) => {
    const measured = contrast(element, against);
    expect(measured).toBe(ratio);
    expect(measured).toBeGreaterThanOrEqual(3);
  });

  it("text on the placeholder tints passes 4.5:1", () => {
    expect(lowestOnPlaceholders("--text")).toBe(15.22);
    expect(lowestOnPlaceholders("--text-muted")).toBe(5.14);
  });

  it("the focus ring on the placeholder tints passes 3:1", () => {
    expect(lowestOnPlaceholders("--focus-ring")).toBe(4.34);
  });

  it("records the pairs that are exempt or known to fail, so a change is noticed", () => {
    // Disabled controls are exempt from the contrast requirement.
    expect(contrast("--text-disabled", "--background")).toBe(3.18);
    expect(contrast("--text-disabled", "--surface-muted")).toBe(2.9);
    // --border-strong does not reach 3:1, so it is never the boundary of a control (D-025, OQ-01).
    expect(contrast("--border-strong", "--background")).toBe(1.59);
    expect(contrast("--border-strong", "--surface-muted")).toBe(1.46);
    // Decorative, no requirement.
    expect(contrast("--border", "--background")).toBe(1.22);
    expect(contrast("--surface-muted", "--background")).toBe(1.09);
  });

  it("maps the alias tokens to the values the owner decided (D-025)", () => {
    // OQ-01: form controls and outline buttons use the darker border.
    expect(tokens.get("--control-border")).toBe("var(--border-contrast)");
    expect(hex("--control-border")).toBe("#7f8790");
    // OQ-03: the selected page, tab, and menu item use dark ink, not the accent.
    expect(tokens.get("--selected")).toBe("var(--ink)");
    expect(tokens.get("--on-selected")).toBe("var(--on-ink)");
    expect(hex("--selected")).toBe("#14171a");
    expect(hex("--selected")).not.toBe(hex("--primary"));
  });
});
