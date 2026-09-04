import type { Metadata, Viewport } from "next";
import { Lato, Manrope, Passion_One } from "next/font/google";

import { ACTIVE_BRAND, brandStyle } from "@/lib/brand";
import { pageAuthorizationEnforced, pageIdentity } from "@/lib/auth/page";
import { Providers } from "./providers";
import "./globals.css";

/**
 * THE APPROVED PAIRING: Passion One for display, Lato for everything else.
 *
 * Both through `next/font`, which is why this is safe to add: the files are
 * downloaded at BUILD time and served from this origin, so there is no runtime
 * request to a font CDN, no third-party dependency in the critical path and
 * nothing to block first paint. `display: "swap"` plus the fallback stacks in
 * globals.css mean text is readable before the webfont lands rather than
 * invisible, and the metric-adjusted fallbacks Next generates keep the reflow
 * from being a visible jump.
 *
 * PASSION ONE IS A DISPLAY FACE AND IS TREATED AS ONE. It carries headings and
 * prominent metrics; it is never used for body copy, form labels or anything
 * under 16px, where its tight apertures and heavy weight make it genuinely
 * hard to read. That is why Lato is loaded alongside rather than instead of it.
 *
 * Manrope stays for now: it is what every existing screen is set in, so
 * removing it would restyle the whole product in a checkpoint whose brief was
 * to BEGIN applying the new direction. `--font-sans` points at Lato, so new and
 * updated surfaces pick it up; Manrope remains available under its own
 * variable until the changeover is finished deliberately.
 */
const passionOne = Passion_One({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-passion-one",
  display: "swap",
});

const lato = Lato({
  subsets: ["latin"],
  weight: ["400", "700", "900"],
  variable: "--font-lato",
  display: "swap",
});

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
  themeColor: "#fff6f0",
  width: "device-width",
  initialScale: 1,
};

/**
 * WHY THE ROOT LAYOUT RESOLVES THE IDENTITY.
 *
 * The shell renders the person's name, their scope and their navigation, so
 * every route already depends on who is asking. Resolving it here means one
 * lookup per request feeds the whole tree, rather than each page passing its
 * own copy down or the client asking after the fact.
 *
 * The cost is that reading request headers opts every route into dynamic
 * rendering. That is the right trade for an authenticated application: there is
 * no useful static version of a page whose contents depend on the reader, and
 * the alternative is a shell that renders as a stranger and then corrects
 * itself.
 *
 * Only the PROFILE crosses into the client — no token, no session object. The
 * browser's Supabase session lives in an HTTP-only cookie it cannot read.
 */
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const productionAuth = pageAuthorizationEnforced();
  const identity = productionAuth ? await pageIdentity() : null;

  return (
    <html
      lang="en"
      className={`${lato.variable} ${passionOne.variable} ${manrope.variable}`}
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
        <Providers
          productionAuth={productionAuth}
          session={
            identity
              ? {
                  subject: identity.subject,
                  email: identity.email,
                  displayName: identity.displayName,
                  role: identity.role,
                  scope: identity.scope,
                }
              : null
          }
        >
          {children}
        </Providers>
      </body>
    </html>
  );
}
