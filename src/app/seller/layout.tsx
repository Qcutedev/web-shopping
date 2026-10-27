import { StorefrontShell } from "@/components/shell/storefront-shell";

// The seller area uses the storefront frame (header, footer, one `main`). Access is decided by
// each page's data section and by the services, never by this layout.
export default function SellerLayout({ children }: LayoutProps<"/seller">) {
  return <StorefrontShell>{children}</StorefrontShell>;
}
