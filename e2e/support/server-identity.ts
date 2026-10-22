/**
 * SEC-077: proof that the process answering on the e2e origin is the e2e server, before global
 * setup sends it anything that writes (the seller sign-up).
 *
 * A canary category with a random slug is written to the e2e database. The public category list
 * is read through the origin. Only a server that reads the e2e database shows the slug. Another
 * process on the port (a development server, another program) does not.
 */
import { randomBytes } from "node:crypto";

export const CANARY_SLUG_PREFIX = "e2e-canary-";
const CANARY_SLUG_PATTERN = /^e2e-canary-[0-9a-f]{32}$/;

export function newCanarySlug(): string {
  return `${CANARY_SLUG_PREFIX}${randomBytes(16).toString("hex")}`;
}

/** A canary slug is passed on a command line; refuse anything but the shape `newCanarySlug` makes. */
export function isCanarySlug(value: string | undefined): value is string {
  return value !== undefined && CANARY_SLUG_PATTERN.test(value);
}

export type CategoryListReader = () => Promise<{ status: number; body: string }>;

/** Throws unless the category list read through the origin contains the canary slug. */
export async function assertServerShowsCanary(
  read: CategoryListReader,
  slug: string,
): Promise<void> {
  let answer: { status: number; body: string };
  try {
    answer = await read();
  } catch {
    throw new Error(
      "e2e setup refused: the server on the e2e origin did not answer the identity check.",
    );
  }
  if (answer.status !== 200 || !answer.body.includes(`"${slug}"`)) {
    throw new Error(
      "e2e setup refused: the server on the e2e origin does not read the e2e database (the canary category is missing). Something else may be listening on the e2e port. Nothing was written to it.",
    );
  }
}
