import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import { ACTIVE_BRAND, brandStyle } from "@/lib/brand";
import { pageAuthorizationEnforced, pageIdentity } from "@/lib/auth/page";
import { Providers } from "./providers";
import "./globals.css";

/**
 * THE APPROVED PAIRING: Passion One for display, Lato for everything else.
 *
 * Both through `next/font`, which is why this is safe to add: the files are
 * served from this origin, so there is no runtime request to a font CDN, no
 * third-party dependency in the critical path and nothing to block first paint.
 * Since 15 Nov 2026 they are `next/font/local` with the files committed under
 * `src/app/font-files/` (Fontsource's latin subsets, each family's OFL licence
 * beside it): `next/font/google` downloaded them at build time, and CI's build
 * failed whenever GitHub's runners could not reach Google Fonts (QA). Same
 * families, weights, subset and CSS variables as before. `display: "swap"` plus the fallback stacks in
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
 *
 * JOST CARRIES THE WORDMARKS ONLY. The direction sets both "Ask Sunny" and the
 * "Sun Tan City" lockup in a wide-tracked geometric sans, which is a different
 * job from either display headings or body copy — a logotype, at two sizes, and
 * nothing else in the product uses it.
 */
const passionOne = localFont({
  src: [
    { path: "./font-files/passion-one/passion-one-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./font-files/passion-one/passion-one-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-passion-one",
  display: "swap",
});

const lato = localFont({
  src: [
    { path: "./font-files/lato/lato-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./font-files/lato/lato-latin-700-normal.woff2", weight: "700", style: "normal" },
    { path: "./font-files/lato/lato-latin-900-normal.woff2", weight: "900", style: "normal" },
  ],
  variable: "--font-lato",
  display: "swap",
});

const jost = localFont({
  src: [
    { path: "./font-files/jost/jost-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./font-files/jost/jost-latin-500-normal.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-jost",
  display: "swap",
});

/**
 * FRAUNCES CARRIES THE SIGN-IN SCREEN'S TWO HEADINGS ONLY — the "soft horizon"
 * sign-in design sets them in a warm serif. Nothing else in the product uses it.
 */
const fraunces = localFont({
  src: [
    { path: "./font-files/fraunces/fraunces-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./font-files/fraunces/fraunces-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  // A serif, as next/font/google measured its fallback against.
  adjustFontFallback: "Times New Roman",
  variable: "--font-fraunces",
  display: "swap",
});

/**
 * PLUS JAKARTA SANS IS THE CLAY DIRECTION'S FACE — body and headings alike,
 * heavy and rounded, from the approved clay mockup. Lato stays behind it in
 * the stack as the fallback.
 */
const jakarta = localFont({
  src: [
    { path: "./font-files/plus-jakarta-sans/plus-jakarta-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./font-files/plus-jakarta-sans/plus-jakarta-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./font-files/plus-jakarta-sans/plus-jakarta-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./font-files/plus-jakarta-sans/plus-jakarta-sans-latin-700-normal.woff2", weight: "700", style: "normal" },
    { path: "./font-files/plus-jakarta-sans/plus-jakarta-sans-latin-800-normal.woff2", weight: "800", style: "normal" },
  ],
  variable: "--font-jakarta",
  display: "swap",
});

const manrope = localFont({
  // The variable font, every weight (next/font/google loaded Manrope's variable font, no weights named).
  src: "./font-files/manrope/manrope-latin-wght-normal.woff2",
  weight: "200 800",
  style: "normal",
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: `${ACTIVE_BRAND.productName} — ${ACTIVE_BRAND.tagline}`,
    template: `%s · ${ACTIVE_BRAND.productName}`,
  },
  description:
    "Ask Sunny is the manager operating platform for JB & Associates: assistant, knowledge base, forms, follow-ups, training, reporting and reviews in one place.",
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
      className={`${lato.variable} ${passionOne.variable} ${jost.variable} ${manrope.variable} ${fraunces.variable} ${jakarta.variable}`}
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
