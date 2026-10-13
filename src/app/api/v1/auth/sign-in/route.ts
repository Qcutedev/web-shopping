/**
 * POST /api/v1/auth/sign-in (docs/API_CONTRACTS.md section 5.1). Public, rate-limited per client
 * address and per email, strict body `{ email, password }`. Sets the session cookie. Every
 * failure is one 401 with one message. The work is in src/server/auth/routes.ts.
 */
import { getAuthRuntime, handleSignIn } from "@/server/auth/routes";

export async function POST(request: Request): Promise<Response> {
  return handleSignIn(request, getAuthRuntime);
}
