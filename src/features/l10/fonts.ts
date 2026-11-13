import { JetBrains_Mono, Public_Sans } from "next/font/google";

// The Leadership Hub's fonts (its src/app/fonts.ts), loaded only on the DM L10 pages.
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
