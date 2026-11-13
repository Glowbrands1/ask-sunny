import { JetBrains_Mono, Public_Sans } from "next/font/google";

// The Leadership Hub's fonts (its src/app/fonts.ts), for the DM L10 pages (src/features/l10/L10Frame.tsx).
// Declared here, beside the root layout's own next/font calls, rather than under src/features: the first production
// build of the DM L10 tab failed once inside next/font's import map for a call made from src/features (QA,
// 13 Nov 2026; the redeploy of the same commit succeeded). Only the CSS variables are used: the frame sets
// --font-public-sans and --font-jetbrains-mono, which the DM L10 section of globals.css reads.
export const publicSans = Public_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-public-sans",
  display: "swap",
});

export const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: "500",
  variable: "--font-jetbrains-mono",
  display: "swap",
});
