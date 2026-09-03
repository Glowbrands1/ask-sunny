import type { NextConfig } from "next";

import {
  REPORTS_DEFAULT_PATH,
  REPORTS_SECTION_PATH,
} from "@/features/reports/reports-routes";

const nextConfig: NextConfig = {
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
