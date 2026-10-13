/**
 * Paths of the storefront pages that the app shell links to, in one place.
 *
 * No page route list has been decided yet (open owner question). Until the pages exist, links to
 * `search`, `cart`, `signIn`, and `openStore` lead to the not-found page. Each path is the
 * frontend agent's working assumption and changes here only.
 */
export const ROUTES = {
  home: "/",
  search: "/search",
  cart: "/cart",
  signIn: "/sign-in",
  openStore: "/seller/apply",
  // Account area (T-030). `src/proxy.ts` already gates `/account/*`.
  account: "/account",
  accountAddresses: "/account/addresses",
} as const;

/** Name of the query parameter that carries the page to return to after signing in. */
export const SIGN_IN_NEXT_PARAM = "next";

/**
 * Sign-in address with the page the person wanted. `next` is a fixed in-app path chosen by the
 * caller, never request input; the sign-in page still validates it (TM-19).
 */
export function signInHref(next: string): string {
  return `${ROUTES.signIn}?${SIGN_IN_NEXT_PARAM}=${encodeURIComponent(next)}`;
}

/** Name of the query parameter that the search page reads (`q` of GET /api/v1/products). */
export const SEARCH_QUERY_PARAM = "q";
