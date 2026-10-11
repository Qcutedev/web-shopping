/**
 * GET /api/health (docs/API_CONTRACTS.md): public, 200 `{ "status": "ok", "database": "up" }`
 * when the database answers, otherwise 503 `{ "status": "unavailable", "database": "down" }`.
 *
 * The check itself is src/server/health.ts; this handler only maps its result to a response.
 * The body is the whole answer: no version, no configuration, no error text.
 *
 * Never cached and never prerendered. With Cache Components a `GET` handler is prerendered at
 * build time unless it reads request-time data, so `connection()` comes first: the check then
 * runs for every request and never during `next build`. The response is `no-store` so that no
 * browser, proxy, or CDN answers for the server.
 */
import { connection } from "next/server";

import { checkHealth } from "@/server/health";
import { CACHE_CONTROL_HEADER, NO_STORE } from "@/server/http";
import { generateRequestId, REQUEST_ID_HEADER } from "@/server/request-id";

export async function GET(): Promise<Response> {
  await connection();
  // Always generated: the endpoint is public, and a client-chosen id is never used (SR-03).
  const requestId = generateRequestId();
  const report = await checkHealth({ requestId });
  return Response.json(report, {
    status: report.status === "ok" ? 200 : 503,
    headers: { [CACHE_CONTROL_HEADER]: NO_STORE, [REQUEST_ID_HEADER]: requestId },
  });
}
