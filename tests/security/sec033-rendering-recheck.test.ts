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
import * as ts from "typescript";
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

/** Non-test source under src/app and src/components: every place that can render a title. */
function rendererFiles(): string[] {
  return [
    ...filesUnder(join(ROOT, "src", "app"), (path) => /\.tsx?$/.test(path)),
    ...filesUnder(join(ROOT, "src", "components"), (path) => /\.tsx?$/.test(path)),
  ].filter((path) => !/\.test\.tsx?$/.test(path));
}

const TITLE_FIELDS = new Set(["title", "productTitle"]);

/** The identifier at the start of `a.b["c"]!.d`, or null when it starts with a call or literal. */
function rootIdentifier(node: ts.Expression): ts.Identifier | null {
  let current: ts.Expression = node;
  while (
    ts.isPropertyAccessExpression(current) ||
    ts.isElementAccessExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return ts.isIdentifier(current) ? current : null;
}

/** True when the file binds the local name `th` to `th` from "@/i18n/th" (static Thai copy). */
function importsThaiCopy(file: ts.SourceFile): boolean {
  return file.statements.some((statement) => {
    if (!ts.isImportDeclaration(statement)) return false;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) return false;
    if (statement.moduleSpecifier.text !== "@/i18n/th") return false;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) return false;
    return bindings.elements.some(
      (element) =>
        element.name.text === "th" && (element.propertyName ?? element.name).text === "th",
    );
  });
}

/** `<UserName>{node}</UserName>` with nothing else inside but white space. */
function isSoleUserNameChild(node: ts.Node): boolean {
  const container = node.parent;
  if (!ts.isJsxExpression(container) || container.expression !== node) return false;
  const element = container.parent;
  if (!ts.isJsxElement(element)) return false;
  const tag = element.openingElement.tagName;
  if (!ts.isIdentifier(tag) || tag.text !== "UserName") return false;
  const children = element.children.filter(
    (child) => !(ts.isJsxText(child) && child.containsOnlyTriviaWhiteSpaces),
  );
  return children.length === 1 && children[0] === container;
}

/** `${FSI}${stripIsolateControls(node)}${PDI}`, adjacent, in one template literal. */
function isStrippedIsolateWrap(node: ts.Node): boolean {
  const call = node.parent;
  if (!ts.isCallExpression(call) || call.arguments.length !== 1 || call.arguments[0] !== node) {
    return false;
  }
  if (!ts.isIdentifier(call.expression) || call.expression.text !== "stripIsolateControls") {
    return false;
  }
  const span = call.parent;
  if (!ts.isTemplateSpan(span) || span.expression !== call) return false;
  const spans = span.parent.templateSpans;
  const index = spans.indexOf(span);
  const before = spans[index - 1];
  const after = spans[index + 1];
  return (
    before !== undefined &&
    after !== undefined &&
    ts.isIdentifier(before.expression) &&
    before.expression.text === "FSI" &&
    before.literal.text === "" &&
    span.literal.text === "" &&
    ts.isIdentifier(after.expression) &&
    after.expression.text === "PDI"
  );
}

/** An identifier that reads a variable (not a declaration, property name, or type name). */
function isValueReference(id: ts.Identifier): boolean {
  const parent = id.parent;
  if (ts.isShorthandPropertyAssignment(parent)) return true;
  if (ts.isQualifiedName(parent) || ts.isTypeReferenceNode(parent)) return false;
  if ("name" in parent && parent.name === id) return false;
  if ("propertyName" in parent && parent.propertyName === id) return false;
  return true;
}

/**
 * Every read of a `title` or `productTitle` field in one source file that is not isolated, as
 * source text, in file order. Found by syntax tree, not by variable name (CR-107):
 * - any `x.title`, `x?.title`, `x["title"]`, whatever `x` is called; reads rooted at `th`
 *   imported from "@/i18n/th" are static Thai copy and are skipped;
 * - every reference to a local bound by destructuring `{ title }` or `{ title: name }`.
 * Isolated means the sole child of `<UserName>`, or `${FSI}${stripIsolateControls(read)}${PDI}`
 * in a file that defines FSI and PDI as U+2068 and U+2069. Any other read is reported, including
 * a copy into a local (`const t = x.title`), so an alias cannot carry a title past the scan.
 */
function unsafeTitleReads(fileName: string, source: string): string[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const thaiCopy = importsThaiCopy(file);
  const isolateConstants =
    /\bconst FSI = String\.fromCodePoint\(0x2068\);/.test(source) &&
    /\bconst PDI = String\.fromCodePoint\(0x2069\);/.test(source);
  const reads: ts.Node[] = [];
  const boundNames = new Set<string>();
  const declarations = new Set<ts.Node>();

  const collect = (node: ts.Node): void => {
    const field = ts.isPropertyAccessExpression(node)
      ? node.name.text
      : ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)
        ? node.argumentExpression.text
        : null;
    if (field !== null && TITLE_FIELDS.has(field)) {
      const root = rootIdentifier((node as ts.PropertyAccessExpression).expression);
      if (!(thaiCopy && root?.text === "th")) reads.push(node);
    }
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const key = node.propertyName ?? node.name;
      if (
        (ts.isIdentifier(key) || ts.isStringLiteral(key)) &&
        TITLE_FIELDS.has(key.text) &&
        ts.isIdentifier(node.name)
      ) {
        boundNames.add(node.name.text);
        declarations.add(node.name);
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(file);

  if (boundNames.size > 0) {
    const references = (node: ts.Node): void => {
      if (
        ts.isIdentifier(node) &&
        boundNames.has(node.text) &&
        !declarations.has(node) &&
        isValueReference(node)
      ) {
        reads.push(node);
      }
      ts.forEachChild(node, references);
    };
    references(file);
  }

  return reads
    .sort((a, b) => a.getStart(file) - b.getStart(file))
    .filter((node) => !isSoleUserNameChild(node))
    .filter((node) => !(isolateConstants && isStrippedIsolateWrap(node)))
    .map((node) => node.getText(file));
}

/**
 * Files allowed to read a title outside `UserName` or the attribute wrap, with every such read
 * pinned as source text, in file order. A new read, a removed read, or a renamed variable in one
 * of these files fails the scan until security re-checks it and updates the pin (CR-107).
 */
const STATIC_TITLE_PROP =
  "Destructured `title` prop of a layout or design-system part, rendered as a heading. Every " +
  "caller passes Thai copy from th.ts (checked 2026-10-21); a caller that passes a product " +
  "title must read a title field itself, and that read is scanned in the caller's file.";

const TITLE_READ_EXCLUSIONS: Record<string, { reads: string[]; reason: string }> = {
  "src/components/account/account-frame.tsx": { reads: ["title"], reason: STATIC_TITLE_PROP },
  "src/components/seller/application-form.tsx": { reads: ["title"], reason: STATIC_TITLE_PROP },
  "src/components/seller/seller-frame.tsx": { reads: ["title"], reason: STATIC_TITLE_PROP },
  "src/components/ui/alert.tsx": { reads: ["title", "title"], reason: STATIC_TITLE_PROP },
  "src/components/ui/dialog.tsx": { reads: ["title"], reason: STATIC_TITLE_PROP },
  "src/components/ui/empty-state.tsx": { reads: ["title"], reason: STATIC_TITLE_PROP },
  "src/components/ui/error-state.tsx": { reads: ["title", "title"], reason: STATIC_TITLE_PROP },
  "src/components/catalog/product-list-view.tsx": {
    reads: ["empty.title"],
    reason:
      "The empty-list heading from the `empty` prop; all four callers build it from th.ts " +
      "(page.tsx, search/page.tsx, categories/[slug]/page.tsx, store-section.tsx).",
  },
  "src/components/seller/product-form.tsx": {
    reads: ["values.title", "errors.title"],
    reason:
      "`values.title` is the value of the seller's own title input (a form control, not text in " +
      "a sentence); `errors.title` is a validation message from th.ts.",
  },
  "src/components/seller/product-form-model.ts": {
    reads: [
      "stored.title",
      "values.title",
      "values.title",
      "saved.title",
      "changes.title",
      "values.title",
    ],
    reason:
      "Renders nothing (.ts, no JSX): copies the stored title into form values, the form values " +
      "into the request body, and compares them for the edit diff (CR-107).",
  },
};

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
  it("a title holding PDI then RLO cannot close the alt isolate early", () => {
    const [alt] = altsOf(detailWith(`Title${PDI}${RLO}Admin`, 1));
    const end = isolateEnd(alt ?? "", 0);
    expect((alt ?? "").slice(end + 1)).toBe(altSuffix(1, 1));
  });

  it("a title holding an unmatched isolate opener cannot swallow the shop's words", () => {
    const [alt] = altsOf(detailWith(`Title${LRI}Admin`, 1));
    const end = isolateEnd(alt ?? "", 0);
    expect(end).toBeGreaterThan(0);
    expect((alt ?? "").slice(end + 1)).toBe(altSuffix(1, 1));
  });

  it("a title holding RLO and PDF only stays inside the alt isolate (control case)", () => {
    const [alt] = altsOf(detailWith(`Title${RLO}Admin${PDF}`, 1));
    expect((alt ?? "").slice(isolateEnd(alt ?? "", 0) + 1)).toBe(altSuffix(1, 1));
  });

  // Replaced 2026-10-21 (CR-107): the earlier scan matched only the receiver names `product`,
  // `item`, and `line`, so commit 10ef332 took reads out of it by renaming a variable. The scan
  // below is `unsafeTitleReads`: any receiver, and destructured bindings, by syntax tree.
  it("every product title read in storefront source is isolated or pinned (any variable name)", () => {
    const found: Record<string, string[]> = {};
    for (const path of rendererFiles()) {
      const unsafe = unsafeTitleReads(path, readFileSync(path, "utf8"));
      if (unsafe.length > 0) found[posix(path)] = unsafe;
    }
    const pinned = Object.fromEntries(
      Object.entries(TITLE_READ_EXCLUSIONS).map(([path, entry]) => [path, entry.reads]),
    );
    expect(found).toEqual(pinned);
  });

  it("every pinned exclusion is a file that renders nothing or a static or form-field use", () => {
    for (const [path, entry] of Object.entries(TITLE_READ_EXCLUSIONS)) {
      expect(entry.reason.length, path).toBeGreaterThan(20);
      // A .ts file holds no JSX; it can still build a string, so its reads are pinned one by one.
      if (path.endsWith(".ts")) {
        expect(readFileSync(join(ROOT, path), "utf8"), path).not.toMatch(/createElement|<bdi/);
      }
    }
  });

  describe("the scan finds a title rendered without isolation, whatever the variable is called", () => {
    const tsx = (body: string) =>
      `import { th } from "@/i18n/th";\nimport { UserName } from "@/components/user-name";\n${body}`;
    const cases: [string, string, string[]][] = [
      ["bare product.title", "export const A = (p) => <h1>{p.title}</h1>;", ["p.title"]],
      [
        "renamed receiver (10ef332)",
        "const B = (stored) => <h1>{stored.title}</h1>;",
        ["stored.title"],
      ],
      ["optional chain", "const C = (x) => <p>{x?.productTitle}</p>;", ["x?.productTitle"]],
      ["element access", 'const D = (x) => <p>{x["title"]}</p>;', ['x["title"]']],
      [
        "alias through a const",
        "const E = (x) => { const t = x.title; return <p>{t}</p>; };",
        ["x.title"],
      ],
      ["renamed destructuring", "const F = ({ title: name }) => <h2>{name}</h2>;", ["name"]],
      ["shorthand destructuring", "const G = ({ title }) => <h2>{title}</h2>;", ["title"]],
      [
        "a sentence inside UserName",
        "const H = (x) => <UserName>{fill(th.a.b, { t: x.title })}</UserName>;",
        ["x.title"],
      ],
      [
        "text next to it in UserName",
        "const I = (x) => <UserName>{x.title} shop</UserName>;",
        ["x.title"],
      ],
      ["an attribute", "const J = (x) => <img alt={x.title} />;", ["x.title"]],
      [
        "FSI wrap without stripIsolateControls",
        "const FSI = String.fromCodePoint(0x2068);\nconst PDI = String.fromCodePoint(0x2069);\nconst K = (x) => <img alt={`${FSI}${x.title}${PDI}`} />;",
        ["x.title"],
      ],
      [
        "stripped wrap with FSI and PDI that are not the isolate characters",
        'const FSI = "";\nconst PDI = "";\nconst L = (x) => <img alt={`${FSI}${stripIsolateControls(x.title)}${PDI}`} />;',
        ["x.title"],
      ],
      ["th as a member, not the root", "const M = (x) => <p>{x.th.title}</p>;", ["x.th.title"]],
    ];
    it.each(cases)("%s", (_, body, unsafe) => {
      expect(unsafeTitleReads("case.tsx", tsx(body))).toEqual(unsafe);
    });

    it("a `th` that is not the Thai copy import is not exempt", () => {
      const source = [
        'import { th as copy } from "@/i18n/th";',
        'const th = { a: { title: "" } };',
        "const O = () => <p>{th.a.title}{copy.a.title}</p>;",
      ].join("\n");
      expect(unsafeTitleReads("case.tsx", source)).toEqual(["th.a.title", "copy.a.title"]);
    });

    it("isolated forms are not reported", () => {
      const source = tsx(
        [
          "const FSI = String.fromCodePoint(0x2068);",
          "const PDI = String.fromCodePoint(0x2069);",
          "const N = (z) => <h1 title={th.x.title}>",
          "  <UserName>{z.title}</UserName>",
          "  <UserName>",
          "    {z?.productTitle}",
          "  </UserName>",
          "  <img alt={fill(th.y, { t: `${FSI}${stripIsolateControls(z.title)}${PDI}` })} />",
          "</h1>;",
        ].join("\n"),
      );
      expect(unsafeTitleReads("case.tsx", source)).toEqual([]);
    });

    it("the real product card with its UserName removed and the variable renamed is caught", () => {
      const path = join(ROOT, "src", "components", "catalog", "product-card.tsx");
      const original = readFileSync(path, "utf8");
      expect(unsafeTitleReads(path, original)).toEqual([]);
      const bypass = original.replace("<UserName>{product.title}</UserName>", "{stored.title}");
      expect(bypass).not.toBe(original);
      // The old receiver-name pattern does not see it; this scan does.
      expect(bypass.match(/\b(?:product|item|line)\.(?:title|productTitle)\b/g)).toBeNull();
      expect(unsafeTitleReads(path, bypass)).toEqual(["stored.title"]);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// SEC-057 second re-check (2026-10-14, commit b411e34): `stripIsolateControls` removes U+2066 to
// U+2069 from the title before the FSI ... PDI wrap. Bypass search: every isolate control and
// mixes of them, paragraph separators, and a guard that every attribute wrap strips first.
// ---------------------------------------------------------------------------------------------

const LRE = String.fromCodePoint(0x202a);
const RLE = String.fromCodePoint(0x202b);
const LRO = String.fromCodePoint(0x202d);
const RLI = String.fromCodePoint(0x2067);

/**
 * UAX #9 rule P1: text is split into paragraphs at every character of Bidi_Class B, and no
 * isolate, embedding, or override crosses that split. These are all the B characters.
 */
const PARAGRAPH_SEPARATORS = [0x0a, 0x0d, 0x1c, 0x1d, 0x1e, 0x85, 0x2029];

/** As `isolateEnd`, but -1 when a paragraph separator comes before the closing PDI (rule P1). */
function isolateEndInParagraph(text: string, start: number): number {
  const end = isolateEnd(text, start);
  if (end < 0) return -1;
  const inside = [...text.slice(start, end)];
  return inside.some((char) => PARAGRAPH_SEPARATORS.includes(char.codePointAt(0) ?? 0)) ? -1 : end;
}

describe("SEC-057 second re-check: the alt wrap after stripIsolateControls (b411e34)", () => {
  const hostileTitles: [string, string][] = [
    ["LRI alone", `Title${LRI}Admin`],
    ["RLI alone", `Title${RLI}Admin`],
    ["FSI alone", `Title${FSI}Admin`],
    ["PDI then RLO", `Title${PDI}${RLO}Admin`],
    ["two PDIs then RLO", `Title${PDI}${PDI}${RLO}Admin`],
    ["a closed isolate then a stray PDI and RLO", `${RLI}x${PDI}${PDI}${RLO}Admin`],
    ["a title that is itself an FSI ... PDI wrap", `${FSI}Title${PDI}${RLO}Admin`],
    ["three openers, never closed", `${LRI}${RLI}${FSI}Admin`],
    ["unclosed embeddings and overrides", `${LRE}${RLE}${LRO}${RLO}Admin`],
  ];

  it.each(hostileTitles)("%s: the isolate closes right before the shop's words", (_, title) => {
    for (const count of [1, 3]) {
      const alts = altsOf(detailWith(title, count));
      expect(alts).toHaveLength(count);
      alts.forEach((alt, index) => {
        const end = isolateEnd(alt, 0);
        expect(end).toBeGreaterThan(0);
        expect(alt.slice(end + 1)).toBe(altSuffix(index + 1, count));
      });
    }
  });

  it("no isolate control from the title is left in the alt text, only the wrapper's two", () => {
    const all = String.fromCodePoint(0x2066, 0x2067, 0x2068, 0x2069);
    const [alt] = altsOf(detailWith(`a${all}b${all}c`, 1));
    const controls = [...(alt ?? "")].filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code >= 0x2066 && code <= 0x2069;
    });
    expect(controls).toEqual([FSI, PDI]);
  });

  // OPEN (SEC-057, found at this re-check): a paragraph separator in the title ends the FSI
  // isolate (UAX #9 P1). An override after it starts a new paragraph in which the wrapper's PDI
  // matches nothing, so the override runs over "รูปที่ 1 จาก 1". This models UAX #9; it was not
  // checked in a browser (CSS collapses a line feed to a space; U+2029 is not collapsed).
  it("a paragraph separator in the title cannot end the alt isolate", () => {
    const escaping = PARAGRAPH_SEPARATORS.filter((code) => {
      const [alt] = altsOf(detailWith(`Title${String.fromCodePoint(code)}${RLO}Admin`, 1));
      const end = isolateEndInParagraph(alt ?? "", 0);
      return end < 0 || (alt ?? "").slice(end + 1) !== altSuffix(1, 1);
    });
    expect(escaping.map((code) => `U+${code.toString(16).toUpperCase().padStart(4, "0")}`)).toEqual(
      [],
    );
  });

  it("every FSI ... PDI wrap in storefront source strips isolate controls first", () => {
    const files = [
      ...filesUnder(join(ROOT, "src", "app"), (path) => /\.tsx?$/.test(path)),
      ...filesUnder(join(ROOT, "src", "components"), (path) => /\.tsx?$/.test(path)),
    ].filter((path) => !/\.test\.tsx?$/.test(path));
    const unstripped: string[] = [];
    let wraps = 0;
    for (const path of files) {
      const source = readFileSync(path, "utf8");
      for (const match of source.matchAll(/\$\{FSI\}\$\{(.*?)\}\$\{PDI\}/g)) {
        wraps += 1;
        if (!/^stripIsolateControls\([^)]*\)$/.test(match[1] ?? "")) {
          unstripped.push(`${posix(path)}: ${match[0]}`);
        }
      }
    }
    expect(wraps).toBeGreaterThan(0);
    expect(unstripped).toEqual([]);
  });
});
