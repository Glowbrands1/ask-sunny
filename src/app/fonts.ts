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
  display: "swap",
});

export const jetBrainsMono = localFont({
  src: "./font-files/jetbrains-mono/jetbrains-mono-latin-500-normal.woff2",
  weight: "500",
  style: "normal",
  variable: "--font-jetbrains-mono",
  display: "swap",
});
