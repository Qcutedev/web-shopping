/**
 * Security review of T-015 (auth routes, guards, sessions) and T-016 (admin bootstrap), run
 * against the test database (`pnpm test:integration`; the `.itest.ts` suffix keeps it out of the
 * unit run). Owner: security. Review: docs/reviews/T-015-T-016-security.md.
 *
 * An `it.fails` case states the secure behaviour of an open finding: it is reported as an
 * expected failure while the flaw exists and turns red when the code is fixed; the fix then
 * changes `it.fails` to `it` without touching the body, and the security agent re-checks.
 * Plain cases are adversarial checks that passed on the reviewed code (commits 4bd5d96 to
 * 7f3a767) and pin it.
 */
import { describe, expect, it } from "vitest";

import { BOOTSTRAP_ENV, BOOTSTRAP_EXIT, runBootstrapAdmin } from "@/modules/auth/bootstrap-admin";
import { handleGetSession, handleSignIn, handleSignOut, handleSignUp } from "@/server/auth/routes";
import { db } from "@/server/db";
import { createRateLimiter } from "@/server/rate-limit";

import {
  captureLog,
  cookieFrom,
  freshEmail,
  get,
  json,
  makeRuntime,
  PASSWORD,
  post,
} from "../integration/auth/support";

type Runtime = ReturnType<typeof makeRuntime>;

async function register(runtime: Runtime, email: string, name = "Test"): Promise<string> {
  await runtime.auth.api.signUpEmail({ body: { name, email, password: PASSWORD } });
  return (await db.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
}

function signIn(
  runtime: Runtime,
  body: unknown,
  headers: Record<string, string> = {},
  extra: { cookie?: string } = {},
): Promise<Response> {
  return handleSignIn(post("/api/v1/auth/sign-in", { body, headers, ...extra }), runtime);
}

describe("SEC-032 per-email sign-in limit: one address locks any account out", () => {
  it("after five wrong passwords from one address, the owner signs in from another address", async () => {
    const runtime = makeRuntime({ trustedProxy: { trustedProxyHops: 1 } });
    const victim = freshEmail("victim");
    await register(runtime, victim);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const wrong = await signIn(
        runtime,
        { email: victim, password: "guess-" + String(attempt) },
        { "x-forwarded-for": "203.0.113.66" },
      );
      expect(wrong.status).toBe(401);
    }
    // The owner, elsewhere, with the right password.
    const owner = await signIn(
      runtime,
      { email: victim, password: PASSWORD },
      { "x-forwarded-for": "198.51.100.7" },
    );
    expect(owner.status).toBe(200);
  });

  it("pins the cost: five requests a minute from one address no longer keep an admin out", async () => {
    const runtime = makeRuntime({ trustedProxy: { trustedProxyHops: 1 } });
    const victim = freshEmail("admin-victim");
    const userId = await register(runtime, victim);
    await db.user.update({ where: { id: userId }, data: { role: "ADMIN" } });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await signIn(
        runtime,
        { email: victim, password: "x" },
        { "x-forwarded-for": "203.0.113.66" },
      );
    }
    // The attacker's own address is out of allowance; the owner's is not.
    const sixth = await signIn(
      runtime,
      { email: victim, password: PASSWORD },
      { "x-forwarded-for": "203.0.113.66" },
    );
    expect(sixth.status).toBe(429);
    const owner = await signIn(
      runtime,
      { email: victim, password: PASSWORD },
      { "x-forwarded-for": "198.51.100.7" },
    );
    expect(owner.status).toBe(200);
    expect(await db.session.count({ where: { userId } })).toBe(1);
    // Keeping the owner out now takes a full `sign-in-account` window (60 per 300 s), which two
    // addresses cannot fill and a third can: see the two cases below.
  });

  /**
   * A runtime whose limiter (built-in rules) runs on a simulated clock, and a helper that sends
   * `count` wrong passwords from each address at `seconds` and returns how many reached the
   * password check (401) per address; the others are 429.
   */
  function simulated() {
    const clock = { now: 1_800_000_000_000 };
    const start = clock.now;
    const runtime = makeRuntime({
      trustedProxy: { trustedProxyHops: 1 },
      limiter: createRateLimiter({ now: () => clock.now }),
    });
    const at = (seconds: number) => {
      clock.now = start + seconds * 1_000;
    };
    async function attack(
      email: string,
      addresses: readonly string[],
      seconds: number,
      count: number,
    ): Promise<number[]> {
      at(seconds);
      const checked: number[] = [];
      for (const address of addresses) {
        let reached = 0;
        for (let index = 0; index < count; index += 1) {
          const response = await signIn(
            runtime,
            { email, password: `wrong-${String(seconds)}-${String(index)}` },
            { "x-forwarded-for": address },
          );
          expect([401, 429]).toContain(response.status);
          if (response.status === 401) reached += 1;
        }
        checked.push(reached);
      }
      return checked;
    }
    /**
     * The strongest timing against the `sign-in-account` window that starts at `start`: one hit
     * in the window before, one a second before `start` (each address's own 60 s windows then
     * straddle it, six overlapping it), and full rate after. Each address adds 4 + 5 * 5 = 29
     * hits to that window by `start + 299` s.
     */
    async function straddle(email: string, addresses: readonly string[], begin: number) {
      const total = addresses.map(() => 0);
      const add = (counts: number[]) => {
        counts.forEach((count, index) => {
          total[index] = (total[index] ?? 0) + count;
        });
      };
      add(await attack(email, addresses, begin - 300, 1));
      add(await attack(email, addresses, begin - 1, 1));
      add(await attack(email, addresses, begin, 7));
      for (let minute = 1; minute <= 5; minute += 1) {
        add(await attack(email, addresses, begin - 1 + minute * 60, 7));
      }
      return total;
    }
    const owner = (email: string, seconds: number) => {
      at(seconds);
      return signIn(runtime, { email, password: PASSWORD }, { "x-forwarded-for": "198.51.100.7" });
    };
    return { runtime, attack, straddle, owner };
  }

  it("sign-in-account is not exhausted by one address over 10 simulated minutes", async () => {
    const { runtime, straddle, owner } = simulated();
    const victim = freshEmail("one-address");
    const userId = await register(runtime, victim);
    // Minutes 0 to 10, with the account window of 300 to 600 s loaded as far as one address can.
    expect(await straddle(victim, ["203.0.113.66"], 300)).toEqual([31]);
    // At the last second of that window, after 29 of the address's attempts in it.
    expect((await owner(victim, 599)).status).toBe(200);
    expect(await db.session.count({ where: { userId } })).toBe(1);
  }, 60_000);

  it("two addresses at their strongest timing do not exhaust sign-in-account; a third does", async () => {
    const { runtime, attack, straddle, owner } = simulated();
    const victim = freshEmail("two-addresses");
    const userId = await register(runtime, victim);
    expect(await straddle(victim, ["203.0.113.66", "203.0.113.67"], 300)).toEqual([31, 31]);
    // 58 attempts in the window: the owner's is the 59th.
    expect((await owner(victim, 599)).status).toBe(200);
    // A third address fills the window (60th); the owner's next attempt is the 61st.
    expect(await attack(victim, ["192.0.2.1"], 599, 1)).toEqual([1]);
    const refused = await owner(victim, 599);
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeLessThanOrEqual(60);
    expect(await db.session.count({ where: { userId } })).toBe(1);
    // The window ends at 600 s.
    expect((await owner(victim, 600)).status).toBe(200);
  }, 60_000);
});

describe("SEC-033 sign-up display name accepts bidirectional control characters", () => {
  for (const [label, char] of [
    ["U+202E right-to-left override", "\u202e"],
    ["U+202D left-to-right override", "\u202d"],
    ["U+2066 left-to-right isolate", "\u2066"],
    ["U+2067 right-to-left isolate", "\u2067"],
    ["U+200F right-to-left mark", "\u200f"],
    ["U+061C Arabic letter mark", "\u061c"],
  ] as const) {
    it(`a name with ${label} is 400 VALIDATION_ERROR and creates nothing`, async () => {
      const runtime = makeRuntime();
      const email = freshEmail("bidi");
      const response = await handleSignUp(
        post("/api/v1/auth/sign-up", {
          body: { name: `ร้านค้าทางการ${char}nimdA`, email, password: PASSWORD },
        }),
        runtime,
      );
      expect(response.status).toBe(400);
      expect(await db.user.count({ where: { email } })).toBe(0);
    });
  }

  it("C0 and C1 controls are already refused (control for the cases above)", async () => {
    for (const char of ["\u0000", "\u001B", "\u0085", "\u009B"]) {
      const runtime = makeRuntime();
      const response = await handleSignUp(
        post("/api/v1/auth/sign-up", {
          body: { name: `a${char}b`, email: freshEmail("c0"), password: PASSWORD },
        }),
        runtime,
      );
      expect(response.status).toBe(400);
    }
  });
});

describe("SEC-034 production session cookie is not host-only by prefix", () => {
  it("the production session cookie carries the __Host- prefix", async () => {
    const runtime = makeRuntime({
      secureCookies: true,
      baseUrl: "https://shop.example.test",
      appOrigin: "https://shop.example.test",
    });
    const email = freshEmail("host");
    await register(runtime, email);
    const response = await handleSignIn(
      post("/api/v1/auth/sign-in", {
        body: { email, password: PASSWORD },
        origin: "https://shop.example.test",
        url: "https://shop.example.test/api/v1/auth/sign-in",
      }),
      runtime,
    );
    expect(response.status).toBe(200);
    const names = response.headers.getSetCookie().map((line) => line.split("=")[0]);
    expect(names.every((name) => name?.startsWith("__Host-"))).toBe(true);
  });
});

describe("session handling (adversarial, passing)", () => {
  it("a valid session cookie sent to sign-in for another account is deleted, not kept", async () => {
    const runtime = makeRuntime();
    const attacker = freshEmail("attacker");
    const victim = freshEmail("victim");
    const attackerId = await register(runtime, attacker);
    const victimId = await register(runtime, victim);
    const planted = cookieFrom(await signIn(runtime, { email: attacker, password: PASSWORD }));
    const response = await signIn(
      runtime,
      { email: victim, password: PASSWORD },
      {},
      { cookie: planted },
    );
    expect(response.status).toBe(200);
    const fresh = cookieFrom(response);
    expect(fresh).not.toBe(planted);
    expect(await db.session.count({ where: { userId: attackerId } })).toBe(0);
    const actor = await json(await handleGetSession(get("/x", { cookie: fresh }), runtime));
    expect((actor["data"] as Record<string, unknown>)["userId"]).toBe(victimId);
    const old = await json(await handleGetSession(get("/x", { cookie: planted }), runtime));
    expect(old["data"]).toBeNull();
  });

  it("a cookie signed with another secret is refused", async () => {
    const runtime = makeRuntime();
    const email = freshEmail();
    await register(runtime, email);
    const cookie = cookieFrom(await signIn(runtime, { email, password: PASSWORD }));
    const other = makeRuntime({ secret: "another-secret-of-at-least-thirty-two-chars-xyz" });
    const read = await json(await handleGetSession(get("/x", { cookie }), other));
    expect(read["data"]).toBeNull();
  });

  it("sign-out with a cookie but without Origin is 403 and the session survives", async () => {
    const runtime = makeRuntime();
    const email = freshEmail();
    const userId = await register(runtime, email);
    const cookie = cookieFrom(await signIn(runtime, { email, password: PASSWORD }));
    const response = await handleSignOut(
      post("/api/v1/auth/sign-out", { cookie, origin: null }),
      runtime,
    );
    expect(response.status).toBe(403);
    expect(await db.session.count({ where: { userId } })).toBe(1);
  });

  it("the sign-in and session answers never carry the session token", async () => {
    const runtime = makeRuntime();
    const email = freshEmail();
    await register(runtime, email);
    const response = await signIn(runtime, { email, password: PASSWORD });
    const token = (cookieFrom(response).split("=")[1] ?? "").split(".")[0] ?? "";
    expect(token.length).toBeGreaterThan(20);
    expect(JSON.stringify(await json(response))).not.toContain(token);
    const session = await handleGetSession(get("/x", { cookie: cookieFrom(response) }), runtime);
    expect(JSON.stringify(await json(session))).not.toContain(token);
  });

  it("an unknown email, a wrong password, and a deactivated account answer byte for byte alike", async () => {
    const runtime = makeRuntime();
    const known = freshEmail("known");
    const inactive = freshEmail("inactive");
    await register(runtime, known);
    const inactiveId = await register(runtime, inactive);
    await db.user.update({ where: { id: inactiveId }, data: { isActive: false } });
    const bodies: string[] = [];
    for (const body of [
      { email: freshEmail("nobody"), password: PASSWORD },
      { email: known, password: "wrong password" },
      { email: inactive, password: PASSWORD },
    ]) {
      const response = await signIn(makeRuntimeLike(runtime), body);
      expect(response.status).toBe(401);
      expect(response.headers.getSetCookie()).toEqual([]);
      const error = (await json(response))["error"] as Record<string, unknown>;
      delete error["requestId"];
      bodies.push(JSON.stringify(error));
    }
    expect(new Set(bodies).size).toBe(1);
    expect(await db.session.count({ where: { userId: inactiveId } })).toBe(0);
  });

  it("a duplicate sign-up writes neither the email nor the name to any log line", async () => {
    const { logger, lines } = captureLog();
    const runtime = makeRuntime({ logger });
    const email = freshEmail("zz9dupcanary");
    await register(runtime, email);
    const response = await handleSignUp(
      post("/api/v1/auth/sign-up", {
        body: { name: "Zz9NameCanary", email: email.toUpperCase(), password: "Zz9PwCanary!" },
      }),
      runtime,
    );
    expect(response.status).toBe(200);
    const written = JSON.stringify(lines).toLowerCase();
    for (const canary of ["zz9dupcanary", "zz9namecanary", "zz9pwcanary"]) {
      expect(written).not.toContain(canary);
    }
  });
});

/** A fresh runtime (own limiter) with the same auth instance, so limits do not interfere. */
function makeRuntimeLike(runtime: Runtime): Runtime {
  return { ...makeRuntime(), auth: runtime.auth };
}

describe("admin bootstrap (adversarial, passing)", () => {
  async function run(env: Record<string, string | undefined>) {
    const lines: string[] = [];
    const status = await runBootstrapAdmin(env, {
      out: (line) => lines.push(line),
      err: (line) => lines.push(line),
    });
    return { status, output: lines.join("\n") };
  }

  it("refuses a customer whose stored email differs in letter case; nothing changes", async () => {
    const runtime = makeRuntime();
    const email = freshEmail("mixedcase");
    const userId = await register(runtime, email);
    // A row whose email is not lower-cased (not something sign-up writes; a seed or import might).
    const upper = email.replace("mixedcase", "MixedCase");
    await db.user.update({ where: { id: userId }, data: { email: upper } });
    const before = await db.account.findMany({ where: { userId } });
    const { status, output } = await run({
      [BOOTSTRAP_ENV.email]: `  ${email.toUpperCase()}  `,
      [BOOTSTRAP_ENV.password]: "Q7secretPassphrase",
    });
    expect(status).toBe(BOOTSTRAP_EXIT.refused);
    expect(output).not.toContain("Q7secretPassphrase");
    expect(output.toLowerCase()).not.toContain(email.toLowerCase());
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.role).toBe("CUSTOMER");
    expect(await db.account.findMany({ where: { userId } })).toEqual(before);
    expect(
      await db.user.count({
        where: { role: "ADMIN", email: { equals: email, mode: "insensitive" } },
      }),
    ).toBe(0);
  });

  it("an existing deactivated admin is neither reactivated nor given the new password", async () => {
    const first = await run({
      [BOOTSTRAP_ENV.email]: "root.admin@example.com",
      [BOOTSTRAP_ENV.password]: "original passphrase",
    });
    expect(first.status).toBe(BOOTSTRAP_EXIT.ok);
    const admin = await db.user.update({
      where: { email: "root.admin@example.com" },
      data: { isActive: false },
    });
    const hashBefore = (await db.account.findFirstOrThrow({ where: { userId: admin.id } }))
      .password;
    const again = await run({
      [BOOTSTRAP_ENV.email]: "ROOT.ADMIN@example.com",
      [BOOTSTRAP_ENV.password]: "replacement passphrase",
    });
    expect(again.status).toBe(BOOTSTRAP_EXIT.ok);
    expect(again.output).not.toContain("replacement passphrase");
    const after = await db.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(after.isActive).toBe(false);
    expect((await db.account.findFirstOrThrow({ where: { userId: admin.id } })).password).toBe(
      hashBefore,
    );
    const runtime = makeRuntime();
    const response = await signIn(runtime, {
      email: "root.admin@example.com",
      password: "replacement passphrase",
    });
    expect(response.status).toBe(401);
  });

  it("invalid input names the variable and never its value", async () => {
    const usersBefore = await db.user.count();
    const { status, output } = await run({
      [BOOTSTRAP_ENV.email]: "not-an-email-Q8canary",
      [BOOTSTRAP_ENV.password]: "Q8short",
      [BOOTSTRAP_ENV.name]: "bad\u0000Q8namecanary",
    });
    expect(status).toBe(BOOTSTRAP_EXIT.invalidInput);
    expect(output).toContain(BOOTSTRAP_ENV.email);
    expect(output).toContain(BOOTSTRAP_ENV.password);
    expect(output).toContain(BOOTSTRAP_ENV.name);
    expect(output.toLowerCase()).not.toContain("q8");
    expect(await db.user.count()).toBe(usersBefore);
  });

  it("no sign-up input can produce an ADMIN, a SELLER, or an inactive user", async () => {
    const runtime = makeRuntime();
    const privilegedBefore = await db.user.count({ where: { role: { not: "CUSTOMER" } } });
    for (const extra of [
      { role: "ADMIN" },
      { ROLE: "ADMIN" },
      { "role ": "ADMIN" },
      { __proto__: { role: "ADMIN" } },
      { constructor: { prototype: { role: "ADMIN" } } },
    ]) {
      const email = freshEmail("esc");
      const raw = JSON.stringify({ name: "m", email, password: PASSWORD, ...extra });
      const response = await handleSignUp(
        post("/api/v1/auth/sign-up", { rawBody: raw }),
        makeRuntimeLike(runtime),
      );
      if (response.status === 200) {
        const user = await db.user.findUniqueOrThrow({ where: { email } });
        expect(user).toMatchObject({ role: "CUSTOMER", isActive: true });
      } else {
        expect(response.status).toBe(400);
        expect(await db.user.count({ where: { email } })).toBe(0);
      }
    }
    // A literal "__proto__" key in the JSON text (JSON.stringify above drops a prototype).
    const email = freshEmail("proto");
    const response = await handleSignUp(
      post("/api/v1/auth/sign-up", {
        rawBody: `{"name":"m","email":"${email}","password":"${PASSWORD}","__proto__":{"role":"ADMIN"}}`,
      }),
      makeRuntimeLike(runtime),
    );
    expect(response.status).toBe(400);
    expect(await db.user.count({ where: { email } })).toBe(0);
    expect(await db.user.count({ where: { role: { not: "CUSTOMER" } } })).toBe(privilegedBefore);
  });
});
