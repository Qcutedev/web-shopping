/**
 * Typed calls to `/api/v1/me` and `/api/v1/me/addresses` (docs/API_CONTRACTS.md sections 5.3 and
 * 5.3.1). Request and response types come from the module's `schema.ts`; they are not redeclared.
 * Only the `schema` file is imported: the module index pulls in the service and the database.
 */
import type {
  AddressDeletedDto,
  AddressDto,
  CreateAddressBody,
  ProfileDto,
  UpdateAddressBody,
  UpdateProfileBody,
} from "@/modules/profile/schema";
import { type ApiResult, apiRequest } from "./http";

export type Fetcher = typeof fetch;

export function updateProfile(
  body: UpdateProfileBody,
  fetchImpl?: Fetcher,
): Promise<ApiResult<ProfileDto>> {
  return apiRequest<ProfileDto>("/api/v1/me", { method: "PATCH", body, fetchImpl });
}

export function createAddress(
  body: CreateAddressBody,
  fetchImpl?: Fetcher,
): Promise<ApiResult<AddressDto>> {
  return apiRequest<AddressDto>("/api/v1/me/addresses", { method: "POST", body, fetchImpl });
}

export function updateAddress(
  id: string,
  body: UpdateAddressBody,
  fetchImpl?: Fetcher,
): Promise<ApiResult<AddressDto>> {
  return apiRequest<AddressDto>(`/api/v1/me/addresses/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body,
    fetchImpl,
  });
}

export function deleteAddress(
  id: string,
  fetchImpl?: Fetcher,
): Promise<ApiResult<AddressDeletedDto>> {
  return apiRequest<AddressDeletedDto>(`/api/v1/me/addresses/${encodeURIComponent(id)}`, {
    method: "DELETE",
    fetchImpl,
  });
}
