/**
 * Security review of T-040 (seller application and store), 2026-10-15. Owner: security. Review:
 * docs/reviews/T-040-security.md. Database cases are in tests/security/t040-sellers.itest.ts.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040): every
 * other code point is built with String.fromCodePoint.
 *
 * Covered here, without a database:
 *   - the two route files are thin and keep the order of refusals of API_CONTRACTS.md 1.8;
 *   - store names and every line of a description follow the user-name rule exactly (the same
 *     strings are accepted and refused as by sign-up and profile names);
 *   - prototype keys in a body are refused by the strict schemas;
 *   - parsing the largest body the reader admits stays cheap;
 *   - the response shapes carry no owner id, upload id, or reviewer id.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { NAME_ALLOWED_TEXT, signUpBodySchema } from "@/modules/auth/schema";
import { profileNameSchema } from "@/modules/profile/schema";
import {
  storeDescriptionSchema,
  storeNameSchema,
  submitApplicationBodySchema,
  updateStoreBodySchema,
} from "@/modules/sellers";
import { toApplicationDto, toStoreDto } from "@/modules/sellers/service";
import { DEFAULT_JSON_BODY_LIMIT_BYTES } from "@/server/http";

const ROOT = process.cwd();
const cp = (...points: number[]) => String.fromCodePoint(...points);

function source(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

/** Index of the first match of `pattern` in `text`, or fails the test. */
function at(text: string, pattern: RegExp, label: string): number {
  const index = text.search(pattern);
  expect(index, label).toBeGreaterThanOrEqual(0);
  return index;
}

// ---------------------------------------------------------------------------------------------
// Route files
// ---------------------------------------------------------------------------------------------

describe("T-040 review: the seller route files are thin and keep the order of refusals", () => {
  const APPLICATION = "src/app/api/v1/seller/application/route.ts";
  const STORE = "src/app/api/v1/seller/store/route.ts";

  for (const path of [APPLICATION, STORE]) {
    it(`${path}: no database, no Prisma, no business logic import outside the module surface`, () => {
      const text = source(path);
      expect(text).not.toMatch(/@\/server\/db|@prisma|prisma\/generated/);
      expect(text).not.toMatch(/@\/modules\/sellers\/(repository|service|schema)/);
      expect(text).not.toMatch(/searchParams|params\b/);
      // Every handler runs inside the frame (no-store, request id, error mapping).
      const handlers = text.match(/export async function (GET|POST|PATCH|PUT|DELETE)\(/g) ?? [];
      const framed = text.match(/return handleRequest\(request, async/g) ?? [];
      expect(framed.length).toBe(handlers.length);
    });
  }

  it("POST /seller/application: Origin, Content-Type, session, role, rate limit on the user id, then the body", () => {
    const text = source(APPLICATION);
    const post = text.slice(at(text, /export async function POST\(/, "POST"));
    const steps = [
      at(post, /assertSameOrigin\(request/, "origin"),
      at(post, /assertContentType\(request/, "content type"),
      at(post, /requireActor\(request\)/, "session"),
      at(post, /requireRole\(actor, "CUSTOMER"\)/, "role"),
      // SEC-052: the client address first, then the user's rule, counted in the database since
      // option (b) (re-pinned 2026-10-29); its subject is the session's actor only.
      at(post, /rateLimiter\.consume\(clientIp, RATE_LIMITS\.SIGNED_IN_ADDRESS\)/, "address limit"),
      at(post, /consumeUserRateLimit\(actor, USER_RATE_LIMITS\.SELLER_APPLICATION\)/, "limit"),
      at(post, /readJsonBody\(request\)/, "body"),
      at(post, /submitApplication\(actor, body\)/, "service"),
    ];
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
  });

  it("PATCH /seller/store: Origin, Content-Type, session, approved seller, then the body; no request value names a store", () => {
    const text = source(STORE);
    const patch = text.slice(at(text, /export async function PATCH\(/, "PATCH"));
    const steps = [
      at(patch, /assertSameOrigin\(request/, "origin"),
      at(patch, /assertContentType\(request/, "content type"),
      at(patch, /requireActor\(request\)/, "session"),
      at(patch, /requireApprovedSeller\(actor\)/, "approved seller"),
      at(patch, /readJsonBody\(request\)/, "body"),
      at(patch, /updateOwnStore\(actor, body\)/, "service"),
    ];
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
    expect(text).not.toMatch(/storeId/);
  });

  it("GET handlers read the session before anything else and take no id from the request", () => {
    for (const path of [APPLICATION, STORE]) {
      const text = source(path);
      const get = text.slice(at(text, /export async function GET\(/, "GET"));
      const body = get.slice(0, get.indexOf("export async function", 1) >>> 0);
      expect(body).toMatch(/requireActor\(request\)/);
      expect(body).not.toMatch(/request\.url|nextUrl|searchParams/);
    }
  });

  it("the module never spreads a request body into a write: data keys are named one by one", () => {
    const service = source("src/modules/sellers/service.ts");
    const repository = source("src/modules/sellers/repository.ts");
    expect(service).not.toMatch(/\.\.\.input\b|\.\.\.body\b/);
    // The one spread in the repository is ApplicationInput, which the service builds from three
    // named fields (submitApplication); anything else spread into `data` would be a finding.
    expect(repository.match(/data: \{[^}]*\.\.\.\w+/g)).toEqual(["data: { userId, ...input"]);
    expect(service).toMatch(
      /insertApplication\(actor\.userId, \{\s*storeName: input\.storeName,\s*description: input\.description,\s*contactPhone: input\.contactPhone,\s*\}\)/,
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Name rule reuse
// ---------------------------------------------------------------------------------------------

/** Strings with no surrounding white space, so a one-line schema's trim does not change them. */
const PROBES: readonly string[] = [
  "Shop ABC",
  cp(0x0e23, 0x0e49, 0x0e32, 0x0e19) + " ABC", // Thai "shop" with a tone mark
  cp(0x0e01, 0x0e31, 0x0e48), // base, vowel mark, tone mark
  `a${cp(0x0301).repeat(3)}`, // one mark three times: refused since D-042 point 2 (SEC-060)
  `a${cp(0x0301).repeat(4)}`, // one mark four times: repeated and over NAME_MAX_MARK_RUN
  `a${cp(0x0301, 0x0302, 0x0303)}`, // three distinct combining marks: at the limit
  `a${cp(0x0301, 0x0302, 0x0303, 0x0304)}`, // four distinct: over NAME_MAX_MARK_RUN only
  cp(0x0e40, 0x0e40, 0x0e01), // doubled sara e (D-042 point 2)
  cp(0x0e40, 0xfe0f, 0x0e40, 0x0e01), // sara e, U+FE0F, sara e: accepted today (SEC-061)
  `a${cp(0x2800)}b`, // braille pattern blank (D-042 point 2)
  `a${cp(0x200b).repeat(3)}b`,
  `a${cp(0x200b).repeat(4)}b`,
  `${cp(0x202e)}abc`, // right-to-left override
  `abc${cp(0x2066)}`, // isolate
  `a${cp(0x061c)}b`, // Arabic letter mark
  `a${cp(0x00ad)}b`, // soft hyphen
  `a${cp(0x180e)}b`, // Mongolian vowel separator
  `a${cp(0x2028)}b`,
  `a${cp(0x2029)}b`,
  `a${cp(0x0085)}b`, // NEL
  `a${cp(0x000b)}b`, // VT
  `a${cp(0x0000)}b`,
  `a${cp(0xe000)}b`, // private use
  `a${cp(0x0378)}b`, // unassigned
  `a${cp(0xfe0f)}b`, // variation selector
  `a${cp(0xe0041)}b`, // tag character
  cp(0x3164), // Hangul filler alone: blank-looking
  cp(0x2800), // Braille blank
  `a${String.fromCharCode(0xd800)}b`, // lone surrogate
  "<script>alert(1)</script>", // markup is plain text; rendering escapes it
];

describe("T-040 review: store names and description lines follow the user-name rule", () => {
  it("a store name is accepted exactly when a sign-up name and a profile name are", () => {
    for (const probe of PROBES) {
      const store = storeNameSchema.safeParse(probe).success;
      expect(store, JSON.stringify(probe)).toBe(
        signUpBodySchema.shape.name.safeParse(probe).success,
      );
      expect(store, JSON.stringify(probe)).toBe(profileNameSchema.safeParse(probe).success);
      expect(store, JSON.stringify(probe)).toBe(NAME_ALLOWED_TEXT.test(probe));
    }
  });

  it("each refused probe is refused on any line of a description, and each accepted one is accepted", () => {
    for (const probe of PROBES) {
      const asLine = storeDescriptionSchema.safeParse(`Intro line\n${probe}\nlast`).success;
      // A probe that holds CR or LF itself splits into lines; none above does except via the
      // line separators, which the name rule refuses.
      expect(asLine, JSON.stringify(probe)).toBe(NAME_ALLOWED_TEXT.test(probe));
    }
  });

  it("LF is the only line break stored: CR LF and CR become LF; NEL, U+2028, U+2029, VT, FF are refused", () => {
    expect(storeDescriptionSchema.parse("a\r\nb\rc")).toBe("a\nb\nc");
    for (const separator of [0x0085, 0x2028, 0x2029, 0x000b, 0x000c]) {
      expect(
        storeDescriptionSchema.safeParse(`a${cp(separator)}b`).success,
        String(separator),
      ).toBe(false);
    }
  });

  it("the application uses the same name and description schemas as the store", () => {
    for (const probe of PROBES) {
      const application = submitApplicationBodySchema.safeParse({
        storeName: probe,
        description: probe,
        contactPhone: "0812345678",
      }).success;
      expect(application, JSON.stringify(probe)).toBe(NAME_ALLOWED_TEXT.test(probe));
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Mass assignment and prototype keys
// ---------------------------------------------------------------------------------------------

describe("T-040 review: privileged and prototype keys are refused", () => {
  const privileged = [
    "status",
    "statusReason",
    "slug",
    "ownerId",
    "storeId",
    "userId",
    "role",
    "isSample",
    "logoUploadId",
    "reviewNote",
    "id",
  ];

  it("PATCH /seller/store: every privileged key and every prototype key is 400", () => {
    for (const key of [...privileged, "__proto__", "constructor", "prototype"]) {
      // JSON.parse makes "__proto__" an own property, as readJsonBody does.
      const body = JSON.parse(`{"name":"Shop","${key}":{"status":"SUSPENDED"}}`) as unknown;
      expect(updateStoreBodySchema.safeParse(body).success, key).toBe(false);
    }
  });

  it("POST /seller/application: every privileged key and every prototype key is 400", () => {
    for (const key of [...privileged, "__proto__", "constructor", "prototype"]) {
      const body = JSON.parse(
        `{"storeName":"Shop","description":"d","contactPhone":"0812345678","${key}":"SELLER"}`,
      ) as unknown;
      expect(submitApplicationBodySchema.safeParse(body).success, key).toBe(false);
    }
  });

  it("a parsed body has no inherited or extra property", () => {
    const parsed = updateStoreBodySchema.parse(JSON.parse('{"name":"Shop"}'));
    expect(Object.keys(parsed)).toEqual(["name"]);
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
  });
});

// ---------------------------------------------------------------------------------------------
// Cost of the largest admitted body
// ---------------------------------------------------------------------------------------------

describe("T-040 review: parsing the largest body the reader admits is cheap", () => {
  const size = DEFAULT_JSON_BODY_LIMIT_BYTES;

  it("a 100 KB name, description, or logo key is refused within 250 ms each", () => {
    const shapes: Record<string, unknown>[] = [
      { name: "a".repeat(size) },
      { description: "a".repeat(size) },
      { description: "a\n".repeat(size / 2) },
      { description: `${"a".repeat(1000)}\n`.repeat(size / 1001) },
      { description: `a${cp(0x0301).repeat(3)} `.repeat(size / 5) },
      { name: `a${cp(0x200b).repeat(3)}`.repeat(size / 4) },
      { logoKey: "k".repeat(size) },
    ];
    for (const body of shapes) {
      const started = performance.now();
      const result = updateStoreBodySchema.safeParse(body);
      const elapsed = performance.now() - started;
      expect(result.success, Object.keys(body)[0]).toBe(false);
      expect(elapsed, Object.keys(body)[0]).toBeLessThan(250);
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------------------------

describe("T-040 review: response shapes carry no internal id", () => {
  it("the store shape has exactly its nine keys, whatever extra columns the row holds", () => {
    const row = {
      id: "s1",
      name: "Shop",
      slug: "shop-abcdefgh",
      description: null,
      logoUploadId: "u1",
      logoKey: null,
      contactPhone: "0812345678",
      status: "APPROVED" as const,
      statusReason: null,
      isSample: false,
      ownerId: "owner",
    };
    expect(Object.keys(toStoreDto(row)).sort()).toEqual(
      [
        "contactPhone",
        "description",
        "id",
        "isSample",
        "logo",
        "name",
        "slug",
        "status",
        "statusReason",
      ].sort(),
    );
  });

  it("the application shape has no user id or reviewer id, and a note only when REJECTED", () => {
    const base = {
      id: "a1",
      userId: "u1",
      storeName: "Shop",
      description: "d",
      contactPhone: "0812345678",
      reviewNote: "internal remark",
      reviewedAt: new Date(0),
      createdAt: new Date(0),
      reviewedById: "admin",
    };
    for (const status of ["PENDING", "APPROVED"] as const) {
      const dto = toApplicationDto({ ...base, status });
      expect(dto.reviewNote, status).toBeNull();
      expect(Object.keys(dto)).not.toContain("userId");
      expect(Object.keys(dto)).not.toContain("reviewedById");
    }
    expect(toApplicationDto({ ...base, status: "REJECTED" }).reviewNote).toBe("internal remark");
  });
});
