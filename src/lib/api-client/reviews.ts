/**
 * Typed call to `POST /api/v1/orders/{id}/items/{itemId}/review` (docs/API_CONTRACTS.md section
 * 5.6). The body carries a rating and an optional comment only; the product and the reviewer come
 * from the order item and the session. Only the `schema` file is imported (no server code).
 */
import type { CreatedReviewDto, CreateReviewBody } from "@/modules/reviews/schema";
import { type ApiResult, apiRequest } from "./http";

export type Fetcher = typeof fetch;

export function createReview(
  orderId: string,
  itemId: string,
  body: CreateReviewBody,
  fetchImpl?: Fetcher,
): Promise<ApiResult<CreatedReviewDto>> {
  return apiRequest<CreatedReviewDto>(
    `/api/v1/orders/${encodeURIComponent(orderId)}/items/${encodeURIComponent(itemId)}/review`,
    { method: "POST", body, fetchImpl },
  );
}
