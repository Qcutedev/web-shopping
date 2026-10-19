/**
 * GET /api/files/{key} (docs/API_CONTRACTS.md section 5.8; SECURITY.md TM-17, TM-18). Public:
 * product pictures and store logos are public by design. Not an envelope response on success:
 * the body is the stored image, with the upload's recorded type, `X-Content-Type-Options:
 * nosniff`, and a policy that lets the response run nothing. Every refusal is the error envelope
 * `404 NOT_FOUND`, identical for a key that does not match the pattern (nothing is looked up or
 * read), a key with no upload, and an upload whose bytes are missing.
 *
 * One path segment: the framework decodes it, and a decoded `/`, `\`, or `.` cannot match the
 * key pattern. No session, no `Origin` or content-type check (a `GET`), no rate limit.
 */
import { FILE_CACHE_CONTROL, getUploadStorage, openFile } from "@/modules/uploads";
import { REQUEST_ID_HEADER } from "@/server/request-id";
import { handleRequest } from "@/server/request-frame";

export async function GET(
  request: Request,
  context: RouteContext<"/api/files/[key]">,
): Promise<Response> {
  return handleRequest(request, async ({ requestId, log }) => {
    const { key } = await context.params;
    const file = await openFile(key, { storage: getUploadStorage(), log });
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
