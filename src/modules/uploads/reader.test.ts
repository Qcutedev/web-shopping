import { describe, expect, it } from "vitest";

import type { AppError } from "@/server/errors";

import { checkImage, extensionOf, readUploadRequest } from "./reader";
import { MAX_UPLOAD_BODY_BYTES, MAX_UPLOAD_FILE_BYTES } from "./schema";
import {
  ascii,
  fileBody,
  jpegBytes,
  multipartContentType,
  pngBytes,
  webpBytes,
} from "./test-fixtures";

async function refusal(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    return error as AppError;
  }
  throw new Error("expected a refusal");
}

function uploadRequest(body: BodyInit, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost:3000/api/v1/seller/uploads", {
    method: "POST",
    headers: { "content-type": multipartContentType(), ...headers },
    body,
    duplex: "half",
  } as RequestInit);
}

describe("extensionOf", () => {
  it("is the lower-cased text after the last dot, or empty", () => {
    expect(extensionOf("a.b.JPG")).toBe("jpg");
    expect(extensionOf("noext")).toBe("");
    expect(extensionOf(".png")).toBe("png");
  });
});

describe("checkImage", () => {
  it("accepts each allowed type with a matching declared type and extension", () => {
    expect(
      checkImage({ filename: "a.jpeg", declaredType: "image/jpeg", bytes: jpegBytes() }),
    ).toMatchObject({ contentType: "image/jpeg" });
    expect(
      checkImage({ filename: "a.JPG", declaredType: "image/jpeg", bytes: jpegBytes() }),
    ).toMatchObject({ contentType: "image/jpeg" });
    expect(
      checkImage({ filename: "a.png", declaredType: "image/png", bytes: pngBytes() }),
    ).toMatchObject({ contentType: "image/png" });
    expect(
      checkImage({ filename: "a.webp", declaredType: "image/webp", bytes: webpBytes() }),
    ).toMatchObject({ contentType: "image/webp" });
  });

  it("accepts a file of exactly 5 MB and refuses one byte more with 413", () => {
    const exact = jpegBytes(MAX_UPLOAD_FILE_BYTES);
    expect(
      checkImage({ filename: "a.jpg", declaredType: "image/jpeg", bytes: exact }).bytes,
    ).toHaveLength(MAX_UPLOAD_FILE_BYTES);
    let error: AppError | undefined;
    try {
      checkImage({
        filename: "a.jpg",
        declaredType: "image/jpeg",
        bytes: jpegBytes(MAX_UPLOAD_FILE_BYTES + 1),
      });
    } catch (caught) {
      error = caught as AppError;
    }
    expect(error?.status).toBe(413);
    expect(error?.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it.each([
    ["a GIF", { filename: "a.gif", declaredType: "image/gif", bytes: ascii("GIF89a....") }],
    ["an SVG", { filename: "a.svg", declaredType: "image/svg+xml", bytes: ascii("<svg/>") }],
    [
      "HTML named .jpg with an image type",
      {
        filename: "a.jpg",
        declaredType: "image/jpeg",
        bytes: ascii("<html><script>alert(1)</script>"),
      },
    ],
    [
      "PNG bytes declared as JPEG",
      { filename: "a.jpg", declaredType: "image/jpeg", bytes: pngBytes() },
    ],
    [
      "JPEG bytes named .png",
      { filename: "a.png", declaredType: "image/jpeg", bytes: jpegBytes() },
    ],
    ["no extension", { filename: "photo", declaredType: "image/jpeg", bytes: jpegBytes() }],
    ["no declared type", { filename: "a.jpg", declaredType: "", bytes: jpegBytes() }],
    [
      "octet-stream",
      {
        filename: "a.jpg",
        declaredType: "application/octet-stream",
        bytes: jpegBytes(),
      },
    ],
    ["an empty file", { filename: "a.jpg", declaredType: "image/jpeg", bytes: new Uint8Array(0) }],
  ])("refuses %s with 415", (_name, file) => {
    let error: AppError | undefined;
    try {
      checkImage(file);
    } catch (caught) {
      error = caught as AppError;
    }
    expect(error?.status).toBe(415);
    expect(error?.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });
});

describe("readUploadRequest", () => {
  it("reads a valid upload", async () => {
    const image = await readUploadRequest(
      uploadRequest(fileBody(pngBytes(), "a.png", "image/png")),
    );
    expect(image.contentType).toBe("image/png");
    expect(image.bytes).toHaveLength(64);
  });

  it("refuses a Content-Length over the body limit before reading (413)", async () => {
    const error = await refusal(
      readUploadRequest(
        uploadRequest(fileBody(jpegBytes()), {
          "content-length": String(MAX_UPLOAD_BODY_BYTES + 1),
        }),
      ),
    );
    expect(error.status).toBe(413);
  });

  it("refuses a streamed body over the limit without a length (413)", async () => {
    const big = fileBody(jpegBytes(MAX_UPLOAD_BODY_BYTES + 10));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let offset = 0; offset < big.byteLength; offset += 65_536) {
          controller.enqueue(big.slice(offset, offset + 65_536));
        }
        controller.close();
      },
    });
    const error = await refusal(readUploadRequest(uploadRequest(stream)));
    expect(error.status).toBe(413);
  });

  it("answers 413 for a file just over 5 MB that fits the body limit", async () => {
    const error = await refusal(
      readUploadRequest(uploadRequest(fileBody(jpegBytes(MAX_UPLOAD_FILE_BYTES + 1)))),
    );
    expect(error.status).toBe(413);
  });

  it("answers 413 before 400: an oversized body without a boundary", async () => {
    const error = await refusal(
      readUploadRequest(
        uploadRequest(new Uint8Array(MAX_UPLOAD_BODY_BYTES + 1), {
          "content-type": "multipart/form-data",
        }),
      ),
    );
    expect(error.status).toBe(413);
  });

  it("answers 400 for a missing boundary and 415 for a wrong type", async () => {
    expect(
      (
        await refusal(
          readUploadRequest(
            uploadRequest(fileBody(jpegBytes()), { "content-type": "multipart/form-data" }),
          ),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await refusal(
          readUploadRequest(uploadRequest(fileBody(ascii("<svg/>"), "a.svg", "image/svg+xml"))),
        )
      ).status,
    ).toBe(415);
  });

  it("answers a body that stops arriving as a client error, never a 500", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(fileBody(jpegBytes()).slice(0, 50));
        controller.error(Object.assign(new Error("aborted"), { name: "AbortError" }));
      },
    });
    const error = await refusal(readUploadRequest(uploadRequest(stream)));
    expect(error.status).toBeGreaterThanOrEqual(400);
    expect(error.status).toBeLessThan(500);
  });
});
