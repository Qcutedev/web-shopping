/**
 * Session 116 security review, 2026-10-27. Owner: security. Record: docs/reviews/S116-security.md.
 *
 * Commits reviewed:
 *   949285f  SIGN_UP_RATE_LIMIT, an e2e-only override of the sign-up limit (5 per address per hour).
 *   2bd6ded  The storefront header reads the session (account menu, real cart count).
 *   S138     (re-pinned 2026-10-31, owner decision) The account menu also gets `isAdmin`,
 *            `isSeller`, and the badge counts of `getNavCounts`, scoped by the session's actor.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 * Pure: no database, no network. The configuration is stubbed per case. The one open finding (SEC-093) is reproduced by `it.fails` in
 * `s116-sign-up-limit.test.ts`; there is none here.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });

// Outside a Next.js request `connection()` has no work to do.
vi.mock("next/server", () => ({ connection: () => Promise.resolve() }));

const ROOT = process.cwd();
const APP_URL = "https://shop.example.test";
const DATABASE_URL = "postgresql://shop:Zq7dbPw@db.example.test:5432/shop?schema=public";
const GOOD_SECRET = "Kd2Xw9Lm4Rt6Pn3bYc5Hj8Vz7Qs1Gf0U";
const UPLOAD_DIR = resolve("/srv/shop-uploads");
const LIMITER_STATE = Symbol.for("marketplace.rateLimit.processState");

function stubEnv(overrides: Record<string, string>) {
  const base: Record<string, string> = {
    NODE_ENV: "development",
    APP_URL,
    DATABASE_URL,
    AUTH_SECRET: GOOD_SECRET,
    TRUSTED_PROXY_HOPS: "0",
    UPLOAD_DIR,
    TRUSTED_CLIENT_IP_HEADER: "",
    PAYMENT_TIMEOUT_MINUTES: "",
    SIGN_UP_RATE_LIMIT: "",
    LOG_LEVEL: "",
    DATABASE_URL_TEST: "",
    PGPASSWORD: "",
    BETTER_AUTH_SECRET: "",
    BETTER_AUTH_SECRETS: "",
    BETTER_AUTH_URL: "",
    BETTER_AUTH_TRUSTED_ORIGINS: "",
    BETTER_AUTH_TELEMETRY: "",
    BETTER_AUTH_TELEMETRY_ENDPOINT: "",
    BETTER_AUTH_TELEMETRY_DEBUG: "",
  };
  for (const [name, value] of Object.entries({ ...base, ...overrides })) vi.stubEnv(name, value);
}

function resetLimiterTable() {
  delete (globalThis as Record<symbol, unknown>)[LIMITER_STATE];
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|mts|mjs|js)$/.test(name)) out.push(path);
  }
  return out;
}

const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
  resetLimiterTable();
});

// ---------------------------------------------------------------------------------------------
// 949285f: SIGN_UP_RATE_LIMIT
// ---------------------------------------------------------------------------------------------

describe("949285f: SIGN_UP_RATE_LIMIT cannot reach production", () => {
  it.each(["1", "5", "6", "1000", " 5", "abc"])(
    "parseEnv refuses SIGN_UP_RATE_LIMIT=%j when NODE_ENV=production",
    async (value) => {
      const { parseEnv, EnvValidationError } = await import("@/server/env");
      const source = {
        NODE_ENV: "production",
        APP_URL,
        DATABASE_URL,
        AUTH_SECRET: GOOD_SECRET,
        TRUSTED_PROXY_HOPS: "1",
        UPLOAD_DIR,
        SIGN_UP_RATE_LIMIT: value,
      };
      expect(() => parseEnv(source)).toThrow(EnvValidationError);
    },
  );

  it("an empty value in production is the same as unset: the code limit of 5", async () => {
    const { parseEnv } = await import("@/server/env");
    const env = parseEnv({
      NODE_ENV: "production",
      APP_URL,
      DATABASE_URL,
      AUTH_SECRET: GOOD_SECRET,
      TRUSTED_PROXY_HOPS: "1",
      UPLOAD_DIR,
      SIGN_UP_RATE_LIMIT: "",
    });
    expect(env.signUpRateLimit).toBe(5);
  });

  it.each(["Production", "PRODUCTION", "prod", "staging", " production", "production "])(
    "a misspelt NODE_ENV (%j) does not dodge the production check: it is refused itself",
    async (nodeEnv) => {
      const { parseEnv, EnvValidationError } = await import("@/server/env");
      expect(() =>
        parseEnv({ NODE_ENV: nodeEnv, APP_URL, DATABASE_URL, AUTH_SECRET: GOOD_SECRET }),
      ).toThrow(EnvValidationError);
    },
  );

  it("signUpRateLimiter refuses any non-default limit in production even when parseEnv is bypassed", async () => {
    const { signUpRateLimiter, rateLimiter, RATE_LIMITS } = await import("@/server/rate-limit");
    for (const limit of [1, 4, 6, 1000, 1001, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => signUpRateLimiter(limit, "production"), String(limit)).toThrow(TypeError);
    }
    const same = signUpRateLimiter(5, "production");
    expect(same.limiter).toBe(rateLimiter);
    expect(same.rule).toBe(RATE_LIMITS.SIGN_UP);
  });

  it("getAuthRuntime throws in production with the variable set, and the sign-up route answers 500", async () => {
    stubEnv({ NODE_ENV: "production", TRUSTED_PROXY_HOPS: "1", SIGN_UP_RATE_LIMIT: "1000" });
    const { getAuthRuntime } = await import("@/server/auth/routes");
    expect(() => getAuthRuntime()).toThrow(/SIGN_UP_RATE_LIMIT/);
    vi.resetModules();
    const { POST } = await import("@/app/api/v1/auth/sign-up/route");
    const response = await POST(
      new Request(`${APP_URL}/api/v1/auth/sign-up`, {
        method: "POST",
        headers: { Origin: APP_URL, "Content-Type": "application/json" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("1000");
  });

  it("a client cannot raise the limit: the 6th sign-up from one address is 429 whatever the request carries", async () => {
    stubEnv({});
    resetLimiterTable();
    const { POST } = await import("@/app/api/v1/auth/sign-up/route");
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const response = await POST(
        new Request(`${APP_URL}/api/v1/auth/sign-up?SIGN_UP_RATE_LIMIT=1000&signUpRateLimit=1000`, {
          method: "POST",
          headers: {
            Origin: APP_URL,
            "Content-Type": "application/json",
            "X-Forwarded-For": `198.51.100.${i + 1}`,
            "X-Real-IP": `198.51.100.${i + 1}`,
            SIGN_UP_RATE_LIMIT: "1000",
            "X-Sign-Up-Rate-Limit": "1000",
            Cookie: "SIGN_UP_RATE_LIMIT=1000",
          },
          // Invalid on purpose: the limit is consumed before the body is parsed, so no database.
          body: JSON.stringify({
            SIGN_UP_RATE_LIMIT: 1000,
            signUpRateLimit: 1000,
            signUpRule: { name: "sign-up", limit: 1000 },
          }),
        }),
      );
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 5).every((status) => status !== 429)).toBe(true);
    expect(statuses[5]).toBe(429);
  });

  it("positive control: outside production the operator's variable does raise the limit", async () => {
    stubEnv({ SIGN_UP_RATE_LIMIT: "8" });
    resetLimiterTable();
    const { POST } = await import("@/app/api/v1/auth/sign-up/route");
    const statuses: number[] = [];
    for (let i = 0; i < 9; i += 1) {
      const response = await POST(
        new Request(`${APP_URL}/api/v1/auth/sign-up`, {
          method: "POST",
          headers: { Origin: APP_URL, "Content-Type": "application/json" },
          body: "{}",
        }),
      );
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 8).every((status) => status !== 429)).toBe(true);
    expect(statuses[8]).toBe(429);
  });

  it("the variable is read only by src/server/env.ts; no client, public, or request path names it", () => {
    const readers = walk(join(ROOT, "src"))
      .filter((path) => !/\.test\.tsx?$/.test(path))
      .filter((path) => readFileSync(path, "utf8").includes("SIGN_UP_RATE_LIMIT"))
      .map((path) => relative(ROOT, path).replaceAll("\\", "/"));
    expect(readers).toEqual(["src/server/env.ts"]);
    expect(read("next.config.ts")).not.toContain("SIGN_UP_RATE_LIMIT");
    for (const path of walk(join(ROOT, "src"))) {
      expect(readFileSync(path, "utf8"), path).not.toMatch(/NEXT_PUBLIC_SIGN_UP/);
    }
    // The handler takes the rule from the runtime only, never from the request.
    const routes = read("src/server/auth/routes.ts");
    expect(routes).toContain("runtime.signUpRule ?? RATE_LIMITS.SIGN_UP");
    expect(routes.match(/signUpRule/g)?.length).toBe(3);
  });

  it("the only setter is playwright.config.ts, and the e2e server it starts is next dev with NODE_ENV=development", () => {
    const setters = [
      ...walk(join(ROOT, "e2e")),
      ...walk(join(ROOT, "scripts")),
      join(ROOT, "playwright.config.ts"),
    ]
      .filter((path) => /SIGN_UP_RATE_LIMIT\s*=/.test(readFileSync(path, "utf8")))
      .map((path) => relative(ROOT, path).replaceAll("\\", "/"));
    expect(setters).toEqual(["playwright.config.ts"]);
    const server = read("e2e/support/server-environment.ts");
    expect(server).toContain('NODE_ENV: "development"');
    expect(server).toContain("pnpm exec next dev");
    expect(read("playwright.config.ts")).toContain("reuseExistingServer: false");
    for (const file of ["Dockerfile", ".github/workflows/ci.yml"]) {
      expect(read(file), file).not.toContain("SIGN_UP_RATE_LIMIT");
    }
    expect(read("Dockerfile")).toMatch(/ENV NODE_ENV=production/);
  });

  it(".env.example leaves it commented out (a copied .env gets the default)", () => {
    const lines = read(".env.example").split(/\r?\n/);
    expect(lines.filter((line) => /^\s*SIGN_UP_RATE_LIMIT\s*=/.test(line))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// 2bd6ded: the header reads the session
// ---------------------------------------------------------------------------------------------

const CANARY_EMAIL = "zq7canary@example.test";
const CANARY_PHONE = "0812345678";
const CANARY_USER = "user-Zq7canary";
const CANARY_STORE = "store-Zq7canary";
const CANARY_TOKEN = "token-Zq7canary";

type Seen = { type: string; props: Record<string, unknown> };

/** Every element of a returned tree, with its type name and its non-children props. */
function elements(node: ReactNode, out: Seen[] = []): Seen[] {
  if (Array.isArray(node)) {
    for (const each of node) elements(each, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  const element = node as ReactElement<Record<string, unknown>>;
  const type =
    typeof element.type === "string"
      ? element.type
      : typeof element.type === "function"
        ? element.type.name
        : String(element.type);
  const { children, ...props } = element.props;
  out.push({ type, props });
  elements(children as ReactNode, out);
  return out;
}

async function loadHeaderSession(actor: unknown, profile: unknown, cart: unknown) {
  vi.doMock("next/navigation", () => ({
    useRouter: () => ({ replace: () => undefined, refresh: () => undefined }),
    unstable_rethrow: () => undefined,
  }));
  vi.doMock("next/headers", () => ({
    headers: () => Promise.resolve(new Headers({ cookie: `session=${CANARY_TOKEN}` })),
  }));
  vi.doMock("@/server/auth/session", () => ({ getActor: () => Promise.resolve(actor) }));
  vi.doMock("@/modules/profile", () => ({ getProfile: () => Promise.resolve(profile) }));
  // Since 21c9c33 (CR-S116-02) the header reads one COUNT through countCartLines, not the priced
  // cart. The count is derived from the same fixture; getCart stays mocked so a return to the
  // priced cart still exercises the canary checks below.
  const lines = (cart as { stores?: { items: unknown[] }[] } | undefined)?.stores?.flatMap(
    (store) => store.items,
  ).length;
  vi.doMock("@/modules/cart", () => ({
    getCart: () => Promise.resolve(cart),
    countCartLines: () => Promise.resolve(lines ?? 0),
  }));
  // Session 138: the real notifications service runs; only its COUNT statements are replaced, so
  // the role and store scoping of `getNavCounts` is what is tested here, not a stub of it.
  vi.doMock("@/modules/notifications/repository", () => countRepository);
  const { HeaderSession } = await import("@/components/shell/header-session");
  return HeaderSession;
}

/** Recording stand-ins for the four COUNT statements, each with a distinct value. */
const countCalls: { name: string; args: unknown[] }[] = [];
const countRepository = {
  countShippedForCustomer: (...args: unknown[]) => {
    countCalls.push({ name: "countShippedForCustomer", args });
    return Promise.resolve(7);
  },
  countToShipForStore: (...args: unknown[]) => {
    countCalls.push({ name: "countToShipForStore", args });
    return Promise.resolve(11);
  },
  countPendingApplications: (...args: unknown[]) => {
    countCalls.push({ name: "countPendingApplications", args });
    return Promise.resolve(13);
  },
  countPendingProducts: (...args: unknown[]) => {
    countCalls.push({ name: "countPendingProducts", args });
    return Promise.resolve(17);
  },
};

/** What each role may see and which counts may be read for it (owner decision 2026-10-31). */
const EXPECTED_BY_ROLE: Record<
  string,
  {
    isAdmin: boolean;
    isSeller: boolean;
    counts: Record<string, number>;
    calls: { name: string; args: unknown[] }[];
  }
> = {
  ADMIN: {
    isAdmin: true,
    isSeller: false,
    counts: { ordersOnTheWay: 7, sellerToShip: 0, pendingApplications: 13, pendingProducts: 17 },
    calls: [
      { name: "countShippedForCustomer", args: [CANARY_USER] },
      { name: "countPendingApplications", args: [] },
      { name: "countPendingProducts", args: [] },
    ],
  },
  SELLER: {
    isAdmin: false,
    isSeller: true,
    counts: { ordersOnTheWay: 7, sellerToShip: 11, pendingApplications: 0, pendingProducts: 0 },
    calls: [
      { name: "countShippedForCustomer", args: [CANARY_USER] },
      { name: "countToShipForStore", args: [CANARY_STORE] },
    ],
  },
  CUSTOMER: {
    isAdmin: false,
    isSeller: false,
    counts: { ordersOnTheWay: 7, sellerToShip: 0, pendingApplications: 0, pendingProducts: 0 },
    calls: [{ name: "countShippedForCustomer", args: [CANARY_USER] }],
  },
};

describe("2bd6ded: the header session part", () => {
  afterEach(() => {
    for (const name of [
      "next/navigation",
      "next/headers",
      "@/server/auth/session",
      "@/modules/profile",
      "@/modules/cart",
      "@/modules/notifications/repository",
    ]) {
      vi.doUnmock(name);
    }
  });

  beforeEach(() => {
    countCalls.length = 0;
  });

  it.each(["ADMIN", "SELLER", "CUSTOMER"])(
    "%s: only the name, two booleans, the badge counts, and a line count cross to the client; no id, role, store, email, phone, or token",
    async (role) => {
      const actor = Object.freeze({
        userId: CANARY_USER,
        role,
        storeId: role === "SELLER" ? CANARY_STORE : null,
        storeStatus: role === "SELLER" ? "ACTIVE" : null,
      });
      const profile = {
        id: CANARY_USER,
        name: "Somchai",
        email: CANARY_EMAIL,
        phone: CANARY_PHONE,
        role,
        storeId: actor.storeId,
      };
      const cart = {
        stores: [
          {
            storeId: CANARY_STORE,
            items: [{ id: "l1", productId: "p1", unitPrice: 12_300, title: "x" }],
          },
        ],
        total: 12_300,
      };
      const HeaderSession = await loadHeaderSession(actor, profile, cart);
      const seen = elements(await HeaderSession());
      const named = seen.filter((each) => each.type === "AccountMenu" || each.type === "CartLink");
      const expected = EXPECTED_BY_ROLE[role];
      // Exact contract: toEqual fails on any extra key (id, email, role string, storeId, ...).
      expect(named).toEqual([
        {
          type: "AccountMenu",
          props: {
            name: "Somchai",
            isAdmin: expected?.isAdmin,
            isSeller: expected?.isSeller,
            counts: expected?.counts,
          },
        },
        { type: "CartLink", props: { count: 1 } },
      ]);
      expect(Object.keys(named[0]?.props ?? {})).toEqual(["name", "isAdmin", "isSeller", "counts"]);
      // Counts are read for this actor only: the user's own orders, the session's store for a
      // seller, the admin queues for an admin. Nothing else is queried.
      expect(countCalls).toEqual(expected?.calls);
      const text = JSON.stringify(seen);
      for (const canary of [CANARY_EMAIL, CANARY_PHONE, CANARY_USER, CANARY_STORE, CANARY_TOKEN]) {
        expect(text, canary).not.toContain(canary);
      }
      expect(text).not.toMatch(/ADMIN|SELLER|CUSTOMER|12300|12_300/);
    },
  );

  it("an actor whose role is not SELLER never reads a store count, even holding a store id", async () => {
    for (const role of ["CUSTOMER", "ADMIN"]) {
      countCalls.length = 0;
      vi.resetModules();
      const actor = Object.freeze({
        userId: CANARY_USER,
        role,
        storeId: CANARY_STORE,
        storeStatus: "APPROVED",
      });
      const HeaderSession = await loadHeaderSession(actor, { name: "x" }, undefined);
      const menu = elements(await HeaderSession()).find((each) => each.type === "AccountMenu");
      expect(menu?.props.isSeller, role).toBe(false);
      expect((menu?.props.counts as { sellerToShip: number }).sellerToShip, role).toBe(0);
      expect(
        countCalls.map((call) => call.name),
        role,
      ).not.toContain("countToShipForStore");
    }
  });

  it("a SELLER without a store gets no seller link and no store count", async () => {
    const actor = Object.freeze({
      userId: CANARY_USER,
      role: "SELLER",
      storeId: null,
      storeStatus: null,
    });
    const HeaderSession = await loadHeaderSession(actor, { name: "x" }, undefined);
    const menu = elements(await HeaderSession()).find((each) => each.type === "AccountMenu");
    expect(menu?.props.isSeller).toBe(false);
    expect(menu?.props.isAdmin).toBe(false);
    expect(countCalls.map((call) => call.name)).toEqual(["countShippedForCustomer"]);
  });

  it("a visitor or a deactivated user (getActor null) gets the signed-out links and nothing read", async () => {
    const HeaderSession = await loadHeaderSession(null, undefined, undefined);
    const seen = elements(await HeaderSession());
    expect(seen.map((each) => each.type)).toEqual(["SignedOutNav"]);
  });

  it("the client component imports no module code, and links to the admin and seller pages only behind their flags", () => {
    const menu = read("src/components/shell/account-menu.tsx");
    expect(menu.startsWith('"use client";')).toBe(true);
    // The one allowed mention of src/modules is a type-only import (erased at compile time).
    const serverImports = menu
      .split(/\r?\n/)
      .filter((line) => /from "@\/(server|modules)/.test(line));
    expect(serverImports).toEqual(['import type { NavCounts } from "@/modules/notifications";']);
    // ROUTES.admin once, inside `{isAdmin ? (`; ROUTES.seller once, inside `{isSeller ? (`.
    expect(menu.match(/ROUTES\.admin\b/g)).toEqual(["ROUTES.admin"]);
    expect(menu.match(/ROUTES\.seller\w*/g)).toEqual(["ROUTES.seller"]);
    expect(menu).toMatch(/\{isAdmin \? \(\s*<Link\s+href=\{ROUTES\.admin\}/);
    expect(menu).toMatch(/\{isSeller \? \(\s*<Link\s+href=\{ROUTES\.seller\}/);
    // Exact props: a name, two booleans that default to false, and the counts. Nothing else.
    expect(menu).toMatch(
      /export function AccountMenu\(\{\s*name,\s*isAdmin = false,\s*isSeller = false,\s*counts,\s*\}: \{\s*name: string \| null;\s*isAdmin\?: boolean;\s*isSeller\?: boolean;\s*counts\?: NavCounts;\s*\}\)/,
    );
    expect(menu).not.toContain("dangerouslySetInnerHTML");
  });

  it("NavCounts holds the four counts only", () => {
    const service = read("src/modules/notifications/service.ts");
    const body = /export interface NavCounts \{([\s\S]*?)\n\}/.exec(service)?.[1] ?? "";
    const fields = [...body.matchAll(/^\s*(\w+)\??:\s*([^;]+);/gm)].map((m) => `${m[1]}: ${m[2]}`);
    expect(fields).toEqual([
      "ordersOnTheWay: number",
      "sellerToShip: number",
      "pendingApplications: number",
      "pendingProducts: number",
    ]);
  });

  it("the server part is not a client module and passes only name, two role booleans, counts, and count", () => {
    const source = read("src/components/shell/header-session.tsx");
    expect(source).not.toMatch(/^\s*["']use client["']/m);
    const tags = (pattern: RegExp) =>
      (source.match(pattern) ?? []).map((tag) => tag.replace(/\s+/g, " "));
    expect(tags(/<AccountMenu[^>]*>/g)).toEqual([
      '<AccountMenu name={name} isAdmin={actor.role === "ADMIN"} isSeller={actor.role === "SELLER" && actor.storeId !== null} counts={counts} />',
    ]);
    expect(tags(/<CartLink[^>]*>/g)).toEqual(["<CartLink count={count} />"]);
    expect(source).toContain("getNavCounts(actor)");
  });

  it("no cache directive anywhere in src, so no per-user render can be stored and served to another user", () => {
    const offenders = walk(join(ROOT, "src"))
      .filter((path) => !/\.test\.tsx?$/.test(path))
      .filter((path) =>
        /["']use cache(: *[a-z]+)?["']|unstable_cache|cacheLife\(|cacheTag\(/.test(
          readFileSync(path, "utf8"),
        ),
      )
      .map((path) => relative(ROOT, path).replaceAll("\\", "/"));
    expect(offenders).toEqual([]);
    expect(read("next.config.ts")).not.toMatch(/staleTimes/);
  });

  it("the session read sits behind Suspense in every shell, with a fallback that holds no user data", () => {
    const shell = read("src/components/shell/storefront-shell.tsx");
    expect(shell).toMatch(
      /<Suspense fallback=\{<CartLink \/>\}>\s*<HeaderSession \/>\s*<\/Suspense>/,
    );
    for (const layout of [
      "src/app/(storefront)/layout.tsx",
      "src/app/admin/layout.tsx",
      "src/app/seller/layout.tsx",
      "src/app/not-found.tsx",
    ]) {
      const source = read(layout);
      expect(source, layout).toContain("StorefrontShell");
      expect(source, layout).not.toMatch(/getActor|requireActor|@\/server|@\/modules/);
    }
  });

  it("sign-out uses the guarded POST endpoint (same-origin credentials, JSON content type)", () => {
    const client = read("src/lib/api-client/auth.ts");
    expect(client).toContain('apiRequest("/api/v1/auth/sign-out", { method: "POST", fetchImpl })');
    const routes = read("src/server/auth/routes.ts");
    const body = routes.slice(routes.indexOf("export async function handleSignOut("));
    expect(body.indexOf("checkOrigin(request, runtime, scope);")).toBeGreaterThan(0);
    expect(body.indexOf("assertContentType(request, JSON_CONTENT_TYPE);")).toBeGreaterThan(0);
  });
});
