/**
 * Typed calls to `/api/v1/cart` (docs/API_CONTRACTS.md section 5.4). Types come from the module's
 * `schema.ts`; they are not redeclared. The client sends a quantity and nothing else: every price
 * and total in the answer is the server's.
 */
import type { CartDto, CartItemDeletedDto, CartWriteLineDto } from "@/modules/cart/schema";
import { type ApiResult, apiRequest } from "./http";

export type Fetcher = typeof fetch;

export function readCart(fetchImpl?: Fetcher): Promise<ApiResult<CartDto>> {
  return apiRequest<CartDto>("/api/v1/cart", { method: "GET", fetchImpl });
}

export function setCartItemQuantity(
  itemId: string,
  quantity: number,
  fetchImpl?: Fetcher,
): Promise<ApiResult<CartWriteLineDto>> {
  return apiRequest<CartWriteLineDto>(`/api/v1/cart/items/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    body: { quantity },
    fetchImpl,
  });
}

export function removeCartItem(
  itemId: string,
  fetchImpl?: Fetcher,
): Promise<ApiResult<CartItemDeletedDto>> {
  return apiRequest<CartItemDeletedDto>(`/api/v1/cart/items/${encodeURIComponent(itemId)}`, {
    method: "DELETE",
    fetchImpl,
  });
}
