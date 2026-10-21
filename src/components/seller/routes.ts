import { ROUTES } from "@/lib/routes";

/**
 * Paths of the seller area (T-044). `apply` is the path the storefront header already links to
 * (`ROUTES.openStore`). `src/proxy.ts` gates everything under `/seller`.
 */
export const SELLER_ROUTES = {
  dashboard: "/seller",
  apply: ROUTES.openStore,
  store: "/seller/store",
  products: "/seller/products",
  newProduct: "/seller/products/new",
  orders: "/seller/orders",
} as const;

export function sellerProductHref(id: string): string {
  return `${SELLER_ROUTES.products}/${encodeURIComponent(id)}`;
}

export function sellerOrderHref(id: string): string {
  return `${SELLER_ROUTES.orders}/${encodeURIComponent(id)}`;
}
