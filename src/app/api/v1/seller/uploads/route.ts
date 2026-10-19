/**
 * POST /api/v1/seller/uploads (docs/API_CONTRACTS.md section 5.8; REQ-S-05, BR-14). Access
 * `seller`. `multipart/form-data` with one image in the field `file`. `201` with
 * `{ key, url, contentType, sizeBytes }`. The upload belongs to the session's store; no request
 * names one.
 *
 * Order of checks (section 1.8): 1 `Origin` (403), 2 `Content-Type` `multipart/form-data` (415),
 * 3 the session (401), 4 the role `SELLER` and an `APPROVED` store (403 FORBIDDEN, or
 * 403 SELLER_NOT_APPROVED for a suspended store; D-032 point 1), 5 the `uploads` rate limit
 * (429), and only then 6 and 7, the body (reader.ts: 413, 400, 415), then the service (403
 * SELLER_NOT_APPROVED again under the store row's lock). Nothing of the body is read, held, or
 * stored for a request refused at steps 1 to 5 (SECURITY.md SR-05 item 5).
 */
import { createUpload, getUploadStorage, readUploadRequest } from "@/modules/uploads";
import { requireApprovedSeller } from "@/server/auth/actor";
import { recordSecurityEvent } from "@/server/auth/security-events";
import { requireActor } from "@/server/auth/session";
import { getClientAddress } from "@/server/client-address";
import { getEnv } from "@/server/env";
import { rateLimited } from "@/server/errors";
import {
  assertContentType,
  assertSameOrigin,
  created,
  MULTIPART_CONTENT_TYPE,
} from "@/server/http";
import { logger } from "@/server/logger";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";
import { handleRequest } from "@/server/request-frame";

export async function POST(request: Request): Promise<Response> {
  return handleRequest(request, async ({ requestId, log }) => {
    const env = getEnv();
    assertSameOrigin(request, env.appOrigin);
    assertContentType(request, MULTIPART_CONTENT_TYPE);
    const actor = await requireActor(request);
    requireApprovedSeller(actor);
    // A missing UPLOAD_DIR is a 500 before any allowance is used or any byte is read.
    const storage = getUploadStorage();
    const limit = await rateLimiter.consume(actor.userId, RATE_LIMITS.UPLOADS);
    if (!limit.allowed) {
      // SR-04: a rate-limit refusal is a security event (throttled, ids and outcome only).
      recordSecurityEvent(logger.child({ requestId }), "rate-limited", {
        outcome: "refused",
        route: "seller-uploads",
        clientIp: getClientAddress(request, env.trustedProxy),
        userAgent: request.headers.get("user-agent"),
        rule: RATE_LIMITS.UPLOADS.name,
        saturated: limit.saturated,
      });
      throw rateLimited(limit.retryAfterSeconds);
    }
    const image = await readUploadRequest(request);
    return created(await createUpload(actor, image, { storage, log }), { requestId });
  });
}
