/**
 * Sample account rows in the auth library's formats (T-014; DATA_MODEL.md section 18, D-035).
 *
 * Sign-up cannot create a seller, and the library never lets an input set `role`, so the seed
 * inserts `User` and its credential `Account` itself, the way the admin bootstrap does
 * (`src/modules/auth/bootstrap-admin.ts`): the library's id format, the email trimmed and
 * lower-cased, `providerId` `credential`, `accountId` equal to the user id, and the password
 * hashed with the library's own `hashPassword` (scrypt), which the instance in
 * src/server/auth/auth.ts uses because it configures no other hasher. A sample account can
 * therefore sign in through `POST /api/v1/auth/sign-in` like anyone else.
 *
 * No database access here; prisma/seed.ts writes the rows.
 */
import { generateRandomString, hashPassword } from "better-auth/crypto";

import type { SampleUser } from "./data";

/** The provider id the library gives an email-and-password account. */
export const CREDENTIAL_PROVIDER_ID = "credential";

/** The library's id format (`generateId` of better-auth: 32 characters of a-z, A-Z, 0-9). */
export function libraryId(): string {
  return generateRandomString(32, "a-z", "A-Z", "0-9");
}

export interface SampleAccountRows {
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified: false;
    role: SampleUser["role"];
    isActive: true;
  };
  account: {
    id: string;
    accountId: string;
    providerId: typeof CREDENTIAL_PROVIDER_ID;
    userId: string;
    password: string;
  };
}

/** The two rows of one sample account. Hashing is slow on purpose; call it outside a transaction. */
export async function buildSampleAccountRows(
  sample: SampleUser,
  password: string,
): Promise<SampleAccountRows> {
  const userId = libraryId();
  return {
    user: {
      id: userId,
      name: sample.name,
      email: sample.email.trim().toLowerCase(),
      emailVerified: false,
      role: sample.role,
      isActive: true,
    },
    account: {
      id: libraryId(),
      accountId: userId,
      providerId: CREDENTIAL_PROVIDER_ID,
      userId,
      password: await hashPassword(password),
    },
  };
}
