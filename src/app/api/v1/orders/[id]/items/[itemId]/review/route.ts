/**
 * POST /api/v1/orders/{id}/items/{itemId}/review (docs/API_CONTRACTS.md sections 5.6 and 6;
 * REQ-C-14, BR-11). Access `user`. Body `{ rating, comment? }`. `201` with the review.
 *
 * Order of checks (section 1.8): 1 `Origin` (403), 2 `Content-Type` (415), 3 the session (401),
 * 5 the `review-create` rate limit on the session's user id (429, before the body is read;
 * section 6), 6 the body (413), 7 the path parameters and the body's schema (400), then the
 * service (404 for an order that is not the caller's or an item not in it; 409 CONFLICT with
 * reason `NOT_DELIVERED` or `DUPLICATE_REVIEW`). No step 4: every role may review what it bought.
 */
import { createReview, createReviewBodySchema, reviewTargetParamsSchema } from "@/modules/reviews";
import { recordSecurityEvent } from "@/server/auth/security-events";
import { requireActor } from "@/server/auth/session";
import { getClientAddress } from "@/server/client-address";
import { getEnv } from "@/server/env";
import { rateLimited } from "@/server/errors";
import {
  assertContentType,
  assertSameOrigin,
  created,
  JSON_CONTENT_TYPE,
  parseInput,
  readJsonBody,
} from "@/server/http";
import { logger } from "@/server/logger";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";
import { handleRequest } from "@/server/request-frame";

export async function POST(
  request: Request,
  context: RouteContext<"/api/v1/orders/[id]/items/[itemId]/review">,
): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    const env = getEnv();
    assertSameOrigin(request, env.appOrigin);
    assertContentType(request, JSON_CONTENT_TYPE);
    const actor = await requireActor(request);
    const limit = await rateLimiter.consume(actor.userId, RATE_LIMITS.REVIEW_CREATE);
    if (!limit.allowed) {
      // SR-04: a rate-limit refusal is a security event (throttled, ids and outcome only).
      recordSecurityEvent(logger.child({ requestId }), "rate-limited", {
        outcome: "refused",
        route: "review-create",
        clientIp: getClientAddress(request, env.trustedProxy),
        userAgent: request.headers.get("user-agent"),
        rule: RATE_LIMITS.REVIEW_CREATE.name,
        saturated: limit.saturated,
      });
      throw rateLimited(limit.retryAfterSeconds);
    }
    const raw = await readJsonBody(request);
    const target = parseInput(reviewTargetParamsSchema, await context.params);
    const body = parseInput(createReviewBodySchema, raw);
    return created(await createReview(actor, target, body), { requestId });
  });
}
