import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * "CORRECTIVE ACTION FOR TANNING CONSULTANT <NAME>": THE FORM IS FOR <NAME> (ported from Ask Bubbles, 11 Nov 2026;
 * TITLE_BEFORE_NAME_ENABLED)
 * ============================================================================
 *
 * QA's Ask Bubbles 17h live test: "Corrective action for Team Member <name not on the roster>" gave no card. Here, with
 * this app's titles and production's flags (main 2805f4f1), the card opens with nobody on it ("Corrective action for
 * Tanning Consultant <name>"), and a short title is read into the name ("Sdit Wren Tallis", "Tc Wren Tallis"). The
 * mechanism is the sibling's; the person is invented and not on the roster.
 */
const NAME = "Wren Tallis";
const FIX = ["TITLE_BEFORE_NAME_ENABLED"];
const REPORT = "Ported from Ask Bubbles (QA's 17h live test, 11 Nov 2026): a job title before the name was read as part of it, or emptied the card";
const EVERY_SALON = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

async function ask(t: ReplayContext, role: "admin" | "salon_director", words: string) {
  vi.setSystemTime(new Date("2026-11-11T15:00:00Z"));
  t.directory(STAFF);
  t.as(role, role === "admin" ? EVERY_SALON : KEARNEY);
  const thread = t.thread();
  const reply = await thread.say(words);
  return { reply, proposal: thread.proposal };
}

export const NOV11_TITLE_BEFORE_NAME_CASES: ReplayCase[] = [
  ...(
    [
      ["tanning-consultant", `Corrective action for Tanning Consultant ${NAME}`, "the card has no employee"],
      ["sdit", `Corrective action for SDIT ${NAME}`, `the card's employee is "Sdit ${NAME}"`],
      ["create-tc", `Create a corrective action for TC ${NAME}`, `the card's employee is "Tc ${NAME}"`],
    ] as const
  ).map(([key, words, open]) => ({
    id: `nov11-title-before-name-admin-${key}`,
    title: `"${words}" (admin): the Corrective Action card, for ${NAME}`,
    report: REPORT,
    status: { open },
    fixFlags: FIX,
    async run(t: ReplayContext) {
      const { reply, proposal } = await ask(t, "admin", words);
      expect(proposal?.templateKey, `no Corrective Action card:\n${reply.content}`).toBe("dpoa");
      expect(proposal?.employeeName ?? null, `the card is not for ${NAME}:\n${reply.content}`).toBe(NAME);
    },
  })),
  {
    id: "nov11-title-before-name-salon-director",
    // A salon-scoped manager is asked about a name on nobody's roster before the card, exactly as "Corrective action
    // for Wren Tallis" is; the question names the person, never the title.
    title: `"Corrective action for Tanning Consultant ${NAME}" (salon director): asked about ${NAME} as the plain name is`,
    report: REPORT,
    status: { open: "no question about the name: the card opens with nobody on it" },
    fixFlags: FIX,
    async run(t: ReplayContext) {
      const { reply } = await ask(t, "salon_director", `Corrective action for Tanning Consultant ${NAME}`);
      expect(reply.content, reply.content).toContain(`I can't find **${NAME}** on your roster`);
      expect(reply.content, reply.content).not.toMatch(/Tanning Consultant Wren Tallis/);
    },
  },
  {
    id: "nov11-title-before-name-plain-name-unchanged",
    title: `NEVER-BREAK: "Corrective action for ${NAME}" still cards for ${NAME}`,
    report: REPORT,
    status: "fixed",
    fixFlags: FIX,
    async run(t: ReplayContext) {
      const { reply, proposal } = await ask(t, "admin", `Corrective action for ${NAME}`);
      expect(proposal?.employeeName ?? null, reply.content).toBe(NAME);
    },
  },
];
