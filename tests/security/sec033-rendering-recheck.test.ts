/**
 * Security re-check of the SEC-033 rendering layer in the storefront (2026-10-14).
 * Report: docs/reviews/SEC-033-rendering-recheck.md. Register: docs/SECURITY.md.
 *
 * Rule under test: every place the storefront shows a user-controlled name (user, store,
 * product, review author, search query) isolates it with `UserName` (`<bdi>`), and nothing
 * user-controlled is interpolated into a larger sentence inside that `<bdi>`.
 *
 * Every invisible character is built with String.fromCodePoint, so this file holds none itself
 * (SEC-040). Open findings are `it.fails`: the body states the secure behaviour.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProductCard } from "@/components/catalog/product-card";
import { ProductDetailView } from "@/components/catalog/product-detail-view";
import { ReviewsView } from "@/components/catalog/reviews-view";
import { fill } from "@/i18n/fill";
import { th } from "@/i18n/th";
import type { ProductDetailDto, ProductListItemDto, ReviewDto } from "@/modules/catalog/schema";

const ROOT = join(__dirname, "..", "..");
const RLO = String.fromCodePoint(0x202e);
const LRI = String.fromCodePoint(0x2066);
const FSI = String.fromCodePoint(0x2068);
const PDI = String.fromCodePoint(0x2069);

const posix = (path: string) => relative(ROOT, path).split(sep).join("/");

function filesUnder(dir: string, keep: (path: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path, keep));
    else if (keep(path)) out.push(path);
  }
  return out;
}

/** The text as React writes it into HTML (escaped). */
function escaped(text: string): string {
  const html = renderToStaticMarkup(createElement("span", null, text));
  return html.slice("<span>".length, -"</span>".length);
}

/**
 * Where `text` appears as page text (not inside a tag or attribute): each occurrence is either
 * isolated (a text node that is exactly `text`, directly between `<bdi>` and `</bdi>`) or bare.
 */
function textOccurrences(html: string, text: string): { isolated: number; bare: number } {
  const needle = escaped(text);
  const tokens = html.split(/(<[^>]*>)/);
  let isolated = 0;
  let bare = 0;
  tokens.forEach((token, index) => {
    if (token.startsWith("<") || !token.includes(needle)) return;
    if (token === needle && tokens[index - 1] === "<bdi>" && tokens[index + 1] === "</bdi>") {
      isolated += 1;
    } else {
      bare += 1;
    }
  });
  return { isolated, bare };
}

/** Text content of every `<bdi>` in the markup. */
function bdiContents(html: string): string[] {
  return [...html.matchAll(/<bdi>([\s\S]*?)<\/bdi>/g)].map((match) => match[1] ?? "");
}

// Distinct, hostile values: a bidi override that is never closed, and markup.
const STORE_NAME = `Shop${RLO}evil<b>x</b>`;
const PRODUCT_TITLE = `Title${RLO}Admin<i>y</i>`;
const CATEGORY_NAME = "Tea";

const listItem: ProductListItemDto = {
  id: "p1",
  slug: "p-1",
  title: PRODUCT_TITLE,
  priceSatang: 12_500,
  image: { key: "k1", url: "/api/files/k1" },
  soldOut: false,
  isSample: false,
  store: { name: STORE_NAME, slug: "s-1", isSample: false },
};

const detail: ProductDetailDto = {
  id: "p1",
  slug: "p-1",
  title: PRODUCT_TITLE,
  description: "plain",
  priceSatang: 12_500,
  stock: 3,
  soldOut: false,
  images: [{ key: "k1", url: "/api/files/k1" }],
  category: { name: CATEGORY_NAME, slug: "tea" },
  store: { name: STORE_NAME, slug: "s-1", isSample: false },
  reviewSummary: null,
  isSample: false,
};

const cardHtml = () => renderToStaticMarkup(createElement(ProductCard, { product: listItem }));
const detailHtml = () =>
  renderToStaticMarkup(createElement(ProductDetailView, { product: detail }));

// ---------------------------------------------------------------------------------------------
// Store names (SEC-033 rendering part)
// ---------------------------------------------------------------------------------------------

describe("SEC-033 rendering: store names are isolated", () => {
  it("product card: the store name is one text node inside its own bdi, escaped", () => {
    expect(textOccurrences(cardHtml(), STORE_NAME)).toEqual({ isolated: 1, bare: 0 });
  });

  it("product detail: the store link holds the store name in its own bdi, escaped", () => {
    const html = detailHtml();
    expect(textOccurrences(html, STORE_NAME)).toEqual({ isolated: 1, bare: 0 });
    expect(html).toMatch(/<a [^>]*href="\/stores\/s-1"[^>]*><bdi>/);
  });

  it("store page: every store.name in JSX text sits alone inside UserName", () => {
    const source = readFileSync(
      join(ROOT, "src", "components", "catalog", "store-section.tsx"),
      "utf8",
    );
    const all = source.match(/\{\s*store\.name\s*\}/g) ?? [];
    const wrapped = source.match(/<UserName>\{\s*store\.name\s*\}<\/UserName>/g) ?? [];
    expect(wrapped.length).toBeGreaterThan(0);
    expect(all.length).toBe(wrapped.length);
  });
});

// ---------------------------------------------------------------------------------------------
// Search query (SEC-033 rendering part, code-review CR-T021-07)
// ---------------------------------------------------------------------------------------------

type AnyElement = ReactElement<Record<string, unknown>>;

function findElement(node: ReactNode, match: (element: AnyElement) => boolean): AnyElement | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child as ReactNode, match);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const element = node as AnyElement;
  if (match(element)) return element;
  return findElement(element.props.children as ReactNode, match);
}

/**
 * Runs the search page's async content component and returns the markup of its h1. The content
 * is a fragment whose first child renders the heading (an `h1` or a component that renders
 * one); only that child is rendered, so the async product list is not run.
 */
async function searchHeadingHtml(q: string): Promise<string> {
  const { default: SearchPage } = await import("@/app/(storefront)/search/page");
  const searchParams = Promise.resolve({ q });
  const page = SearchPage({ searchParams }) as ReactNode;
  const content = findElement(
    page,
    (element) => typeof element.type === "function" && element.props.searchParams === searchParams,
  );
  expect(content).not.toBeNull();
  const render = (content as AnyElement).type as (props: unknown) => Promise<ReactNode>;
  const tree = (await render((content as AnyElement).props)) as AnyElement;
  const children = ([] as ReactNode[]).concat(tree.props.children as ReactNode);
  const first = children.find((child) => isValidElement(child));
  expect(first).toBeDefined();
  const html = renderToStaticMarkup(first as AnyElement);
  const heading = /<h1[^>]*>[\s\S]*?<\/h1>/.exec(html)?.[0];
  expect(heading).toBeDefined();
  return heading as string;
}

describe("SEC-033 rendering: the search query (CR-T021-07)", () => {
  const Q = `q${RLO}x<script>1</script>`;

  it("the heading isolates the query alone: the Thai sentence is outside the bdi", async () => {
    const html = await searchHeadingHtml(Q);
    expect(bdiContents(html)).toEqual([escaped(Q)]);
    expect(textOccurrences(html, Q)).toEqual({ isolated: 1, bare: 0 });
    expect(html).not.toContain("<script>");
  });

  it("no search value reaches the heading without its isolation", async () => {
    const html = await searchHeadingHtml(`${LRI}a`);
    expect(bdiContents(html)).toEqual([escaped(`${LRI}a`)]);
  });
});

// ---------------------------------------------------------------------------------------------
// No sentence inside a bdi (static scan of every storefront file)
// ---------------------------------------------------------------------------------------------

describe("SEC-033 rendering: nothing is interpolated into a sentence inside UserName", () => {
  const files = [
    ...filesUnder(join(ROOT, "src", "app", "(storefront)"), (path) => path.endsWith(".tsx")),
    ...filesUnder(join(ROOT, "src", "components"), (path) => path.endsWith(".tsx")),
  ].filter((path) => !path.endsWith(".test.tsx") && !posix(path).startsWith("src/components/ui/"));

  it("covers the storefront pages and the catalog and account components", () => {
    expect(files.map(posix)).toEqual(
      expect.arrayContaining([
        "src/app/(storefront)/search/page.tsx",
        "src/components/catalog/product-card.tsx",
        "src/components/catalog/product-detail-view.tsx",
        "src/components/catalog/store-section.tsx",
        "src/components/account/profile-card.tsx",
        "src/components/account/address-book.tsx",
      ]),
    );
  });

  for (const path of files) {
    it(`${posix(path)}: every UserName holds exactly one plain value`, () => {
      const source = readFileSync(path, "utf8");
      const bodies = [...source.matchAll(/<UserName>([\s\S]*?)<\/UserName>/g)].map(
        (match) => match[1] ?? "",
      );
      for (const body of bodies) {
        // One member expression such as {store.name}; no fill(), template, or literal text.
        expect(body.trim()).toMatch(/^\{\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*\}$/);
      }
    });
  }
});

// ---------------------------------------------------------------------------------------------
// Account pages: the user's own name and address fields
// ---------------------------------------------------------------------------------------------

describe("SEC-033 rendering: account pages isolate the name and address text", () => {
  it("profile card shows the display name through UserName", () => {
    const source = readFileSync(
      join(ROOT, "src", "components", "account", "profile-card.tsx"),
      "utf8",
    );
    expect(source).toContain("<UserName>{current.name}</UserName>");
    expect(source.match(/\{\s*current\.name\s*\}/g)?.length).toBe(1);
  });

  it("address book shows the recipient and every address line through UserName", () => {
    const source = readFileSync(
      join(ROOT, "src", "components", "account", "address-book.tsx"),
      "utf8",
    );
    for (const field of ["recipientName", "line1", "subdistrict", "district", "province"]) {
      const all = source.match(new RegExp(String.raw`\{\s*address\.${field}\s*\}`, "g")) ?? [];
      const wrapped =
        source.match(
          new RegExp(String.raw`<UserName>\{\s*address\.${field}\s*\}</UserName>`, "g"),
        ) ?? [];
      expect(wrapped.length, field).toBe(1);
      expect(all.length, field).toBe(wrapped.length);
    }
  });

  it("the email, shown without UserName, cannot hold a bidi or invisible control", async () => {
    const { signUpBodySchema } = await import("@/modules/auth/schema");
    const body = (email: string) => ({ name: "Somchai", email, password: "long enough 1" });
    expect(signUpBodySchema.safeParse(body("a@example.com")).success).toBe(true);
    for (const code of [0x202e, 0x2066, 0x2069, 0x200f, 0x061c, 0x200b, 0xfeff]) {
      const char = String.fromCodePoint(code);
      expect(
        signUpBodySchema.safeParse(body(`a${char}b@example.com`)).success,
        code.toString(16),
      ).toBe(false);
      expect(
        signUpBodySchema.safeParse(body(`ab@exa${char}mple.com`)).success,
        code.toString(16),
      ).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Review author: not shown at all
// ---------------------------------------------------------------------------------------------

describe("SEC-033 rendering: reviews show no author name", () => {
  it("the catalog's review read selects no user or name column", () => {
    const source = readFileSync(join(ROOT, "src", "modules", "catalog", "repository.ts"), "utf8");
    const select = /const REVIEW_SELECT = \{([\s\S]*?)\}/.exec(source)?.[1] ?? "";
    expect(select.replace(/\s+/g, " ").trim()).toBe(
      "id: true, rating: true, comment: true, createdAt: true,",
    );
  });

  it("a rendered review holds rating, comment, and date only", () => {
    const review: ReviewDto = {
      id: "r1",
      rating: 4,
      comment: `ok${RLO}`,
      createdAt: "2026-10-14T00:00:00.000Z",
    };
    const html = renderToStaticMarkup(createElement(ReviewsView, { reviews: [review] }));
    expect(html).toContain(escaped(`ok${RLO}`));
    // The comment is a paragraph of its own (a bidi paragraph boundary), not part of a sentence.
    expect(html).toMatch(new RegExp(`<p [^>]*>${escaped(`ok${RLO}`)}</p>`));
  });
});

// ---------------------------------------------------------------------------------------------
// SEC-057: product titles. These three were flipped to `it` by frontend in 004c213 (only
// `it.fails(` to `it(`); re-checked 2026-10-14: each fails on its assertion against 004c213^.
// ---------------------------------------------------------------------------------------------

describe("SEC-057: product titles are shown without isolation", () => {
  it("product card: the title is one text node inside its own bdi", () => {
    expect(textOccurrences(cardHtml(), PRODUCT_TITLE)).toEqual({ isolated: 1, bare: 0 });
  });

  it("product detail: the h1 and the breadcrumb isolate the title", () => {
    expect(textOccurrences(detailHtml(), PRODUCT_TITLE)).toEqual({ isolated: 2, bare: 0 });
  });

  it("product detail: an image alt text wraps the title in FSI ... PDI", () => {
    const alt = /<img [^>]*alt="([^"]*)"/.exec(detailHtml())?.[1] ?? "";
    expect(alt.startsWith(`${FSI}${escaped(PRODUCT_TITLE)}${PDI}`)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// SEC-057 re-check (2026-10-14, commit 004c213): every gallery image, the attribute wrap with a
// hostile title, and a static scan for new places that show a product title.
// ---------------------------------------------------------------------------------------------

const PDF = String.fromCodePoint(0x202c);
const ISOLATE_OPENERS = new Set([0x2066, 0x2067, 0x2068]);

/**
 * Index of the PDI that closes the isolate opened at `start` (UAX #9 BD9: isolate initiators and
 * PDIs nest; embeddings and overrides inside are closed by that PDI). -1 when it never closes.
 */
function isolateEnd(text: string, start: number): number {
  const chars = [...text];
  let depth = 0;
  let offset = 0;
  for (let index = 0; index < chars.length; index += 1) {
    const code = chars[index]?.codePointAt(0) ?? 0;
    if (offset >= start) {
      if (ISOLATE_OPENERS.has(code)) depth += 1;
      else if (code === 0x2069) {
        depth -= 1;
        if (depth === 0) return offset;
      }
    }
    offset += chars[index]?.length ?? 1;
  }
  return -1;
}

const detailWith = (title: string, imageCount: number) =>
  renderToStaticMarkup(
    createElement(ProductDetailView, {
      product: {
        ...detail,
        title,
        images: Array.from({ length: imageCount }, (_, index) => ({
          key: `k${index}`,
          url: `/api/files/k${index}`,
        })),
      },
    }),
  );

const altsOf = (html: string) =>
  [...html.matchAll(/<img [^>]*alt="([^"]*)"/g)].map((match) => match[1] ?? "");

/** The shop's own words after the title in image `index` of `count`, with no title. */
const altSuffix = (index: number, count: number) =>
  fill(th.catalog.product.imageAlt, { title: "", index, count });

describe("SEC-057 re-check: product titles in attributes and new places", () => {
  it("every gallery image alt wraps the title, and the isolate closes before the shop's words", () => {
    const alts = altsOf(detailWith("Plain title", 3));
    expect(alts).toHaveLength(3);
    alts.forEach((alt, index) => {
      expect(alt.startsWith(`${FSI}Plain title${PDI}`)).toBe(true);
      expect(alt.slice(isolateEnd(alt, 0) + 1)).toBe(altSuffix(index + 1, 3));
    });
  });

  // OPEN (SEC-057 attribute part): FSI ... PDI is text-level. A PDI inside the title closes the
  // isolate early, and the override after it runs over the shop's words. `<bdi>` is not affected,
  // because CSS isolation does not depend on characters inside the text.
  it.fails("a title holding PDI then RLO cannot close the alt isolate early", () => {
    const [alt] = altsOf(detailWith(`Title${PDI}${RLO}Admin`, 1));
    const end = isolateEnd(alt ?? "", 0);
    expect((alt ?? "").slice(end + 1)).toBe(altSuffix(1, 1));
  });

  it.fails("a title holding an unmatched isolate opener cannot swallow the shop's words", () => {
    const [alt] = altsOf(detailWith(`Title${LRI}Admin`, 1));
    const end = isolateEnd(alt ?? "", 0);
    expect(end).toBeGreaterThan(0);
    expect((alt ?? "").slice(end + 1)).toBe(altSuffix(1, 1));
  });

  it("a title holding RLO and PDF only stays inside the alt isolate (control case)", () => {
    const [alt] = altsOf(detailWith(`Title${RLO}Admin${PDF}`, 1));
    expect((alt ?? "").slice(isolateEnd(alt ?? "", 0) + 1)).toBe(altSuffix(1, 1));
  });

  it("every product title in storefront source is in UserName or an FSI ... PDI wrap", () => {
    const files = [
      ...filesUnder(join(ROOT, "src", "app"), (path) => /\.tsx?$/.test(path)),
      ...filesUnder(join(ROOT, "src", "components"), (path) => /\.tsx?$/.test(path)),
    ].filter((path) => !/\.test\.tsx?$/.test(path));
    const bare: string[] = [];
    for (const path of files) {
      const source = readFileSync(path, "utf8");
      const all = source.match(/\b(?:product|item|line)\.(?:title|productTitle)\b/g) ?? [];
      const wrapped =
        source.match(
          /<UserName>\{\s*(?:product|item|line)\.(?:title|productTitle)\s*\}<\/UserName>|\$\{FSI\}\$\{(?:product|item|line)\.(?:title|productTitle)\}\$\{PDI\}/g,
        ) ?? [];
      if (all.length !== wrapped.length)
        bare.push(`${posix(path)}: ${all.length - wrapped.length}`);
    }
    expect(bare).toEqual([]);
  });
});
