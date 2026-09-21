import path from "node:path";

import type { NextConfig } from "next";

import {
  REPORTS_DEFAULT_PATH,
  REPORTS_SECTION_PATH,
} from "@/features/reports/reports-routes";

/**
 * ============================================================================
 * WHICH SIDE OF THE DEMO BOUNDARY THIS BUILD COMPILES
 * ============================================================================
 *
 * `src/lib/demo/runtime.ts` is the production implementation: empty
 * collections, absent screens, and no import of `data/demo/*`. Every
 * production-reachable module imports it. When — and only when — a build
 * explicitly asks for the demo, it is substituted for `runtime.demo.ts`,
 * which is the one module in the repository allowed to import the seeded
 * datasets.
 *
 * SO A PRODUCTION BUILD DOES NOT CONTAIN THE SEEDED RECORDS, rather than
 * containing them behind a branch nobody takes. The previous design reached
 * them through dynamic imports, which kept them out of every page's download
 * and still emitted eleven chunks carrying Jane Kowalski, `example.com` links
 * and a fabricated $214.62. A module nothing imports is a module nothing
 * emits; that is the whole mechanism.
 *
 * ============================================================================
 * THE CONTRACT, AND IT MIRRORS `lib/config/runtime.ts` ON PURPOSE
 * ============================================================================
 *
 *   Vercel Production            -> production, always, flag ignored
 *   flag absent                  -> production
 *   flag invalid / "false" / ""  -> production
 *   flag exactly "true"          -> demo
 *
 * Demo is an intentional BUILD configuration. Nothing at runtime can move a
 * production build onto the demo implementation, because the demo code is not
 * in the bundle to move to.
 *
 * THE TWO DECISIONS ARE DELIBERATELY MADE THE SAME WAY. `isDemoMode()` decides
 * what RENDERS and is read in the browser; this decides what EXISTS and is
 * read once, by the compiler. If they ever disagreed, the failure would be a
 * demo build whose screens refuse to render, or — much worse — a production
 * build that renders screens it did not compile. Keeping the rule identical in
 * both places is what makes that impossible, and
 * `demo-boundary.test.ts` asserts the two implementations stay in step.
 */
function demoBuildRequested(): boolean {
  const normalise = (value: string | undefined) => value?.trim().toLowerCase() ?? "";

  // A deployment Vercel itself built for Production is never a demo build.
  if (normalise(process.env.NEXT_PUBLIC_VERCEL_ENV) === "production") {
    if (normalise(process.env.NEXT_PUBLIC_ALLOW_DEMO_IN_PRODUCTION) !== "true") {
      return false;
    }
  }

  return normalise(process.env.NEXT_PUBLIC_DEMO_MODE) === "true";
}

const DEMO_BUILD = demoBuildRequested();

/**
 * The demo implementation, for the bundler's alias table.
 *
 * TWO SPELLINGS, because the two bundlers want different things. Turbopack
 * resolves a project-relative specifier and rejects an absolute path (it
 * reports `module-not-found` for the aliased request, which is how this was
 * found); webpack's `resolve.alias` wants a real path.
 */
const DEMO_RUNTIME_RELATIVE = "./src/lib/demo/runtime.demo.ts";
const DEMO_RUNTIME_ABSOLUTE = path.join(process.cwd(), "src/lib/demo/runtime.demo.ts");

const nextConfig: NextConfig = {
  /*
   * TURBOPACK IS WHAT `next build` USES HERE, and the webpack entry below
   * covers a build that opts out. Both point one specifier at one file; there
   * is no per-dataset stub list to keep in step.
   */
  ...(DEMO_BUILD
    ? {
        turbopack: {
          resolveAlias: {
            "@/lib/demo/runtime": DEMO_RUNTIME_RELATIVE,
          },
        },
        webpack: (config: { resolve?: { alias?: Record<string, string> } }) => {
          config.resolve ??= {};
          config.resolve.alias = {
            ...config.resolve.alias,
            "@/lib/demo/runtime": DEMO_RUNTIME_ABSOLUTE,
          };
          return config;
        },
      }
    : {}),

  async redirects() {
    return [
      {
        /*
         * REPORTS & ANALYTICS RESOLVES TO ITS DEFAULT REPORT.
         *
         * The sidebar links straight to the dashboard, so this covers the bare
         * path: a typed URL, an old bookmark, a link written before the
         * dashboard existed. `/reports` used to render a separate screen of
         * seeded demo figures under the same title, which is how the real
         * dashboard ended up reachable only by knowing its URL.
         *
         * AT THE ROUTING LAYER, NOT IN A PAGE, and the reason is measured
         * rather than assumed. `redirect()` from a server component in Next 16
         * cannot send a `Location` header: the response has already begun
         * streaming, so Next answers `200` with a 13 KB HTML document carrying
         * a redirect marker for the client router to act on after hydration.
         * That works in a browser and is wasteful everywhere else — a payload
         * and a hydration pass to say "go elsewhere", and nothing at all for a
         * client that does not run JavaScript. A `redirects()` entry is matched
         * before any rendering starts and answers with a real `307`.
         *
         * `permanent: false` deliberately. A 308 is cached by browsers
         * indefinitely, and this mapping is expected to change: when Sales
         * Totals ships, `/reports` becomes a real index that lets a manager
         * choose. Whoever does that should delete this entry — a `redirects()`
         * rule shadows a page at the same path, so a new `/reports/page.tsx`
         * would silently never render while this is here.
         */
        source: REPORTS_SECTION_PATH,
        destination: REPORTS_DEFAULT_PATH,
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
