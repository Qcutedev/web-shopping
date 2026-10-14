/**
 * GET and POST /api/v1/seller/application (docs/API_CONTRACTS.md section 5.7.1; REQ-S-01, BR-06).
 *
 * GET, access `user`: 3 the session (401), then the service (404 when the caller never applied).
 * POST, access `customer-role`: 1 `Origin` (403), 2 `Content-Type` (415), 3 the session (401),
 * 4 the role `CUSTOMER` (403 FORBIDDEN for a seller or an admin), 5 the `seller-application` rate
 * limit on the session's user id (429, before the body is read; section 6), 6 the body (413),
 * 7 the schema (400), then the service (409 OPEN_APPLICATION). `201` with the application.
 */
import {
  getOwnApplication,
  submitApplication,
  submitApplicationBodySchema,
} from "@/modules/sellers";
import { requireRole } from "@/server/auth/actor";
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
  ok,
  parseInput,
  readJsonBody,
} from "@/server/http";
import { logger } from "@/server/logger";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";
import { handleRequest } from "@/server/request-frame";

export async function GET(request: Request): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    const actor = await requireActor(request);
    return ok(await getOwnApplication(actor), { requestId });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    const env = getEnv();
    assertSameOrigin(request, env.appOrigin);
    assertContentType(request, JSON_CONTENT_TYPE);
    const actor = await requireActor(request);
    requireRole(actor, "CUSTOMER");
    const limit = await rateLimiter.consume(actor.userId, RATE_LIMITS.SELLER_APPLICATION);
    if (!limit.allowed) {
      // SR-04: a rate-limit refusal is a security event (throttled, ids and outcome only).
      recordSecurityEvent(logger.child({ requestId }), "rate-limited", {
        outcome: "refused",
        route: "seller-application",
        clientIp: getClientAddress(request, env.trustedProxy),
        userAgent: request.headers.get("user-agent"),
        rule: RATE_LIMITS.SELLER_APPLICATION.name,
        saturated: limit.saturated,
      });
      throw rateLimited(limit.retryAfterSeconds);
    }
    const body = parseInput(submitApplicationBodySchema, await readJsonBody(request));
    return created(await submitApplication(actor, body), { requestId });
  });
}
