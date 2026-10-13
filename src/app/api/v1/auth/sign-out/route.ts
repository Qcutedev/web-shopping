/**
 * POST /api/v1/auth/sign-out (docs/API_CONTRACTS.md section 5.1). Access `user`, no body. Deletes
 * the session on the server and clears the cookie. The work is in src/server/auth/routes.ts.
 */
import { getAuthRuntime, handleSignOut } from "@/server/auth/routes";

export async function POST(request: Request): Promise<Response> {
  return handleSignOut(request, getAuthRuntime);
}
