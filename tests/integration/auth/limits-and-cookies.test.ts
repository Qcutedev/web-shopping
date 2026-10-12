/**
 * T-015: rate limits (docs/API_CONTRACTS.md section 6; SR-05 item 5), the origin, content-type,
 * and size checks before the body (section 1.8 steps 1, 2, 6), cookie attributes in a
 * production-mode response, the session's address from SR-01 only (SR-07 item 2), and what the
 * security events write (SR-04).
 */
import { beforeAll, describe, expect, it } from "vitest";

import { getAuth } from "@/server/auth/auth";
import { SESSION_LIFETIME_SECONDS } from "@/server/auth/config";
import { handleSignIn, handleSignOut, handleSignUp } from "@/server/auth/routes";
import { db } from "@/server/db";
import { RATE_LIMITS } from "@/server/rate-limit";

import {
  captureLog,
  cookieAttributes,
  cookieFrom,
  freshEmail,
  json,
  makeRuntime,
  PASSWORD,
  post,
  stubAuthEnvironment,
} from "./support";

beforeAll(() => {
  stubAuthEnvironment();
});

async function register(email: string): Promise<string> {
  await getAuth().api.signUpEmail({ body: { name: "Test", email, password: PASSWORD } });
  return (await db.user.findUniqueOrThrow({ where: { email } })).id;
}

function signInRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return post("/api/v1/auth/sign-in", { body, headers });
}

describe("rate limits", () => {
  it(`sign-in: the ${String(RATE_LIMITS.SIGN_IN_ADDRESS.limit + 1)}th attempt from one address in a minute is 429, before the body is read`, async () => {
    const runtime = makeRuntime();
    const email = freshEmail();
    await register(email);
    for (let i = 0; i < RATE_LIMITS.SIGN_IN_ADDRESS.limit; i += 1) {
      const response = await handleSignIn(signInRequest({ email, password: "wrong" }), runtime);
      expect(response.status).toBe(401);
    }
    // The body is not valid JSON: a 429 proves it was never read.
    const refused = await handleSignIn(
      post("/api/v1/auth/sign-in", { rawBody: "{not json" }),
      runtime,
    );
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(((await json(refused))["error"] as Record<string, unknown>)["code"]).toBe(
      "RATE_LIMITED",
    );
    // The right password does not get through either.
    const correct = await handleSignIn(signInRequest({ email, password: PASSWORD }), runtime);
    expect(correct.status).toBe(429);
    expect(correct.headers.getSetCookie()).toEqual([]);
  });

  it("sign-in: the per-email limit holds across addresses, and an unknown email is counted the same way", async () => {
    const runtime = makeRuntime({ trustedProxy: { trustedProxyHops: 1 } });
    const known = freshEmail("known");
    await register(known);
    for (const email of [known, freshEmail("unknown")]) {
      for (let i = 0; i < RATE_LIMITS.SIGN_IN_EMAIL.limit; i += 1) {
        const response = await handleSignIn(
          signInRequest(
            { email, password: "wrong" },
            { "x-forwarded-for": `198.51.100.${String(i + 1)}` },
          ),
          runtime,
        );
        expect(response.status).toBe(401);
      }
      const refused = await handleSignIn(
        signInRequest(
          { email: `  ${email.toUpperCase()} `, password: PASSWORD },
          { "x-forwarded-for": "198.51.100.200" },
        ),
        runtime,
      );
      expect(refused.status).toBe(429);
    }
  });

  it(`sign-up: the ${String(RATE_LIMITS.SIGN_UP.limit + 1)}th attempt from one address in an hour is 429 and creates nothing`, async () => {
    const runtime = makeRuntime();
    for (let i = 0; i < RATE_LIMITS.SIGN_UP.limit; i += 1) {
      const response = await handleSignUp(
        post("/api/v1/auth/sign-up", {
          body: { name: "a", email: freshEmail(), password: PASSWORD },
        }),
        runtime,
      );
      expect(response.status).toBe(200);
    }
    const email = freshEmail();
    const refused = await handleSignUp(
      post("/api/v1/auth/sign-up", { body: { name: "a", email, password: PASSWORD } }),
      runtime,
    );
    expect(refused.status).toBe(429);
    expect(await db.user.count({ where: { email } })).toBe(0);
  });

  it("a request refused for its origin or content type uses no allowance", async () => {
    const runtime = makeRuntime();
    const email = freshEmail();
    await register(email);
    for (let i = 0; i < 10; i += 1) {
      const foreign = await handleSignIn(
        post("/api/v1/auth/sign-in", {
          body: { email, password: PASSWORD },
          origin: "https://evil.example",
        }),
        runtime,
      );
      expect(foreign.status).toBe(403);
      const untyped = await handleSignIn(
        post("/api/v1/auth/sign-in", { body: { email, password: PASSWORD }, contentType: null }),
        runtime,
      );
      expect(untyped.status).toBe(415);
    }
    const allowed = await handleSignIn(signInRequest({ email, password: PASSWORD }), runtime);
    expect(allowed.status).toBe(200);
  });
});

describe("checks before the body (section 1.8 steps 1, 2, 6)", () => {
  const routes = [
    ["sign-up", handleSignUp, { name: "a", email: "a@example.com", password: PASSWORD }],
    ["sign-in", handleSignIn, { email: "a@example.com", password: PASSWORD }],
    ["sign-out", handleSignOut, undefined],
  ] as const;

  for (const [name, handle, body] of routes) {
    it(`${name}: a missing, null, or foreign Origin is 403 FORBIDDEN`, async () => {
      for (const origin of [null, "null", "https://evil.example", "http://localhost:3001"]) {
        const response = await handle(
          post(`/api/v1/auth/${name}`, { body, origin }),
          makeRuntime(),
        );
        expect(response.status).toBe(403);
      }
    });

    it(`${name}: a form or text content type, or none, is 415`, async () => {
      for (const contentType of [
        null,
        "application/x-www-form-urlencoded",
        "text/plain",
        "multipart/form-data; boundary=x",
      ]) {
        const response = await handle(
          post(`/api/v1/auth/${name}`, { rawBody: "email=a&password=b", contentType }),
          makeRuntime(),
        );
        expect(response.status).toBe(415);
      }
    });
  }

  it("a body over 100 KiB is 413 and is not read further", async () => {
    for (const handle of [handleSignIn, handleSignUp]) {
      const response = await handle(
        post("/api/v1/auth/x", {
          rawBody: JSON.stringify({ email: "a@example.com", password: "x".repeat(110_000) }),
        }),
        makeRuntime(),
      );
      expect(response.status).toBe(413);
    }
  });
});

describe("cookie attributes in a production-mode response (TM-02)", () => {
  it("are Secure, HttpOnly, SameSite=Lax, Path=/, with the __Host- prefix and a bounded Max-Age", async () => {
    const runtime = makeRuntime({
      secureCookies: true,
      baseUrl: "https://shop.example.test",
      appOrigin: "https://shop.example.test",
    });
    const email = freshEmail();
    await register(email);
    const response = await handleSignIn(
      post("/api/v1/auth/sign-in", {
        body: { email, password: PASSWORD },
        origin: "https://shop.example.test",
        url: "https://shop.example.test/api/v1/auth/sign-in",
      }),
      runtime,
    );
    expect(response.status).toBe(200);
    const lines = response.headers.getSetCookie();
    expect(lines).toHaveLength(1);
    const attributes = cookieAttributes(response, "__Host-better-auth.session_token");
    expect(attributes).toBeDefined();
    expect(attributes?.has("secure")).toBe(true);
    expect(attributes?.has("httponly")).toBe(true);
    expect(attributes?.get("samesite")?.toLowerCase()).toBe("lax");
    expect(attributes?.get("path")).toBe("/");
    expect(attributes?.get("max-age")).toBe(String(SESSION_LIFETIME_SECONDS));
    expect(attributes?.has("domain")).toBe(false);
    // Nothing else is set: no cookie cache, no "don't remember" cookie.
    expect(lines[0]?.startsWith("__Host-better-auth.session_token=")).toBe(true);

    // Signing out clears the same cookie with the same attributes.
    const out = await handleSignOut(
      post("/api/v1/auth/sign-out", {
        cookie: cookieFrom(response),
        origin: "https://shop.example.test",
        url: "https://shop.example.test/api/v1/auth/sign-out",
      }),
      runtime,
    );
    expect(out.status).toBe(200);
    const cleared = cookieAttributes(out, "__Host-better-auth.session_token");
    expect(cleared?.get("max-age")).toBe("0");
    expect(cleared?.has("secure")).toBe(true);
    expect(cleared?.has("httponly")).toBe(true);
    // Every cookie the library writes or expires at sign-out (it also expires its cookie-cache
    // and "don't remember" cookies) is __Host- prefixed, Secure, Path=/, and has no Domain.
    const outLines = out.headers.getSetCookie();
    expect(outLines.length).toBeGreaterThan(0);
    for (const line of outLines) {
      const [pair, ...rest] = line.split(";");
      expect(pair?.startsWith("__Host-")).toBe(true);
      const flags = rest.map((part) => part.trim().toLowerCase());
      expect(flags).toContain("secure");
      expect(flags).toContain("path=/");
      expect(flags.some((flag) => flag.startsWith("domain="))).toBe(false);
    }
  });
});

describe("the session's address and browser details (SR-07 items 2 and 3)", () => {
  it("stores the SR-01 address behind a trusted proxy, never a client-written one", async () => {
    const runtime = makeRuntime({ trustedProxy: { trustedProxyHops: 1 } });
    const email = freshEmail();
    const userId = await register(email);
    const response = await handleSignIn(
      signInRequest(
        { email, password: PASSWORD },
        { "x-forwarded-for": "6.6.6.6, 203.0.113.9", "x-real-ip": "7.7.7.7" },
      ),
      runtime,
    );
    expect(response.status).toBe(200);
    const session = await db.session.findFirstOrThrow({ where: { userId } });
    expect(session.ipAddress).toBe("203.0.113.9");
  });

  it("stores nothing for an unknown address, even when the client sends X-Forwarded-For", async () => {
    const runtime = makeRuntime();
    const email = freshEmail();
    const userId = await register(email);
    await handleSignIn(
      signInRequest({ email, password: PASSWORD }, { "x-forwarded-for": "6.6.6.6" }),
      runtime,
    );
    const session = await db.session.findFirstOrThrow({ where: { userId } });
    expect(session.ipAddress).toBeNull();
    expect(session.userAgent).toBeNull();
  });
});

describe("security events (SR-04)", () => {
  it("never write the email, the password, the token, or the cookie", async () => {
    const { logger, lines } = captureLog();
    const runtime = makeRuntime({ logger });
    const email = freshEmail("zq7canary");
    await register(email);
    const success = await handleSignIn(signInRequest({ email, password: PASSWORD }), runtime);
    await handleSignIn(signInRequest({ email, password: "Zq7canaryPw" }), runtime);
    await handleSignUp(
      post("/api/v1/auth/sign-up", { body: { name: "Zq7name", email, password: "Zq7canaryPw2" } }),
      runtime,
    );
    const written = JSON.stringify(lines);
    for (const secret of [
      "zq7canary",
      "Zq7canaryPw",
      "Zq7name",
      PASSWORD,
      cookieFrom(success).split("=")[1] ?? "x",
    ]) {
      expect(written.toLowerCase()).not.toContain(secret.toLowerCase());
    }
    const events = lines.filter((line) => line["component"] === "auth");
    expect(events.map((line) => [line["event"], line["outcome"]])).toEqual([
      ["sign-in", "succeeded"],
      ["sign-in", "failed"],
      ["sign-up", "accepted"],
    ]);
    expect(events.every((line) => line["level"] !== "error")).toBe(true);
  });
});
