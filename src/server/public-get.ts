/**
 * The frame of a handler for a `public` `GET` (docs/API_CONTRACTS.md section 1.8: a `public`
 * endpoint skips steps 3 and 4, a `GET` skips steps 1, 2, and 6). What is left is validation of
 * the path parameters and the query (step 7) and the service (steps 9 and 10), both inside
 * `run`.
 *
 *   export async function GET(request: Request, context: RouteContext<"/api/v1/...">) {
 *     return handlePublicGet(request, async ({ requestId }) => {
 *       const params = parseInput(paramsSchema, await context.params); // 400
 *       const query = parseInput(querySchema, queryRecord(new URL(request.url).searchParams));
 *       return ok(await service(params, query), { requestId }); // 404 and the rest
 *     });
 *   }
 *
 * A thin wrapper over `handleRequest` (request-frame.ts), which supplies the request id, the
 * request's logger, the error mapping, and `connection()` before anything runs. A guarded
 * handler calls `handleRequest` directly, with its guards as the first lines of `run`.
 */
import { handleRequest, type RequestContext } from "./request-frame";

export type PublicGetContext = RequestContext;

export async function handlePublicGet(
  request: Request,
  run: (context: PublicGetContext) => Promise<Response>,
): Promise<Response> {
  return handleRequest(request, run);
}
