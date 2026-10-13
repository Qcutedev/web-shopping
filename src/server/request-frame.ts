/**
 * The frame of every route handler (code-review finding CR-83): the request id, the request's
 * logger, and the error mapping. Everything a handler decides is inside `run`, in the order of
 * docs/API_CONTRACTS.md section 1.8, and the guards are its first lines:
 *
 *   export async function POST(request: Request) {
 *     return handleRequest(request, async ({ requestId, log }) => {
 *       assertSameOrigin(request, getEnv().appOrigin);       // step 1, 403
 *       assertContentType(request, JSON_CONTENT_TYPE);       // step 2, 415
 *       const actor = await requireActor(request);           // step 3, 401
 *       const { storeId } = requireApprovedSeller(actor);    // step 4, 403
 *       ...                                                  // steps 5 to 10
 *       return ok(result, { requestId });
 *     });
 *   }
 *
 * Anything that may throw (reading the configuration of a guard, building a runtime) belongs
 * inside `run`, so that its failure becomes the error envelope with this request's id instead of
 * a rejection the framework answers on its own. A `public` `GET` uses `handlePublicGet`
 * (public-get.ts), a thin wrapper over this function.
 *
 * The request id follows SR-03: generated, unless a trusted proxy is configured (SR-01) and the
 * incoming value is well-formed. The trust setting has one source, `requestIdTrust()` below,
 * which reads `getEnv().trustedProxy`; if the configuration cannot be read the id is generated,
 * which is the safe side (the start-up hook already stops a server whose environment is
 * invalid). Everything `run` throws becomes the error envelope; the only thing that leaves this
 * function as a rejection is the framework's own interruption below.
 *
 * Never prerendered. Under Cache Components `next build` tries to prerender every `GET` handler
 * and interrupts it with an internal error at the first request-time access; inside `run` that
 * error would be caught here and logged as a 500. So `connection()` is awaited first, outside the
 * `try`: the build stops there, before anything else runs, and at request time it resolves at
 * once. Measured with Next.js 16.4.0: without it, `next build` printed an "Unhandled error" line
 * for `/api/v1/categories` and `/api/v1/products` ("needs to bail out of prerendering ... because
 * it used request.url"). For other methods it resolves at once as well.
 */
import { connection } from "next/server";

import { getEnv } from "./env";
import { errorResponse } from "./http";
import { type Logger, logger } from "./logger";
import { resolveRequestId, trustsIncomingRequestId } from "./request-id";

export interface RequestContext {
  requestId: string;
  log: Logger;
}

/**
 * Whether an incoming `X-Request-Id` may be reused: the one place that reads the trust setting
 * for the request id. False when the configuration cannot be read.
 */
export function requestIdTrust(): boolean {
  try {
    return trustsIncomingRequestId(getEnv().trustedProxy);
  } catch {
    return false;
  }
}

export async function handleRequest(
  request: Request,
  run: (context: RequestContext) => Promise<Response>,
): Promise<Response> {
  await connection();
  const requestId = resolveRequestId(request, { trustIncoming: requestIdTrust() });
  const log = logger.child({ requestId });
  try {
    return await run({ requestId, log });
  } catch (error) {
    return errorResponse(error, { requestId, logger: log });
  }
}
