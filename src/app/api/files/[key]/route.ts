/**
 * GET /api/files/{key} (docs/API_CONTRACTS.md section 5.8; SECURITY.md TM-17, TM-18, SEC-068).
 * Not an envelope response on success: the body is the stored image, with the upload's recorded
 * type, `X-Content-Type-Options: nosniff`, and a policy that lets the response run nothing. Every
 * refusal is the error envelope `404 NOT_FOUND`, identical for a key that does not match the
 * pattern (nothing is looked up or read), a key with no upload, a file the caller may not read,
 * and an upload whose bytes are missing.
 *
 * Who may read (SEC-068, decided in the service, `mayServe`): anyone, without a session, for an
 * order item's picture, a picture of a visible product, and the logo of a public store; for any
 * other registered upload only a seller whose session's store owns it. The session is looked up
 * through the guard `getActor`, and only when the file is not public (`openFile` calls the
 * resolver), so a public file costs no session lookup. No session is required, so a request
 * without one is never 401.
 *
 * One path segment: the framework decodes it, and a decoded `/`, `\`, or `.` cannot match the
 * key pattern. No `Origin` or content-type check (a `GET`), no rate limit.
 */
import { FILE_CACHE_CONTROL, getUploadStorage, openFile } from "@/modules/uploads";
import { getActor } from "@/server/auth/session";
import { REQUEST_ID_HEADER } from "@/server/request-id";
import { handleRequest } from "@/server/request-frame";

export async function GET(
  request: Request,
  context: RouteContext<"/api/files/[key]">,
): Promise<Response> {
  return handleRequest(request, async ({ requestId, log }) => {
    const { key } = await context.params;
    const file = await openFile(key, { storage: getUploadStorage(), log }, () => getActor(request));
    return new Response(file.body, {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Content-Length": String(file.sizeBytes),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Disposition": "inline",
        "Cache-Control": FILE_CACHE_CONTROL,
        [REQUEST_ID_HEADER]: requestId,
      },
    });
  });
}
