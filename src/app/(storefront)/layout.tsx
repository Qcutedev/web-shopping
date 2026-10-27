import { StorefrontShell } from "@/components/shell/storefront-shell";

export default function StorefrontLayout({ children }: LayoutProps<"/">) {
  return <StorefrontShell>{children}</StorefrontShell>;
}
