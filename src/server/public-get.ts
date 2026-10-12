/**
 * The frame of a handler for a `public` `GET` (docs/API_CONTRACTS.md section 1.8: a `public`
 * endpoint skips steps 3 and 4, a `GET` skips steps 1, 2, and 6). What is left is validation of
 * the path parameters and the query (step 7) and the service (steps 9 and 10), both inside
 * `run`; this frame supplies the request id, the request's logger, and the error mapping.
 *
 *   export async function GET(request: Request, context: RouteContext<"/api/v1/...">) {
 *     return handlePublicGet(request, async ({ requestId }) => {
 *       const params = parseInput(paramsSchema, await context.params); // 400
 *       const query = parseInput(querySchema, queryRecord(new URL(request.url).searchParams));
 *       return ok(await service(params, query), { requestId }); // 404 and the rest
 *     });
 *   }
 *
 * The request id follows SR-03: generated, unless a trusted proxy is configured (SR-01) and the
 * incoming value is well-formed. The configuration is read with `getEnv()`; if it cannot be
 * read the id is generated, which is the safe side (the start-up hook already stops a server
 * whose environment is invalid). Everything `run` throws becomes the error envelope; the only
 * thing that leaves this function as a rejection is the framework's own interruption below.
 *
 * Never prerendered. Under Cache Components `next build` tries to prerender every `GET` handler
 * and interrupts it with an internal error at the first request-time access; inside `run` that
 * error would be caught here and logged as a 500. So `connection()` is awaited first, outside the
 * `try`: the build stops there, before anything else runs, and at request time it resolves at
 * once. Measured with Next.js 16.4.0: without it, `next build` printed an "Unhandled error" line
 * for `/api/v1/categories` and `/api/v1/products` ("needs to bail out of prerendering ... because
 * it used request.url").
 */
import { connection } from "next/server";

import { getEnv } from "./env";
import { errorResponse } from "./http";
import { type Logger, logger } from "./logger";
import { resolveRequestId, trustsIncomingRequestId } from "./request-id";

export interface PublicGetContext {
  requestId: string;
  log: Logger;
}

function trustIncomingRequestId(): boolean {
  try {
    return trustsIncomingRequestId(getEnv().trustedProxy);
  } catch {
    return false;
  }
}

export async function handlePublicGet(
  request: Request,
  run: (context: PublicGetContext) => Promise<Response>,
): Promise<Response> {
  await connection();
  const requestId = resolveRequestId(request, { trustIncoming: trustIncomingRequestId() });
  const log = logger.child({ requestId });
  try {
    return await run({ requestId, log });
  } catch (error) {
    return errorResponse(error, { requestId, logger: log });
  }
}
