/**
 * Re-check of SEC-038 (a cookie name padded with a character `String.prototype.trim` removes was
 * read as the `__Host-` session cookie), fix dea1fa6: `headersForAuthLibrary` in
 * src/server/auth/cookies.ts. Owner: security. Review: docs/reviews/SEC-037-038-recheck.md. Runs
 * with `pnpm test:integration` (test database).
 *
 * Each case puts an attacker's valid session cookie under a padded or otherwise disguised name
 * ahead of the victim's real cookie and checks that the server never answers with the attacker's
 * user. Characters are built with `String.fromCharCode` so that this source holds none of them.
 */
import { describe, expect, it } from "vitest";

import { getActor } from "@/server/auth/session";
import { handleGetSession, handleSignIn, handleSignOut } from "@/server/auth/routes";
import { db } from "@/server/db";

import {
  cookieFrom,
  freshEmail,
  json,
  makeRuntime,
  PASSWORD,
  post,
} from "../integration/auth/support";

type Runtime = ReturnType<typeof makeRuntime>;

const SHOP = "https://shop.example.test";
const HOST_NAME = "__Host-better-auth.session_token";
const NBSP = String.fromCharCode(0xa0);
const TAB = String.fromCharCode(0x09);

function productionRuntime(): Runtime {
  return makeRuntime({ secureCookies: true, baseUrl: SHOP, appOrigin: SHOP });
}

function prodPost(path: string, options: { body?: unknown; cookie?: string } = {}): Request {
  return post(path, { ...options, origin: SHOP, url: `${SHOP}${path}` });
}

async function productionSession(runtime: Runtime): Promise<{ value: string; userId: string }> {
  const email = freshEmail("sec038");
  await runtime.auth.api.signUpEmail({ body: { name: "Test", email, password: PASSWORD } });
  const userId = (await db.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
  const response = await handleSignIn(
    prodPost("/api/v1/auth/sign-in", { body: { email, password: PASSWORD } }),
    runtime,
  );
  expect(response.status).toBe(200);
  const pair = cookieFrom(response)
    .split("; ")
    .find((entry) => entry.startsWith(`${HOST_NAME}=`));
  expect(pair).toBeDefined();
  return { value: (pair ?? "").slice(HOST_NAME.length + 1), userId };
}

/** The user id the session route answers for a request carrying `cookieLines` as Cookie headers. */
async function sessionUserFor(runtime: Runtime, ...cookieLines: string[]): Promise<unknown> {
  const headers = new Headers();
  for (const line of cookieLines) headers.append("cookie", line);
  const request = new Request(`${SHOP}/api/v1/auth/session`, { method: "GET", headers });
  const data = (await json(await handleGetSession(request, runtime)))["data"] as Record<
    string,
    unknown
  > | null;
  return data === null ? null : data["userId"];
}

/** Code units 0x00 to 0xFF that `trim` removes, other than SP and HTAB, and that a header value may hold. */
function extraTrimmedLatin1(): number[] {
  const found: number[] = [];
  for (let code = 0; code <= 0xff; code += 1) {
    const char = String.fromCharCode(code);
    if (char === " " || char === TAB || char.trim() !== "") continue;
    try {
      new Headers({ cookie: `a${char}b=c` });
    } catch {
      continue;
    }
    found.push(code);
  }
  return found;
}

describe("SEC-038 re-check: no padded or disguised name is read as the session", () => {
  it("the padding characters a request can carry are exactly U+000B, U+000C, U+00A0", () => {
    // CR and LF are refused by the Headers API inside a value, so they cannot reach the parser.
    expect(extraTrimmedLatin1()).toEqual([0x0b, 0x0c, 0xa0]);
  });

  it("each of them, at the start or end and mixed with SP and HTAB, sent first, never yields the attacker", async () => {
    const runtime = productionRuntime();
    const victim = await productionSession(runtime);
    const attacker = await productionSession(runtime);
    const answers: string[] = [];
    for (const code of extraTrimmedLatin1()) {
      const pad = String.fromCharCode(code);
      for (const [before, after] of [
        [pad, ""],
        ["", pad],
        [`${TAB}${pad}`, ""],
        [` ${pad} `, ""],
        ["", ` ${pad}${TAB}`],
        [pad, pad],
      ] as const) {
        const cookie = `${before}${HOST_NAME}${after}=${attacker.value}; ${HOST_NAME}=${victim.value}`;
        const user = await sessionUserFor(runtime, cookie);
        if (user !== victim.userId)
          answers.push(`${code.toString(16)} ${JSON.stringify([before, after])}: ${String(user)}`);
      }
    }
    expect(answers).toEqual([]);
  });

  it("an attacker cookie in a separate Cookie header line, sent first, does not yield the attacker", async () => {
    const runtime = productionRuntime();
    const victim = await productionSession(runtime);
    const attacker = await productionSession(runtime);
    const user = await sessionUserFor(
      runtime,
      `${NBSP}${HOST_NAME}=${attacker.value}`,
      `${HOST_NAME}=${victim.value}`,
    );
    expect(user).toBe(victim.userId);
    // The Headers API joins two Cookie lines with "; " (measured: two unpadded `__Host-` lines
    // answer with the first), so a second line is the same as a second pair in one line and the
    // filter sees every pair.
    const joined = new Headers();
    joined.append("cookie", "a=1");
    joined.append("cookie", "b=2");
    expect(joined.get("cookie")).toBe("a=1; b=2");
  });

  it("a pair without '=' or with an empty name before the padded pair changes nothing", async () => {
    const runtime = productionRuntime();
    const victim = await productionSession(runtime);
    const attacker = await productionSession(runtime);
    for (const prefix of ["junk; ", "junk;", "=x; ", ";;; ", "a; b; "]) {
      const cookie = `${prefix}${NBSP}${HOST_NAME}=${attacker.value}; ${HOST_NAME}=${victim.value}`;
      expect(await sessionUserFor(runtime, cookie), JSON.stringify(prefix)).toBe(victim.userId);
    }
  });

  it("a padded pair hidden in a quoted value of another cookie does not yield the attacker", async () => {
    const runtime = productionRuntime();
    const victim = await productionSession(runtime);
    const attacker = await productionSession(runtime);
    const cookie = `theme="x; ${NBSP}${HOST_NAME}=${attacker.value}"; ${HOST_NAME}=${victim.value}`;
    expect(await sessionUserFor(runtime, cookie)).not.toBe(attacker.userId);
  });

  it("the page path (getActor with a Headers object) drops the padded pair too", async () => {
    const runtime = productionRuntime();
    const victim = await productionSession(runtime);
    const attacker = await productionSession(runtime);
    const headers = new Headers({
      cookie: `${NBSP}${HOST_NAME}=${attacker.value}; ${HOST_NAME}=${victim.value}`,
    });
    expect((await getActor(headers, runtime.auth))?.userId).toBe(victim.userId);
    const onlyPadded = new Headers({ cookie: `${HOST_NAME}${NBSP}=${attacker.value}` });
    expect(await getActor(onlyPadded, runtime.auth)).toBeNull();
  });

  it("sign-out with only a padded attacker cookie is 401 and ends no session", async () => {
    const runtime = productionRuntime();
    const attacker = await productionSession(runtime);
    const response = await handleSignOut(
      prodPost("/api/v1/auth/sign-out", { cookie: `${NBSP}${HOST_NAME}=${attacker.value}` }),
      runtime,
    );
    expect(response.status).toBe(401);
    expect(await sessionUserFor(runtime, `${HOST_NAME}=${attacker.value}`)).toBe(attacker.userId);
  });

  it("the filter does not drop the real cookie when other cookies are padded or odd", async () => {
    const runtime = productionRuntime();
    const victim = await productionSession(runtime);
    const cookie = `${NBSP}theme=dark; lang${NBSP}=th; ${TAB}${HOST_NAME}${TAB}=${victim.value}; x=1=2`;
    expect(await sessionUserFor(runtime, cookie)).toBe(victim.userId);
  });
});
