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
  let reply = await thread.say(words);
  // The sibling app's Gate-Bubbles R795T (12 Nov 2026): a name off the roster after a title goes the normal off-roster
  // way, said back with the "use <name>" offer; an admin takes it, as a manager would.
  if (role === "admin" && reply.content.includes(`reply **use ${NAME}**`)) reply = await thread.say(`use ${NAME}`);
  return { reply, proposal: thread.proposal };
}

export const NOV11_TITLE_BEFORE_NAME_CASES: ReplayCase[] = [
  ...(
    [
      ["tanning-consultant", `Corrective action for Tanning Consultant ${NAME}`, "the card has no employee"],
      ["sdit", `Corrective action for SDIT ${NAME}`, `the card's employee is "Sdit ${NAME}"`],
      ["create-tc", `Create a corrective action for TC ${NAME}`, `the card's employee is "Tc ${NAME}"`],
      // QA's ruling (11 Nov 2026): the protected reader reads "Director <name>" here and the card loses it.
      ["salon-director", `Corrective action for Salon Director ${NAME}`, "the card has no employee"],
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
    id: "nov11-title-before-name-salon-director-scoped-salon-director",
    title: `"Corrective action for Salon Director ${NAME}" (salon director): asked about ${NAME} as the plain name is`,
    report: REPORT,
    status: { open: "no question about the name: the card opens with nobody on it" },
    fixFlags: FIX,
    async run(t: ReplayContext) {
      const { reply } = await ask(t, "salon_director", `Corrective action for Salon Director ${NAME}`);
      expect(reply.content, reply.content).toContain(`I can't find **${NAME}** on your roster`);
      expect(reply.content, reply.content).not.toMatch(/Director Wren Tallis/);
    },
  },
  /*
   * QA (12 Nov 2026): the created draft, not only the card. "Corrective action for Salon Director <name>" was refused at
   * Create ("the conversation now says the form is for Director <name>"), and "… for SDIT <name>" drafted
   * "Observed: SDIT <name>." The draft is <name>'s and holds what the plain-name request's draft holds (its Action Plan
   * included, which with no account given is none in either), plus the stated job title; the title is never the account.
   */
  ...(["Salon Director", "Tanning Consultant", "SDIT"] as const).map((title) => ({
    id: `nov11-title-before-name-draft-${title.toLowerCase().replace(/\s+/g, "-")}`,
    title: `"Corrective action for ${title} ${NAME}" (admin): Create makes the draft for ${NAME}, with its Action Plan`,
    report: REPORT,
    status: { open: `the draft is not ${NAME}'s, or Create refuses the card` } as const,
    fixFlags: FIX,
    async run(t: ReplayContext) {
      vi.setSystemTime(new Date("2026-11-11T15:00:00Z"));
      t.directory(STAFF);
      t.as("admin", EVERY_SALON);
      const plain = t.thread();
      await plain.say(`Corrective action for ${NAME}`);
      const expected = t.values(await plain.create());
      const thread = t.thread();
      const first = await thread.say(`Corrective action for ${title} ${NAME}`);
      // A name off the roster after a title goes the normal off-roster way (the sibling app's R795T): take the offer.
      if (first.content.includes(`reply **use ${NAME}**`)) await thread.say(`use ${NAME}`);
      const values = t.values(await thread.create());
      expect(values.employee_name, JSON.stringify(values)).toBe(NAME);
      expect(values.observation ?? "", JSON.stringify(values)).not.toMatch(new RegExp(`${title}\\s+${NAME}`, "i"));
      // The same draft as the plain-name request's, but for the job title the manager stated.
      const { job_title: stated, ...rest } = values;
      expect(stated, JSON.stringify(values)).toBeTruthy();
      expect(rest, `titled: ${JSON.stringify(values)}\nplain: ${JSON.stringify(expected)}`).toEqual(expected);
    },
  })),
  /*
   * The sibling app's Gate-Bubbles R795T (12 Nov 2026): "Create a CA for Team Member Of The Month" gave a READY card for
   * "Of The Month" and an empty reply. Here with this app's titles: an award, a time, an event or a shift after a title
   * is nobody, the card asks who as it does with the flag off, and the reply is never empty.
   */
  ...(
    [
      ["of-the-month", "Create a CA for Tanning Consultant Of The Month", "Of The Month"],
      ["of-the-year", "Create a CA for Salon Director Of The Year", "Of The Year"],
      ["tc-training", "Create a CA for TC Training", "Training"],
      ["dm-visit", "Create a CA for DM Visit", "Visit"],
      // Gate-Sunny's probe of 92a3cca9 (12 Nov 2026), its wordings.
      ["sdit-training", "Create a CA for SDIT Training", "Training"],
      ["training-day", "Create a CA for Salon Director Training Day", "Training Day"],
      ["tc-monday", "Create a CA for TC Monday", "Monday"],
      ["dm-approval", "Create a CA for DM Approval", "Approval"],
      ["the-new-girl", "Create a CA for Tanning Consultant The New Girl", "The New Girl"],
    ] as const
  ).map(([key, words, notAName]) => ({
    id: `nov12-title-before-name-not-a-person-${key}`,
    title: `NEVER-BREAK: "${words}" names nobody: no "${notAName}" on the card, and the reply is never empty`,
    report: "The sibling app's Gate-Bubbles R795T (12 Nov 2026): a title before an award or event name made a person of the rest",
    status: "fixed" as const,
    fixFlags: FIX,
    async run(t: ReplayContext) {
      const { reply, proposal } = await ask(t, "admin", words);
      expect(proposal?.employeeName ?? null, reply.content).not.toBe(notAName);
      expect(proposal?.status === "ready" && !proposal?.employeeName, "a ready card with nobody on it").toBe(false);
      expect(reply.content.trim(), "the reply is empty").not.toBe("");
    },
  })),
  {
    id: "nov12-title-before-name-trailing-today",
    title: `"Corrective action for Tanning Consultant ${NAME} Today": asked about ${NAME}, never "${NAME} Today"`,
    report: "Gate-Sunny's probe (12 Nov 2026): a time word after the name joined it",
    status: { open: "the card has no employee" },
    fixFlags: FIX,
    async run(t: ReplayContext) {
      const { reply, proposal } = await ask(t, "admin", `Corrective action for Tanning Consultant ${NAME} Today`);
      expect(reply.content, reply.content).not.toMatch(/Wren Tallis Today/i);
      expect(proposal?.employeeName ?? null, reply.content).toBe(NAME);
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
