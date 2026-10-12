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
} as const;

/** Name of the query parameter that the search page reads (`q` of GET /api/v1/products). */
export const SEARCH_QUERY_PARAM = "q";
