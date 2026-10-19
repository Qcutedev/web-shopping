/**
 * Security review of T-041, database cases (2026-10-19). Owner: security. Review:
 * docs/reviews/T-041-security.md. Unit-level cases are in t041-uploads.test.ts.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 *
 * The real route modules are called in process with a real `Request`, a real session cookie, the
 * worker's PostgreSQL database, and a temporary storage directory (as tests/integration/uploads).
 *
 *   it(...)        behaviour checked on 2026-10-19 that holds. A failure is a regression.
 *   it.fails(...)  an OPEN finding (SEC-064, SEC-065). The body asserts the secure behaviour, so
 *                  it is reported as an expected failure while the flaw exists. The owner of the
 *                  fix changes `it.fails` to `it` and nothing else; for SEC-065 the owner may
 *                  instead call the cleanup entry point before the request, if that is the fix,
 *                  and the security agent re-checks the change.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GET as getFileRoute } from "@/app/api/files/[key]/route";
import { POST as postUploadRoute } from "@/app/api/v1/seller/uploads/route";
import {
  ascii,
  fileBody,
  jpegBytes,
  multipartContentType,
  pngBytes,
} from "@/modules/uploads/test-fixtures";
import { db } from "@/server/db";

import {
  APP_ORIGIN,
  APP_URL,
  resetProcessRateLimiter,
  stubAuthEnvironment,
} from "../integration/auth/support";
import { json, signedIn } from "../integration/sellers/support";

let base: string;

beforeAll(async () => {
  stubAuthEnvironment();
  base = await mkdtemp(join(tmpdir(), "t041-sec-itest-"));
  process.env["UPLOAD_DIR"] = join(base, "uploads");
});

afterAll(async () => {
  delete process.env["UPLOAD_DIR"];
  await rm(base, { recursive: true, force: true });
});

beforeEach(() => {
  resetProcessRateLimiter();
});

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

async function upload(cookie: string, body: Uint8Array<ArrayBuffer>): Promise<Response> {
  return postUploadRoute(
    new Request(`${APP_URL}/api/v1/seller/uploads`, {
      method: "POST",
      headers: { origin: APP_ORIGIN, "content-type": multipartContentType(), cookie },
      body,
    }),
  );
}

async function uploadedKey(cookie: string, body: Uint8Array<ArrayBuffer>): Promise<string> {
  const response = await upload(cookie, body);
  expect(response.status).toBe(201);
  return (await json<{ data: { key: string } }>(response)).data.key;
}

function getFile(key: string): Promise<Response> {
  return getFileRoute(new Request(`${APP_URL}/api/files/${key}`, { method: "GET" }), {
    params: Promise.resolve({ key }),
  } as RouteContext<"/api/files/[key]">);
}

describe("T-041 review: a polyglot is served only as the image it claims to be", () => {
  it("JPEG and PNG leading bytes followed by HTML and script: recorded image type, nosniff, sandbox CSP, no-store, inline, bytes unchanged", async () => {
    const seller = await signedIn("SELLER");
    const html = ascii("<html><body><script>alert(document.cookie)</script></body></html>");
    for (const [bytes, filename, type] of [
      [concat(jpegBytes(16), html), "a.jpg", "image/jpeg"],
      [concat(pngBytes(16), html), "a.png", "image/png"],
    ] as const) {
      const key = await uploadedKey(seller.cookie, fileBody(bytes, filename, type));
      const response = await getFile(key);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(type);
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("content-disposition")).toBe("inline");
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual(Array.from(bytes));
    }
  });

  it("the type served is the row's, whatever the request asks for", async () => {
    const seller = await signedIn("SELLER");
    const key = await uploadedKey(seller.cookie, fileBody(jpegBytes(64)));
    const response = await getFileRoute(
      new Request(`${APP_URL}/api/files/${key}?type=text/html`, {
        method: "GET",
        headers: { accept: "text/html", "content-type": "text/html" },
      }),
      { params: Promise.resolve({ key }) } as RouteContext<"/api/files/[key]">,
    );
    expect(response.headers.get("content-type")).toBe("image/jpeg");
  });
});

describe("T-041 review: what a suspension does to uploads that exist (by design, D-010 and section 5.8)", () => {
  it("a suspended store's existing pictures stay public; the store can upload nothing new", async () => {
    const seller = await signedIn("SELLER");
    const key = await uploadedKey(seller.cookie, fileBody(jpegBytes(64)));
    await db.store.update({ where: { id: seller.storeId ?? "" }, data: { status: "SUSPENDED" } });
    expect((await getFile(key)).status).toBe(200);
    expect((await upload(seller.cookie, fileBody(jpegBytes(64)))).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------------------------
// SEC-064: metadata is served byte for byte
// ---------------------------------------------------------------------------------------------

/** A JPEG whose APP1 segment is an Exif block naming GPS coordinates (canary values). */
function jpegWithExifGps(): Uint8Array<ArrayBuffer> {
  const payload = ascii(
    "Exif" +
      String.fromCodePoint(0, 0) +
      "MM GPSLatitude 13.7563 N GPSLongitude 100.5018 E Zq7gpsCanary",
  );
  const length = payload.byteLength + 2;
  const app1 = new Uint8Array([0xff, 0xe1, (length >> 8) & 0xff, length & 0xff]);
  return concat(new Uint8Array([0xff, 0xd8]), app1, payload, new Uint8Array([0xff, 0xd9]));
}

describe("SEC-064 uploaded images keep their metadata (Exif GPS) and any trailing data", () => {
  it("(documented) the bytes served are the bytes sent, Exif GPS block included", async () => {
    const seller = await signedIn("SELLER");
    const bytes = jpegWithExifGps();
    const key = await uploadedKey(seller.cookie, fileBody(bytes));
    const served = new TextDecoder("latin1").decode(await (await getFile(key)).arrayBuffer());
    expect(served).toContain("Zq7gpsCanary");
    expect(served).toContain("GPSLatitude");
  });

  it.fails(
    "an uploaded picture is served without the location its camera wrote into it",
    async () => {
      const seller = await signedIn("SELLER");
      const key = await uploadedKey(seller.cookie, fileBody(jpegWithExifGps()));
      const served = new TextDecoder("latin1").decode(await (await getFile(key)).arrayBuffer());
      expect(served).not.toContain("GPSLatitude");
      expect(served).not.toContain("Zq7gpsCanary");
    },
  );
});

// ---------------------------------------------------------------------------------------------
// SEC-065: unattached uploads are kept and served without end
// ---------------------------------------------------------------------------------------------

describe("SEC-065 an upload that nothing references stays on disk and public for ever", () => {
  async function orphanOlderThanGrace(): Promise<string> {
    const seller = await signedIn("SELLER");
    const key = await uploadedKey(seller.cookie, fileBody(jpegBytes(64)));
    // 25 hours: past the 24-hour grace period of API_CONTRACTS.md section 5.8 "Lifetime".
    await db.upload.update({
      where: { storageKey: key },
      data: { createdAt: new Date(Date.now() - 25 * 3_600_000) },
    });
    return key;
  }

  // Changed by backend-api with the SEC-065 fix (2026-10-19), for the security re-check: this case
  // documented the flaw and asserted status 200. The row assertions are unchanged; the status is
  // now the fixed behaviour (404), because the row stays until the cleanup job runs.
  it("(documented) an unattached upload 25 hours old keeps its row until the cleanup runs, and is not served", async () => {
    const key = await orphanOlderThanGrace();
    const row = await db.upload.findUniqueOrThrow({
      where: { storageKey: key },
      include: { productImage: true, logoOfStore: true, orderItems: true },
    });
    expect(row.productImage).toBeNull();
    expect(row.logoOfStore).toBeNull();
    expect(row.orderItems).toEqual([]);
    expect((await getFile(key)).status).toBe(404);
  });

  it("an unattached upload past the grace period is no longer served", async () => {
    const key = await orphanOlderThanGrace();
    expect((await getFile(key)).status).toBe(404);
  });
});
