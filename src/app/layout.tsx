import type { Metadata } from "next";
import { IBM_Plex_Sans_Thai } from "next/font/google";
import { th } from "@/i18n/th";
import "./globals.css";

// Design system typography (docs/DESIGN_SYSTEM.md): weights 400 to 700, Thai and Latin subsets.
// The variable is consumed by --font-sans in globals.css.
const ibmPlexSansThai = IBM_Plex_Sans_Thai({
  weight: ["400", "500", "600", "700"],
  subsets: ["thai", "latin"],
  display: "swap",
  variable: "--font-ibm-plex-sans-thai",
});

export const metadata: Metadata = {
  title: { default: th.site.name, template: `%s | ${th.site.name}` },
  description: th.site.description,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="th" className={`${ibmPlexSansThai.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
