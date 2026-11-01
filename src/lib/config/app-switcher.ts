/**
 * THE APP SWITCHER'S ONE CONFIG: which Glo Brands apps it links to, and where.
 *
 * Plain links only. No shared login, code, data or environment between the
 * apps; the destination's own sign-in decides what happens on arrival.
 *
 * Addresses are production defaults, each overridable at build time by a
 * `NEXT_PUBLIC_…` variable. They are written as literal `process.env.NEXT_PUBLIC_…`
 * reads because Next inlines only statically written names into the browser.
 */

/*
 * The Leadership Hub tab is NOT a switch in this file. Who sees it is decided on
 * the server from the signed-in person's verified email against the server-only
 * LEADERSHIP_HUB_TAB_EMAILS variable (src/lib/auth/app-switcher.ts); only a
 * yes/no reaches the browser, so this config holds no list and no names.
 */

export const DEFAULT_ASK_BUBBLES_URL = "https://askbubbles.vercel.app";
export const DEFAULT_LEADERSHIP_HUB_URL =
  "https://leadership-hub-beta.vercel.app";

function urlOr(value: string | undefined, fallback: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || fallback;
}

export type SwitchableApp = {
  id: "ask-sunny" | "ask-bubbles" | "leadership-hub";
  emoji: string;
  name: string;
  /** Short line under the name in the menu. */
  company: string;
  url: string;
};

export function switchableApps(
  options: { showLeadershipHub?: boolean } = {},
): readonly SwitchableApp[] {
  // Fails closed: the tab is added only when the server said yes.
  const showLeadershipHub = options.showLeadershipHub === true;
  const apps: SwitchableApp[] = [
    {
      id: "ask-sunny",
      emoji: "☀️",
      name: "Ask Sunny",
      company: "Sun Tan City",
      url: "https://ask-sunny.vercel.app",
    },
    {
      id: "ask-bubbles",
      emoji: "🫧",
      name: "Ask Bubbles",
      company: "Buff City Soap",
      url: urlOr(
        process.env.NEXT_PUBLIC_ASK_BUBBLES_URL,
        DEFAULT_ASK_BUBBLES_URL,
      ),
    },
  ];
  if (showLeadershipHub) {
    apps.push({
      id: "leadership-hub",
      emoji: "🧭",
      name: "Leadership Hub",
      company: "Glo Brands",
      url: urlOr(
        process.env.NEXT_PUBLIC_LEADERSHIP_HUB_URL,
        DEFAULT_LEADERSHIP_HUB_URL,
      ),
    });
  }
  return apps;
}
