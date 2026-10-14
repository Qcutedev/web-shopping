/**
 * Remove bidirectional isolate controls (U+2066 to U+2069), built from a code point range so the
 * source holds no literal invisible character. Used where user text goes into an attribute inside
 * an FSI ... PDI wrap: a PDI or isolate opener in the text could end or outlive that character-level
 * isolate (SEC-057). Embeddings and overrides (U+202A to U+202E) are left: the closing PDI ends them.
 */
const ISOLATE_CONTROLS = new RegExp(
  `[${String.fromCodePoint(0x2066)}-${String.fromCodePoint(0x2069)}]`,
  "g",
);

export function stripIsolateControls(text: string): string {
  return text.replace(ISOLATE_CONTROLS, "");
}
