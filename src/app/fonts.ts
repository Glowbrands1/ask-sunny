import localFont from "next/font/local";

// The Leadership Hub's fonts (its src/app/fonts.ts), for the DM L10 pages (src/features/l10/L10Frame.tsx).
// Declared here, beside the root layout's own next/font calls, rather than under src/features: the first production
// build of the DM L10 tab failed once inside next/font's import map for a call made from src/features (QA,
// 13 Nov 2026; the redeploy of the same commit succeeded). Only the CSS variables are used: the frame sets
// --font-public-sans and --font-jetbrains-mono, which the DM L10 section of globals.css reads. Since 15 Nov 2026 the
// files are committed under src/app/font-files/ (`next/font/local`, see layout.tsx): CI's build failed whenever
// next/font/google could not reach Google Fonts.
export const publicSans = localFont({
  src: [
    { path: "./font-files/public-sans/public-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./font-files/public-sans/public-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./font-files/public-sans/public-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./font-files/public-sans/public-sans-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-public-sans",
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" }],
  display: "swap",
});

export const publicSansLatinExt = localFont({
  src: [
    { path: "./font-files/public-sans/public-sans-latin-ext-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./font-files/public-sans/public-sans-latin-ext-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./font-files/public-sans/public-sans-latin-ext-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./font-files/public-sans/public-sans-latin-ext-700-normal.woff2", weight: "700", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "publicSans" },
    { prop: "unicode-range", value: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF" },
  ],
  variable: "--font-public-sans-latin-ext",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

export const publicSansVietnamese = localFont({
  src: [
    { path: "./font-files/public-sans/public-sans-vietnamese-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./font-files/public-sans/public-sans-vietnamese-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./font-files/public-sans/public-sans-vietnamese-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./font-files/public-sans/public-sans-vietnamese-700-normal.woff2", weight: "700", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "publicSans" },
    { prop: "unicode-range", value: "U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB" },
  ],
  variable: "--font-public-sans-vietnamese",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

export const jetBrainsMono = localFont({
  src: "./font-files/jetbrains-mono/jetbrains-mono-latin-500-normal.woff2",
  weight: "500",
  style: "normal",
  variable: "--font-jetbrains-mono",
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" }],
  display: "swap",
});

export const jetBrainsMonoLatinExt = localFont({
  src: [
    { path: "./font-files/jetbrains-mono/jetbrains-mono-latin-ext-500-normal.woff2", weight: "500", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "jetBrainsMono" },
    { prop: "unicode-range", value: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF" },
  ],
  variable: "--font-jet-brains-mono-latin-ext",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

export const jetBrainsMonoVietnamese = localFont({
  src: [
    { path: "./font-files/jetbrains-mono/jetbrains-mono-vietnamese-500-normal.woff2", weight: "500", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "jetBrainsMono" },
    { prop: "unicode-range", value: "U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB" },
  ],
  variable: "--font-jet-brains-mono-vietnamese",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

/** Every L10 font variable, the latin-ext and vietnamese faces included, for the frame's className (`L10Frame.tsx`). */
export const l10FontVariables = [publicSans, jetBrainsMono, publicSansLatinExt, publicSansVietnamese, jetBrainsMonoLatinExt, jetBrainsMonoVietnamese].map((font) => font.variable).join(" ");
