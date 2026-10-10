import type { Metadata } from "next";
import { th } from "@/i18n/th";
import "./globals.css";

export const metadata: Metadata = {
  title: th.site.name,
  description: th.site.description,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="th" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
