import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";

import { ACTIVE_BRAND, brandStyle } from "@/lib/brand";
import { Providers } from "./providers";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: `${ACTIVE_BRAND.productName} — ${ACTIVE_BRAND.tagline}`,
    template: `%s · ${ACTIVE_BRAND.productName}`,
  },
  description:
    "Ask Sunny is the manager operating platform for JV & Associates: assistant, knowledge base, forms, follow-ups, training, reporting and reviews in one place.",
};

export const viewport: Viewport = {
  themeColor: "#fbf9f7",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={manrope.variable}
      // Brand palette overrides are applied here, so a second brand instance
      // (Buff City Soap) is a BrandConfig swap rather than a restyle.
      style={brandStyle(ACTIVE_BRAND)}
    >
      <body className="antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-100 focus:rounded-[var(--radius-sm)] focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-float"
        >
          Skip to main content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
