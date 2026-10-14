/**
 * The slug generator of DATA_MODEL.md section 9 (finding S11; docs/API_CONTRACTS.md section 1.4).
 * One scheme for stores, products, and categories: `<readable part>-<suffix>`, or the suffix alone
 * when the readable part is empty.
 *
 *   - Readable part: the name normalised to NFC and lower-cased; letters, combining marks, and
 *     digits of any script are kept (Thai letters, vowels, and tone marks included); every other
 *     run of characters becomes one `-`; leading and trailing `-` are removed; cut to 40 code
 *     points (and a `-` the cut leaves at the end is removed).
 *   - Suffix: 8 characters of lower-case Crockford base 32 (no i, l, o, u) from the platform's
 *     cryptographic random source. 32 divides 256, so taking 5 bits of each random byte is
 *     unbiased.
 *
 * A slug is written once, at creation, and never changes; it is never accepted from a client. The
 * unique constraint is the guarantee against a duplicate: on the rare collision the caller
 * retries with a new suffix. prisma/seed/data.ts `sampleSlug` (database agent) applies the same
 * readable-part rule with fixed suffixes; the two are separate copies, so a change here must be
 * repeated there.
 *
 * Pure apart from the random source, which a test may replace.
 */

export const SLUG_SUFFIX_LENGTH = 8;
export const SLUG_READABLE_MAX_CODE_POINTS = 40;
/** Crockford base 32 in lower case, in value order. */
export const SLUG_SUFFIX_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
export const SLUG_SUFFIX_PATTERN = /^[0-9abcdefghjkmnpqrstvwxyz]{8}$/;

export type RandomBytes = (length: number) => Uint8Array;

const platformRandomBytes: RandomBytes = (length) => crypto.getRandomValues(new Uint8Array(length));

/** The readable part of a slug for `text` (may be the empty string). */
export function slugReadablePart(text: string): string {
  return Array.from(
    text
      .normalize("NFC")
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, ""),
  )
    .slice(0, SLUG_READABLE_MAX_CODE_POINTS)
    .join("")
    .replace(/-+$/g, "");
}

/** A fresh random suffix of SLUG_SUFFIX_LENGTH characters. */
export function slugSuffix(randomBytes: RandomBytes = platformRandomBytes): string {
  const bytes = randomBytes(SLUG_SUFFIX_LENGTH);
  if (bytes.length !== SLUG_SUFFIX_LENGTH) {
    throw new RangeError("slugSuffix: the random source returned the wrong number of bytes.");
  }
  let out = "";
  for (const byte of bytes) out += SLUG_SUFFIX_ALPHABET.charAt(byte & 31);
  return out;
}

/** A new slug for `text` with a random suffix. */
export function generateSlug(text: string, randomBytes: RandomBytes = platformRandomBytes): string {
  const readable = slugReadablePart(text);
  const suffix = slugSuffix(randomBytes);
  return readable === "" ? suffix : `${readable}-${suffix}`;
}
