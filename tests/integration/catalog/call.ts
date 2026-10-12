/**
 * Calls the catalog route handlers in process, with a real `Request`, against the worker's test
 * database. Only the HTTP server is left out: the handler, the module, and PostgreSQL are real.
 */
import { GET as getCategories } from "@/app/api/v1/categories/route";
import { GET as getProducts } from "@/app/api/v1/products/route";
import { GET as getProductBySlug } from "@/app/api/v1/products/[slug]/route";
import { GET as getProductReviews } from "@/app/api/v1/products/[slug]/reviews/route";
import { GET as getStoreBySlug } from "@/app/api/v1/stores/[slug]/route";
import { GET as getStoreProducts } from "@/app/api/v1/stores/[slug]/products/route";

const ORIGIN = "http://localhost:3000";

export interface Called<T = unknown> {
  status: number;
  headers: Headers;
  body: T;
}

export interface ListBody<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown>; requestId: string };
}

function request(path: string, query: string, headers?: HeadersInit): Request {
  const search = query === "" ? "" : `?${query}`;
  return new Request(`${ORIGIN}/api/v1${path}${search}`, { headers });
}

async function read<T>(response: Response): Promise<Called<T>> {
  return {
    status: response.status,
    headers: response.headers,
    body: (await response.json()) as T,
  };
}

/** The slug as it stands in the URL path: percent-encoded, as a browser sends Thai text. */
function encoded(slug: string): string {
  return encodeURIComponent(slug);
}

function params(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

export async function callCategories<T = unknown>(query = "", headers?: HeadersInit) {
  return read<T>(await getCategories(request("/categories", query, headers)));
}

export async function callProducts<T = unknown>(query = "", headers?: HeadersInit) {
  return read<T>(await getProducts(request("/products", query, headers)));
}

export async function callProduct<T = unknown>(slug: string, headers?: HeadersInit) {
  return read<T>(
    await getProductBySlug(request(`/products/${encoded(slug)}`, "", headers), params(slug)),
  );
}

export async function callProductReviews<T = unknown>(slug: string, query = "") {
  return read<T>(
    await getProductReviews(request(`/products/${encoded(slug)}/reviews`, query), params(slug)),
  );
}

export async function callStore<T = unknown>(slug: string) {
  return read<T>(await getStoreBySlug(request(`/stores/${encoded(slug)}`, ""), params(slug)));
}

export async function callStoreProducts<T = unknown>(slug: string, query = "") {
  return read<T>(
    await getStoreProducts(request(`/stores/${encoded(slug)}/products`, query), params(slug)),
  );
}

/** Calls a handler with the slug exactly as given, for the encoding cases. */
export async function callProductRawSlug<T = unknown>(rawSlug: string) {
  return read<T>(await getProductBySlug(request(`/products/${rawSlug}`, ""), params(rawSlug)));
}
