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
 * `src/app/font-files/` (Fontsource's files, each family's OFL licence beside
 * it; latin, plus latin-ext and vietnamese where the family has them, each with
 * Google's unicode-range, so a name like "Łukasz" or "Nguyễn" keeps the face): `next/font/google` downloaded them at build time, and CI's build
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
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" }],
  display: "swap",
});

const passionOneLatinExt = localFont({
  src: [
    { path: "./font-files/passion-one/passion-one-latin-ext-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./font-files/passion-one/passion-one-latin-ext-700-normal.woff2", weight: "700", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "passionOne" },
    { prop: "unicode-range", value: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF" },
  ],
  variable: "--font-passion-one-latin-ext",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

const lato = localFont({
  src: [
    { path: "./font-files/lato/lato-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./font-files/lato/lato-latin-700-normal.woff2", weight: "700", style: "normal" },
    { path: "./font-files/lato/lato-latin-900-normal.woff2", weight: "900", style: "normal" },
  ],
  variable: "--font-lato",
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" }],
  display: "swap",
});

const latoLatinExt = localFont({
  src: [
    { path: "./font-files/lato/lato-latin-ext-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./font-files/lato/lato-latin-ext-700-normal.woff2", weight: "700", style: "normal" },
    { path: "./font-files/lato/lato-latin-ext-900-normal.woff2", weight: "900", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "lato" },
    { prop: "unicode-range", value: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF" },
  ],
  variable: "--font-lato-latin-ext",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

const jost = localFont({
  src: [
    { path: "./font-files/jost/jost-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./font-files/jost/jost-latin-500-normal.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-jost",
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" }],
  display: "swap",
});

const jostLatinExt = localFont({
  src: [
    { path: "./font-files/jost/jost-latin-ext-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./font-files/jost/jost-latin-ext-500-normal.woff2", weight: "500", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "jost" },
    { prop: "unicode-range", value: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF" },
  ],
  variable: "--font-jost-latin-ext",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
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
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" }],
  display: "swap",
});

const frauncesLatinExt = localFont({
  src: [
    { path: "./font-files/fraunces/fraunces-latin-ext-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./font-files/fraunces/fraunces-latin-ext-700-normal.woff2", weight: "700", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "fraunces" },
    { prop: "unicode-range", value: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF" },
  ],
  variable: "--font-fraunces-latin-ext",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

const frauncesVietnamese = localFont({
  src: [
    { path: "./font-files/fraunces/fraunces-vietnamese-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./font-files/fraunces/fraunces-vietnamese-700-normal.woff2", weight: "700", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "fraunces" },
    { prop: "unicode-range", value: "U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB" },
  ],
  variable: "--font-fraunces-vietnamese",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
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
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" }],
  display: "swap",
});

const jakartaLatinExt = localFont({
  src: [
    { path: "./font-files/plus-jakarta-sans/plus-jakarta-sans-latin-ext-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./font-files/plus-jakarta-sans/plus-jakarta-sans-latin-ext-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./font-files/plus-jakarta-sans/plus-jakarta-sans-latin-ext-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./font-files/plus-jakarta-sans/plus-jakarta-sans-latin-ext-700-normal.woff2", weight: "700", style: "normal" },
    { path: "./font-files/plus-jakarta-sans/plus-jakarta-sans-latin-ext-800-normal.woff2", weight: "800", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "jakarta" },
    { prop: "unicode-range", value: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF" },
  ],
  variable: "--font-jakarta-latin-ext",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

const jakartaVietnamese = localFont({
  src: [
    { path: "./font-files/plus-jakarta-sans/plus-jakarta-sans-vietnamese-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./font-files/plus-jakarta-sans/plus-jakarta-sans-vietnamese-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./font-files/plus-jakarta-sans/plus-jakarta-sans-vietnamese-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./font-files/plus-jakarta-sans/plus-jakarta-sans-vietnamese-700-normal.woff2", weight: "700", style: "normal" },
    { path: "./font-files/plus-jakarta-sans/plus-jakarta-sans-vietnamese-800-normal.woff2", weight: "800", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "jakarta" },
    { prop: "unicode-range", value: "U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB" },
  ],
  variable: "--font-jakarta-vietnamese",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

const manrope = localFont({
  // The variable font, every weight (next/font/google loaded Manrope's variable font, no weights named).
  src: "./font-files/manrope/manrope-latin-wght-normal.woff2",
  weight: "200 800",
  style: "normal",
  variable: "--font-manrope",
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" }],
  display: "swap",
});

const manropeLatinExt = localFont({
  src: "./font-files/manrope/manrope-latin-ext-wght-normal.woff2",
  weight: "200 800",
  style: "normal",
  declarations: [
    { prop: "font-family", value: "manrope" },
    { prop: "unicode-range", value: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF" },
  ],
  variable: "--font-manrope-latin-ext",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

const manropeVietnamese = localFont({
  src: "./font-files/manrope/manrope-vietnamese-wght-normal.woff2",
  weight: "200 800",
  style: "normal",
  declarations: [
    { prop: "font-family", value: "manrope" },
    { prop: "unicode-range", value: "U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB" },
  ],
  variable: "--font-manrope-vietnamese",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
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
      // The latin-ext and vietnamese faces join their family by name (font-family in declarations); their variables are
      // set here only so their @font-face rules are emitted with the page. Each is downloaded only when a character in its
      // unicode-range is shown ("Łukasz", "Nguyễn"), as with next/font/google before.
      className={`${lato.variable} ${passionOne.variable} ${jost.variable} ${manrope.variable} ${fraunces.variable} ${jakarta.variable} ${passionOneLatinExt.variable} ${latoLatinExt.variable} ${jostLatinExt.variable} ${frauncesLatinExt.variable} ${frauncesVietnamese.variable} ${jakartaLatinExt.variable} ${jakartaVietnamese.variable} ${manropeLatinExt.variable} ${manropeVietnamese.variable}`}
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
