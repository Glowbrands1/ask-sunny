import { describe, expect, it } from "vitest";

import nextConfig from "../../../../next.config";
import {
  REPORTS_DEFAULT_PATH,
  REPORTS_SECTION_PATH,
} from "@/features/reports/reports-routes";

/**
 * `/reports` RESOLVES TO THE DEFAULT REPORT.
 *
 * There is no `page.tsx` at that path any more, and that is the point: a
 * `redirect()` from a server component cannot send a `Location` header in Next
 * 16, because the response has already begun streaming. It answers `200` with a
 * document carrying a redirect marker for the client router — measured at 13 KB
 * — which works in a browser and does nothing for anything else. A
 * `redirects()` entry is matched before rendering starts.
 *
 * So the behaviour under test is configuration rather than a component, and it
 * is worth a test precisely because nothing in the app imports it: delete the
 * entry and every page still compiles, every other test still passes, and the
 * only symptom is that an old bookmark 404s.
 */

async function redirects() {
  if (typeof nextConfig.redirects !== "function") {
    throw new Error("next.config.ts declares no redirects()");
  }
  return nextConfig.redirects();
}

describe("the /reports redirect", () => {
  it("sends the bare section path to Salon Performance", async () => {
    const rule = (await redirects()).find(
      (candidate) => candidate.source === REPORTS_SECTION_PATH,
    );

    expect(rule).toBeDefined();
    expect(rule?.destination).toBe(REPORTS_DEFAULT_PATH);
    expect(rule?.destination).toBe("/reports/salon-performance");
  });

  it("is temporary, so a browser does not cache it past the section growing", async () => {
    /*
     * `permanent: true` is a 308, which browsers cache indefinitely. When Sales
     * Totals ships and `/reports` becomes a real chooser, anybody who visited
     * it before would keep being redirected by their own browser with no
     * request reaching us.
     */
    const rule = (await redirects()).find(
      (candidate) => candidate.source === REPORTS_SECTION_PATH,
    );
    expect(rule?.permanent).toBe(false);
  });

  it("does not swallow the dashboard or the drill-down", async () => {
    /*
     * THE MISTAKE THIS CATCHES. A source of `/reports/:path*` — or a
     * `permanent` rule on `/reports` matched loosely — would capture
     * `/reports/salon-performance` itself and redirect it to itself forever.
     * Every rule must name an exact path outside the dashboard's subtree.
     */
    for (const rule of await redirects()) {
      expect(rule.source).not.toContain(":path");
      expect(rule.source).not.toContain("*");
      expect(rule.source, rule.source).not.toBe(REPORTS_DEFAULT_PATH);
      expect(rule.source.startsWith(`${REPORTS_DEFAULT_PATH}/`)).toBe(false);
    }
  });

  it("stays on this app, with no deployment-specific hostname", async () => {
    // The dashboard was demonstrated on a Vercel Preview URL. A redirect is the
    // one place a hostname could be smuggled in and still "work" for whoever
    // wrote it.
    for (const rule of await redirects()) {
      expect(rule.destination, rule.destination).toMatch(/^\//);
      expect(rule.destination).not.toContain("vercel.app");
      expect(rule.destination).not.toContain("://");
    }
  });

  it("leaves no page at /reports to be shadowed by it", async () => {
    /*
     * A `redirects()` rule wins over a page at the same path, silently. If
     * somebody restores `/reports/page.tsx` — to bring back the demo screen, or
     * to build the report chooser — it would never render and the reason would
     * not be obvious from the file they were editing.
     */
    const { existsSync } = await import("node:fs");
    expect(existsSync("src/app/(app)/reports/page.tsx")).toBe(false);
  });
});
