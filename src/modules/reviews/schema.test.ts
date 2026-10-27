/**
 * Unit tests of the reviews contract schemas (docs/API_CONTRACTS.md section 5.6; REQ-C-14):
 * the rating range, the comment rule (D-047 limit, blank is null, plain text kept as sent
 * apart from the line normalisation), strict bodies, and the path parameters.
 */
import { describe, expect, it } from "vitest";

import {
  createReviewBodySchema,
  MAX_ID_LENGTH,
  REVIEW_COMMENT_MAX,
  reviewTargetParamsSchema,
} from "./schema";

const NUL = String.fromCodePoint(0);
/** U+2060 WORD JOINER: invisible and not one of the kept U+200B to U+200D. */
const WORD_JOINER = String.fromCodePoint(0x2060);
const BIDI_OVERRIDE = String.fromCodePoint(0x202e);
const LONE_SURROGATE = String.fromCharCode(0xd800);

function parse(body: unknown) {
  return createReviewBodySchema.safeParse(body);
}

describe("createReviewBodySchema: rating", () => {
  it("accepts every whole number from 1 to 5", () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      expect(parse({ rating })).toEqual({ success: true, data: { rating } });
    }
  });

  it("refuses ratings outside 1 to 5, fractions, strings, and a missing rating", () => {
    for (const rating of [0, 6, -1, 4.5, 1.0000001, "5", null, true, Number.NaN, Infinity]) {
      expect(parse({ rating }).success).toBe(false);
    }
    expect(parse({}).success).toBe(false);
    expect(parse({ comment: "ดีมาก" }).success).toBe(false);
  });
});

describe("createReviewBodySchema: comment", () => {
  it("keeps Thai text and markup-like text exactly as plain text", () => {
    const comment = "สินค้าดีมาก <script>alert(1)</script> & \"quotes\" 'single'";
    expect(parse({ rating: 5, comment })).toEqual({ success: true, data: { rating: 5, comment } });
  });

  it("normalises line breaks and surrounding white space like the store description", () => {
    expect(parse({ rating: 4, comment: "  ดี  \r\nมาก\rค่ะ  \n" })).toEqual({
      success: true,
      data: { rating: 4, comment: "ดี\nมาก\nค่ะ" },
    });
  });

  it("stores no comment for absent, null, empty, and blank", () => {
    expect(parse({ rating: 3 })).toEqual({ success: true, data: { rating: 3 } });
    for (const comment of [null, "", "   ", "\n\r\n  \t "]) {
      expect(parse({ rating: 3, comment })).toEqual({
        success: true,
        data: { rating: 3, comment: null },
      });
    }
  });

  it(`accepts ${REVIEW_COMMENT_MAX} characters and refuses one more`, () => {
    expect(parse({ rating: 5, comment: "ก".repeat(REVIEW_COMMENT_MAX) }).success).toBe(true);
    expect(parse({ rating: 5, comment: "ก".repeat(REVIEW_COMMENT_MAX + 1) }).success).toBe(false);
  });

  it("refuses control, invisible, and bidirectional characters on any line", () => {
    for (const bad of [NUL, WORD_JOINER, BIDI_OVERRIDE, "\t", String.fromCodePoint(7)]) {
      expect(parse({ rating: 5, comment: `ดี\nมาก${bad}ค่ะ` }).success).toBe(false);
    }
  });

  it("refuses a comment that is not a string", () => {
    for (const comment of [5, ["a"], { text: "a" }, true]) {
      expect(parse({ rating: 5, comment }).success).toBe(false);
    }
  });
});

describe("createReviewBodySchema: strict body", () => {
  it("refuses every unknown key, including ids the server takes from elsewhere", () => {
    for (const key of ["productId", "userId", "orderItemId", "storeId", "createdAt", "id", "x"]) {
      const result = parse({ rating: 5, [key]: "attacker" });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.code).toBe("unrecognized_keys");
    }
  });

  it("refuses a body that is not an object", () => {
    for (const body of [null, [], "rating=5", 5]) expect(parse(body).success).toBe(false);
  });
});

describe("reviewTargetParamsSchema", () => {
  it("accepts opaque ids of 1 to the maximum length", () => {
    const long = "a".repeat(MAX_ID_LENGTH);
    expect(reviewTargetParamsSchema.parse({ id: "o1", itemId: long })).toEqual({
      id: "o1",
      itemId: long,
    });
  });

  it("refuses empty, too long, U+0000, and lone-surrogate ids on either parameter", () => {
    for (const bad of ["", "a".repeat(MAX_ID_LENGTH + 1), `a${NUL}`, `a${LONE_SURROGATE}`]) {
      expect(reviewTargetParamsSchema.safeParse({ id: bad, itemId: "i" }).success).toBe(false);
      expect(reviewTargetParamsSchema.safeParse({ id: "o", itemId: bad }).success).toBe(false);
    }
  });
});
