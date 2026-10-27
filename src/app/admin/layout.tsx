import { StorefrontShell } from "@/components/shell/storefront-shell";

// The admin area uses the storefront frame (header, footer, one `main`). Access is decided by each
// page's data section and by the services, never by this layout.
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return <StorefrontShell>{children}</StorefrontShell>;
}
