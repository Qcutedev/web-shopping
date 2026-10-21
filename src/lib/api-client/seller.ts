/**
 * Typed calls to the seller endpoints (docs/API_CONTRACTS.md section 5.7 and 5.8). Request and
 * response types come from the modules' `schema.ts` files; they are not redeclared. Only schema
 * files are imported: a module index pulls in its service and the database.
 */
import type {
  CreateProductBody,
  DeleteProductDto,
  SellerProductDto,
  StockBody,
  UpdateProductBody,
} from "@/modules/inventory/schema";
import type { SellerOrderStatusBody, SellerOrderViewDto } from "@/modules/orders/seller-schema";
import type {
  SellerApplicationDto,
  SellerStoreDto,
  SubmitApplicationBody,
  UpdateStoreBody,
} from "@/modules/sellers/schema";
import type { UploadDto } from "@/modules/uploads/schema";
import { type ApiResult, apiRequest, apiUploadFile } from "./http";

export type Fetcher = typeof fetch;

function productPath(id: string, suffix = ""): string {
  return `/api/v1/seller/products/${encodeURIComponent(id)}${suffix}`;
}

export function submitApplication(
  body: SubmitApplicationBody,
  fetchImpl?: Fetcher,
): Promise<ApiResult<SellerApplicationDto>> {
  return apiRequest<SellerApplicationDto>("/api/v1/seller/application", {
    method: "POST",
    body,
    fetchImpl,
  });
}

export function updateStore(
  body: UpdateStoreBody,
  fetchImpl?: Fetcher,
): Promise<ApiResult<SellerStoreDto>> {
  return apiRequest<SellerStoreDto>("/api/v1/seller/store", { method: "PATCH", body, fetchImpl });
}

export function uploadImage(file: File, fetchImpl?: Fetcher): Promise<ApiResult<UploadDto>> {
  return apiUploadFile<UploadDto>("/api/v1/seller/uploads", file, fetchImpl);
}

export function createProduct(
  body: CreateProductBody,
  fetchImpl?: Fetcher,
): Promise<ApiResult<SellerProductDto>> {
  return apiRequest<SellerProductDto>("/api/v1/seller/products", {
    method: "POST",
    body,
    fetchImpl,
  });
}

export function updateProduct(
  id: string,
  body: UpdateProductBody,
  fetchImpl?: Fetcher,
): Promise<ApiResult<SellerProductDto>> {
  return apiRequest<SellerProductDto>(productPath(id), { method: "PATCH", body, fetchImpl });
}

export function changeStock(
  id: string,
  body: StockBody,
  fetchImpl?: Fetcher,
): Promise<ApiResult<SellerProductDto>> {
  return apiRequest<SellerProductDto>(productPath(id, "/stock"), {
    method: "PATCH",
    body,
    fetchImpl,
  });
}

export type ProductAction = "publish" | "unpublish" | "archive";

/** Publish, unpublish, or archive: a POST without a body. */
export function runProductAction(
  id: string,
  action: ProductAction,
  fetchImpl?: Fetcher,
): Promise<ApiResult<SellerProductDto>> {
  return apiRequest<SellerProductDto>(productPath(id, `/${action}`), {
    method: "POST",
    fetchImpl,
  });
}

export function deleteProduct(
  id: string,
  fetchImpl?: Fetcher,
): Promise<ApiResult<DeleteProductDto>> {
  return apiRequest<DeleteProductDto>(productPath(id), { method: "DELETE", fetchImpl });
}

export function changeOrderStatus(
  sellerOrderId: string,
  body: SellerOrderStatusBody,
  fetchImpl?: Fetcher,
): Promise<ApiResult<SellerOrderViewDto>> {
  return apiRequest<SellerOrderViewDto>(
    `/api/v1/seller/orders/${encodeURIComponent(sellerOrderId)}/status`,
    { method: "POST", body, fetchImpl },
  );
}
