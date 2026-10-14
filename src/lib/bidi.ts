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

/**
 * Characters of Bidi_Class B (UAX #9 rule P1): a paragraph break ends every open isolate, so one
 * in the title would end the FSI ... PDI wrap early. Replaced by a space so words stay apart.
 */
const PARAGRAPH_SEPARATORS = new RegExp(
  `[${[0x0a, 0x0d, 0x1c, 0x1d, 0x1e, 0x85, 0x2029]
    .map((code) => `\\u{${code.toString(16)}}`)
    .join("")}]+`,
  "gu",
);

export function stripIsolateControls(text: string): string {
  return text.replace(ISOLATE_CONTROLS, "").replace(PARAGRAPH_SEPARATORS, " ");
}
