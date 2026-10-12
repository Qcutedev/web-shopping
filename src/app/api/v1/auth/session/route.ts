/**
 * GET /api/v1/auth/session (docs/API_CONTRACTS.md section 5.1). Public: the actor of the
 * request's session, or null. Writes nothing. The work is in src/server/auth/routes.ts.
 *
 * `connection()` comes first so that the handler is never prerendered at build time (Cache
 * Components) and never reads the configuration during `next build`.
 */
import { connection } from "next/server";

import { getAuthRuntime, handleGetSession } from "@/server/auth/routes";

export async function GET(request: Request): Promise<Response> {
  await connection();
  return handleGetSession(request, getAuthRuntime());
}
