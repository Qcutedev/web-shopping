/** Paths of the admin area (T-051). `src/proxy.ts` gates everything under `/admin`. */
export const ADMIN_ROUTES = {
  dashboard: "/admin",
  users: "/admin/users",
  applications: "/admin/applications",
  stores: "/admin/stores",
  products: "/admin/products",
  categories: "/admin/categories",
  orders: "/admin/orders",
  reports: "/admin/reports",
  settings: "/admin/settings",
  auditLogs: "/admin/audit-logs",
} as const;

export function adminProductHref(id: string): string {
  return `${ADMIN_ROUTES.products}/${encodeURIComponent(id)}`;
}

export function adminOrderHref(id: string): string {
  return `${ADMIN_ROUTES.orders}/${encodeURIComponent(id)}`;
}
