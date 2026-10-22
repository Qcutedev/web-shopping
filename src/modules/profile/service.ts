/**
 * Profile and address service (docs/API_CONTRACTS.md section 5.3; REQ-C-03, REQ-C-04).
 *
 * Every function takes the acting user as `actor` (CLAUDE.md rule 2). The access level of these
 * endpoints is `user`: every role may read and edit its own profile and hold addresses, so no role
 * is refused here. Ownership is the control: every query is scoped by `actor.userId`, and nothing
 * of the request can name another user. An address the actor does not own is 404, exactly like
 * one that does not exist (section 1.8).
 *
 * Writes:
 *   - the profile write changes `name` and `phone` only, never `email`, `role`, or `isActive`;
 *   - every address write runs in one transaction; making an address the default clears the
 *     previous default in that transaction, so a user has at most one (repository.ts);
 *   - a user holds at most MAX_ADDRESSES_PER_USER (50) addresses (D-044 point 4), counted under a
 *     lock of the user's row in the create's own transaction.
 */
import type { Actor } from "@/server/auth/actor";

import { addressLimitReached, addressNotFound, profileGone } from "./errors";
import {
  type AddressRow,
  type AddressWrite,
  countAddressesUpTo,
  deleteOwnedAddress,
  findAddresses,
  findProfile,
  insertAddress,
  type ProfileRow,
  type ProfileUpdate,
  updateOwnedAddress,
  updateProfile as writeProfile,
  withUserLockedForAddressCreate,
} from "./repository";
import {
  type AddressDeletedDto,
  type AddressDto,
  type CreateAddressBody,
  MAX_ADDRESSES_PER_USER,
  type Page,
  type PaginationQuery,
  type ProfileDto,
  type UpdateAddressBody,
  type UpdateProfileBody,
} from "./schema";

// ---------------------------------------------------------------------------------------------
// Mapping from rows to response shapes (pure; unit-tested)
// ---------------------------------------------------------------------------------------------

export function toProfileDto(row: ProfileRow): ProfileDto {
  const application = row.sellerApplications[0];
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    store:
      row.store === null
        ? null
        : {
            id: row.store.id,
            name: row.store.name,
            slug: row.store.slug,
            status: row.store.status,
          },
    sellerApplication:
      application === undefined ? null : { id: application.id, status: application.status },
  };
}

export function toAddressDto(row: AddressRow): AddressDto {
  return {
    id: row.id,
    recipientName: row.recipientName,
    phone: row.phone,
    line1: row.line1,
    subdistrict: row.subdistrict,
    district: row.district,
    province: row.province,
    postalCode: row.postalCode,
    isDefault: row.isDefault,
  };
}

/** Copies only the keys that are present, so an absent key never becomes a write. */
function presentKeys<T extends object>(input: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(input) as (keyof T)[]) {
    if (input[key] !== undefined) out[key] = input[key];
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------------------------

/** GET /me: the actor's own profile, store, and latest application. */
export async function getProfile(actor: Actor): Promise<ProfileDto> {
  const row = await findProfile(actor.userId);
  if (row === null) throw profileGone();
  return toProfileDto(row);
}

/** PATCH /me: `name` and/or `phone` of the actor; `phone: null` clears it. */
export async function updateProfile(actor: Actor, input: UpdateProfileBody): Promise<ProfileDto> {
  const update: ProfileUpdate = {};
  if (input.name !== undefined) update.name = input.name;
  if (input.phone !== undefined) update.phone = input.phone;
  const row = await writeProfile(actor.userId, update);
  if (row === null) throw profileGone();
  return toProfileDto(row);
}

// ---------------------------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------------------------

/** GET /me/addresses: the actor's own addresses, the default first. */
export async function listAddresses(
  actor: Actor,
  query: PaginationQuery,
): Promise<Page<AddressDto>> {
  const { rows, total } = await findAddresses(actor.userId, query);
  return { items: rows.map(toAddressDto), page: query.page, pageSize: query.pageSize, total };
}

/**
 * POST /me/addresses. At most MAX_ADDRESSES_PER_USER per user (D-044 point 4): the count is
 * taken under the user lock in the same transaction as the insert, so concurrent creates of one
 * user cannot pass the cap. At the cap: `409 CONFLICT` `ADDRESS_LIMIT`, nothing written (the
 * previous default is not cleared either, because the check comes first).
 */
export async function createAddress(actor: Actor, input: CreateAddressBody): Promise<AddressDto> {
  const userId = actor.userId;
  const row = await withUserLockedForAddressCreate(userId, async (tx) => {
    if ((await countAddressesUpTo(tx, userId, MAX_ADDRESSES_PER_USER)) >= MAX_ADDRESSES_PER_USER) {
      throw addressLimitReached();
    }
    return insertAddress(tx, userId, {
      recipientName: input.recipientName,
      phone: input.phone,
      line1: input.line1,
      subdistrict: input.subdistrict,
      district: input.district,
      province: input.province,
      postalCode: input.postalCode,
      isDefault: input.isDefault,
    });
  });
  return toAddressDto(row);
}

/** PATCH /me/addresses/{id}: owner only, else 404. */
export async function updateAddress(
  actor: Actor,
  addressId: string,
  input: UpdateAddressBody,
): Promise<AddressDto> {
  const update: AddressWrite = presentKeys(input);
  const row = await updateOwnedAddress(actor.userId, addressId, update);
  if (row === null) throw addressNotFound();
  return toAddressDto(row);
}

/** DELETE /me/addresses/{id}: owner only, else 404. Orders keep their own copy (BR-09). */
export async function deleteAddress(actor: Actor, addressId: string): Promise<AddressDeletedDto> {
  const deleted = await deleteOwnedAddress(actor.userId, addressId);
  if (!deleted) throw addressNotFound();
  return { deleted: true };
}
