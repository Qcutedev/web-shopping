/**
 * Typed calls to the admin endpoints (docs/API_CONTRACTS.md section 5.9). Request and response
 * types come from `src/modules/admin/schema.ts` and the sellers schema; they are not redeclared.
 * Only `import type` is used: the admin schema file pulls in module indexes (service, database), so
 * a runtime import of it would put server code in the browser bundle.
 *
 * Lists are read by Server Components through the module services; only mutations live here.
 */
import type {
  AdminCategoryDto,
  AdminOrderDto,
  AdminProductDto,
  AdminSellerOrderStatusBody,
  AdminStoreDto,
  AdminUserDto,
  ApproveProductBody,
  CreateCategoryBody,
  ProductReasonBody,
  SettingsDto,
  StoreReasonBody,
  UpdateCategoryBody,
  UpdateSettingsBody,
} from "@/modules/admin/schema";
import type { ApplicationDecisionDto, RejectApplicationBody } from "@/modules/sellers/schema";
import { type ApiResult, apiRequest } from "./http";

export type Fetcher = typeof fetch;

function path(resource: string, id: string, suffix = ""): string {
  return `/api/v1/admin/${resource}/${encodeURIComponent(id)}${suffix}`;
}

export function deactivateUser(id: string, fetchImpl?: Fetcher): Promise<ApiResult<AdminUserDto>> {
  return apiRequest<AdminUserDto>(path("users", id, "/deactivate"), { method: "POST", fetchImpl });
}

export function reactivateUser(id: string, fetchImpl?: Fetcher): Promise<ApiResult<AdminUserDto>> {
  return apiRequest<AdminUserDto>(path("users", id, "/reactivate"), { method: "POST", fetchImpl });
}

export function approveApplication(
  id: string,
  fetchImpl?: Fetcher,
): Promise<ApiResult<ApplicationDecisionDto>> {
  return apiRequest<ApplicationDecisionDto>(path("applications", id, "/approve"), {
    method: "POST",
    fetchImpl,
  });
}

export function rejectApplication(
  id: string,
  body: RejectApplicationBody,
  fetchImpl?: Fetcher,
): Promise<ApiResult<ApplicationDecisionDto>> {
  return apiRequest<ApplicationDecisionDto>(path("applications", id, "/reject"), {
    method: "POST",
    body,
    fetchImpl,
  });
}

export function suspendStore(
  id: string,
  body: StoreReasonBody,
  fetchImpl?: Fetcher,
): Promise<ApiResult<AdminStoreDto>> {
  return apiRequest<AdminStoreDto>(path("stores", id, "/suspend"), {
    method: "POST",
    body,
    fetchImpl,
  });
}

export function reinstateStore(
  id: string,
  body: StoreReasonBody,
  fetchImpl?: Fetcher,
): Promise<ApiResult<AdminStoreDto>> {
  return apiRequest<AdminStoreDto>(path("stores", id, "/reinstate"), {
    method: "POST",
    body,
    fetchImpl,
  });
}

export function approveProduct(
  id: string,
  body: ApproveProductBody,
  fetchImpl?: Fetcher,
): Promise<ApiResult<AdminProductDto>> {
  return apiRequest<AdminProductDto>(path("products", id, "/approve"), {
    method: "POST",
    body,
    fetchImpl,
  });
}

export function rejectProduct(
  id: string,
  body: ProductReasonBody,
  fetchImpl?: Fetcher,
): Promise<ApiResult<AdminProductDto>> {
  return apiRequest<AdminProductDto>(path("products", id, "/reject"), {
    method: "POST",
    body,
    fetchImpl,
  });
}

export function takedownProduct(
  id: string,
  body: ProductReasonBody,
  fetchImpl?: Fetcher,
): Promise<ApiResult<AdminProductDto>> {
  return apiRequest<AdminProductDto>(path("products", id, "/takedown"), {
    method: "POST",
    body,
    fetchImpl,
  });
}

export function createCategory(
  body: CreateCategoryBody,
  fetchImpl?: Fetcher,
): Promise<ApiResult<AdminCategoryDto>> {
  return apiRequest<AdminCategoryDto>("/api/v1/admin/categories", {
    method: "POST",
    body,
    fetchImpl,
  });
}

export function updateCategory(
  id: string,
  body: UpdateCategoryBody,
  fetchImpl?: Fetcher,
): Promise<ApiResult<AdminCategoryDto>> {
  return apiRequest<AdminCategoryDto>(path("categories", id), { method: "PATCH", body, fetchImpl });
}

export function deleteCategory(
  id: string,
  fetchImpl?: Fetcher,
): Promise<ApiResult<{ outcome: "DELETED" }>> {
  return apiRequest<{ outcome: "DELETED" }>(path("categories", id), {
    method: "DELETE",
    fetchImpl,
  });
}

export function changeSellerOrderStatus(
  sellerOrderId: string,
  body: AdminSellerOrderStatusBody,
  fetchImpl?: Fetcher,
): Promise<ApiResult<AdminOrderDto>> {
  return apiRequest<AdminOrderDto>(path("seller-orders", sellerOrderId, "/status"), {
    method: "POST",
    body,
    fetchImpl,
  });
}

export function updateSettings(
  body: UpdateSettingsBody,
  fetchImpl?: Fetcher,
): Promise<ApiResult<SettingsDto>> {
  return apiRequest<SettingsDto>("/api/v1/admin/settings", { method: "PATCH", body, fetchImpl });
}
