/**
 * Prisma queries of the profile module. Every query is scoped by the user id the service passes,
 * which is always `actor.userId` from the session (CLAUDE.md rules 2 and 6). An address is looked
 * up, changed, and deleted with `userId` inside the `WHERE`, so a foreign id and an unknown id take
 * the same path (docs/API_CONTRACTS.md section 1.8, "Not found over forbidden").
 *
 * Transactions (CLAUDE.md rule 5): the address writes run in one interactive transaction each.
 * Inside it every `tx` query selects scalar fields only and the statements are awaited one after
 * the other (docs/API_CONTRACTS.md item 8.2-14; DATA_MODEL.md section 7.8).
 *
 * Default address (REQ-C-04; DATA_MODEL.md section 6.2, partial unique index
 * `Address_userId_default_key`). A write that makes an address the default first locks the
 * user's `User` row with `FOR NO KEY UPDATE`, then clears the previous default, then writes. Two
 * concurrent default switches of one user therefore run one after the other instead of the second
 * failing on the unique index (code-review finding CR-22 a). `NO KEY UPDATE` does not conflict
 * with the `KEY SHARE` lock that a foreign-key check on `"User"` takes, so the lock never waits
 * for, or blocks, an insert elsewhere that references the user.
 *
 * Nothing here logs: the rows hold names, phones, and addresses (SECURITY.md SR-04).
 */
import { db, type DbTransaction, Prisma } from "@/server/db";

import type { PaginationQuery } from "./schema";

export const PROFILE_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  store: { select: { id: true, name: true, slug: true, status: true } },
  sellerApplications: {
    select: { id: true, status: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 1,
  },
} as const satisfies Prisma.UserSelect;

export type ProfileRow = Prisma.UserGetPayload<{ select: typeof PROFILE_SELECT }>;

export const ADDRESS_SELECT = {
  id: true,
  recipientName: true,
  phone: true,
  line1: true,
  subdistrict: true,
  district: true,
  province: true,
  postalCode: true,
  isDefault: true,
} as const satisfies Prisma.AddressSelect;

export type AddressRow = Prisma.AddressGetPayload<{ select: typeof ADDRESS_SELECT }>;

/** The ordering of the address list: the default first, then newest, then `id` (section 1.7). */
export const ADDRESS_ORDER_BY = [
  { isDefault: "desc" },
  { createdAt: "desc" },
  { id: "desc" },
] as const satisfies Prisma.AddressOrderByWithRelationInput[];

export interface ProfileUpdate {
  name?: string;
  phone?: string | null;
}

export interface AddressWrite {
  recipientName?: string;
  phone?: string;
  line1?: string;
  subdistrict?: string;
  district?: string;
  province?: string;
  postalCode?: string;
  isDefault?: boolean;
}

export type AddressCreate = Required<AddressWrite>;

function isRecordNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
}

// ---------------------------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------------------------

/** The profile of an active user, or null. Not in a transaction: one statement. */
export async function findProfile(userId: string): Promise<ProfileRow | null> {
  return db.user.findFirst({ where: { id: userId, isActive: true }, select: PROFILE_SELECT });
}

/**
 * Writes `name` and/or `phone` of an active user and returns the profile, or null when no active
 * user has this id. One statement. Only the two columns are ever written here (DATA_MODEL.md
 * section 6.1: `role`, `isActive`, and `email` are never written by the profile service).
 */
export async function updateProfile(
  userId: string,
  update: ProfileUpdate,
): Promise<ProfileRow | null> {
  const data: Prisma.UserUpdateInput = {};
  if (update.name !== undefined) data.name = update.name;
  if (update.phone !== undefined) data.phone = update.phone;
  try {
    return await db.user.update({
      where: { id: userId, isActive: true },
      data,
      select: PROFILE_SELECT,
    });
  } catch (error) {
    if (isRecordNotFound(error)) return null;
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------------------------

export interface AddressPage {
  rows: AddressRow[];
  total: number;
}

/** One page of the user's addresses and their count (two statements, as in the catalog). */
export async function findAddresses(userId: string, page: PaginationQuery): Promise<AddressPage> {
  const where = { userId } satisfies Prisma.AddressWhereInput;
  const total = await db.address.count({ where });
  const skip = (page.page - 1) * page.pageSize;
  if (skip >= total) return { rows: [], total };
  const rows = await db.address.findMany({
    where,
    select: ADDRESS_SELECT,
    orderBy: [...ADDRESS_ORDER_BY],
    skip,
    take: page.pageSize,
  });
  return { rows, total };
}

/** Locks the user's row for the default switch (file comment). Scalar, one statement. */
async function lockUserForDefaultSwitch(tx: DbTransaction, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "User" WHERE "id" = ${userId} FOR NO KEY UPDATE`;
}

/** Clears the user's current default, except `keepId`. */
async function clearDefault(tx: DbTransaction, userId: string, keepId?: string): Promise<void> {
  await tx.address.updateMany({
    where: {
      userId,
      isDefault: true,
      ...(keepId === undefined ? {} : { id: { not: keepId } }),
    },
    data: { isDefault: false },
  });
}

/** Creates an address for the user; when it is the default, the previous default is cleared. */
export async function insertAddress(userId: string, input: AddressCreate): Promise<AddressRow> {
  return db.$transaction(async (tx) => {
    if (input.isDefault) {
      await lockUserForDefaultSwitch(tx, userId);
      await clearDefault(tx, userId);
    }
    return tx.address.create({
      data: { ...input, userId },
      select: ADDRESS_SELECT,
    });
  });
}

/**
 * Changes an address the user owns and returns it, or null when the user owns no address with
 * this id (unknown and foreign alike). When the write makes it the default, the previous default
 * is cleared in the same transaction.
 */
export async function updateOwnedAddress(
  userId: string,
  addressId: string,
  update: AddressWrite,
): Promise<AddressRow | null> {
  return db.$transaction(async (tx) => {
    if (update.isDefault === true) await lockUserForDefaultSwitch(tx, userId);
    const owned = await tx.address.findFirst({
      where: { id: addressId, userId },
      select: { id: true },
    });
    if (owned === null) return null;
    if (update.isDefault === true) await clearDefault(tx, userId, addressId);
    return tx.address.update({
      where: { id: addressId, userId },
      data: update,
      select: ADDRESS_SELECT,
    });
  });
}

/** Deletes an address the user owns. False when the user owns none with this id. One statement. */
export async function deleteOwnedAddress(userId: string, addressId: string): Promise<boolean> {
  const { count } = await db.address.deleteMany({ where: { id: addressId, userId } });
  return count > 0;
}
