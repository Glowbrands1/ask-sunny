import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * SURNAME_PARTICLES (QA's audit item 17b, 10 Nov 2026): a typed surname that opens with a particle was cut at it —
 * "maria de la cruz" became "maria de". With production's flags, "create a ca for marisol de la vega, she was late on
 * 11/3" (someone not on the roster) put **Marisol De** on the card. SURNAME_PARTICLES_ENABLED (default off) reads the
 * whole surname; its reader lines are in the protected forms/proposal.ts (Pau, "ok surname particles", 10 Nov 2026).
 * Invented person.
 */
const FIX = ["SURNAME_PARTICLES_ENABLED"];

export const NOV10_SURNAME_PARTICLES_CASES: ReplayCase[] = [
  ["de-la", "create a ca for marisol de la vega, she was late on 11/3", /^marisol de la vega$/i],
  ["van-der", "create a coaching form for marisol van der vega, she was late on 11/3", /^marisol van der vega$/i],
].map(
  ([id, said, name]): ReplayCase => ({
    id: `nov10-surname-particles-${id as string}`,
    title: `"${said as string}": the card's employee is the whole name, never cut at the particle`,
    report: "QA's audit item 17b (10 Nov 2026): \"maria de la cruz\" → \"maria de\"",
    status: { open: "the card's employee stops at the particle (\"Marisol De\", \"Marisol Van\")" },
    fixFlags: FIX,
    // Pau's forms/proposal.ts lines are in ("ok surname particles", 10 Nov 2026): it holds with the fix flag, so the
    // fixStatus goes.
    async run(t) {
      vi.setSystemTime(new Date("2026-11-09T09:00:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const reply = await t.thread().say(said as string);
      expect(reply.formProposal?.employeeName ?? null, reply.content).toMatch(name as RegExp);
    },
  }),
);
