/**
 * POST /api/v1/auth/sign-up (docs/API_CONTRACTS.md section 5.1). Public, rate-limited per client
 * address, strict body `{ name, email, password }`. Creates a CUSTOMER; never signs in; answers a
 * registered email exactly like a new one. The work is in src/server/auth/routes.ts.
 */
import { getAuthRuntime, handleSignUp } from "@/server/auth/routes";

export async function POST(request: Request): Promise<Response> {
  return handleSignUp(request, getAuthRuntime);
}
