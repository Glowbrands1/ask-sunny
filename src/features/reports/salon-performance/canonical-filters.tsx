"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

/**
 * TIDIES THE ADDRESS BAR TO MATCH WHAT IS ON SCREEN.
 *
 * The server has already sanitized the filters and rendered the correct
 * dashboard; this only brings the URL into line, so a manager who followed a
 * stale link can copy what is in front of them and have it mean the same thing
 * to the next person.
 *
 * THREE DECISIONS, each guarding something that was reported broken.
 *
 * `replace`, not `push`. A canonicalization is not a thing a manager did, so it
 * must not become a history entry — otherwise Back returns to the invalid URL,
 * which canonicalizes again, and Back stops working entirely.
 *
 * `scroll: false`. This runs after the page has painted. A scrolling navigation
 * here would throw a reader who deep-linked into the table straight back to the
 * header — the exact regression the filter controls were fixed for once already.
 *
 * COMPARED AGAINST THE LIVE LOCATION, not against a prop. `enabled` says the
 * server changed something, but the browser may already be at the canonical URL
 * — most obviously right after this component itself replaced it. Re-issuing the
 * same URL would loop. Reading `window.location` is what makes this idempotent.
 *
 * There is no fallback for JavaScript being unavailable, and that is correct:
 * without it the page still renders the right numbers under the right headings,
 * and only the address bar is untidy.
 */
export function CanonicalFilters({
  href,
  enabled,
}: {
  /** The path and query the current view should be addressed by. */
  href: string;
  /** False when the incoming filters were already canonical. */
  enabled: boolean;
}) {
  const router = useRouter();

  React.useEffect(() => {
    if (!enabled) return;
    const current = `${window.location.pathname}${window.location.search}`;
    if (current === href) return;
    router.replace(href, { scroll: false });
  }, [enabled, href, router]);

  return null;
}
