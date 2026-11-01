import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * QA, live, 1 Nov 2026: with no `maxDuration` export the platform stopped
 * /api/chat at 30 s. A long answer (a report briefing, or one asked again with
 * more room after it ran out) finished on the server after the manager had
 * already been shown "could not produce an answer". The route keeps the same
 * ceiling as the draft route. Next reads the export statically, so it is pinned
 * in the source.
 */
describe("/api/chat may run past 30 seconds", () => {
  it("exports maxDuration of at least 120 seconds", () => {
    const source = readFileSync("src/app/api/chat/route.ts", "utf8");
    const match = /^export const maxDuration = (\d+);$/m.exec(source);
    expect(match, "src/app/api/chat/route.ts exports no maxDuration").not.toBeNull();
    expect(Number(match![1])).toBeGreaterThanOrEqual(120);
  });
});
