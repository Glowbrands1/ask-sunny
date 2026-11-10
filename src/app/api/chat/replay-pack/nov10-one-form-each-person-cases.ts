import { expect } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * "A COACHING FORM FOR <A>, <B>, AND <C>" — WHICH <A> IS ASKED, THEN ONE FORM EACH, EACH NAMED (QA's P7, Sunny live on the
 * 13b chat code, 10 Nov 2026; ONE_FORM_EACH_PERSON, DID_YOU_MEAN_STAYS_ASKED, CARD_NAMES_EMPLOYEE,
 * OBSERVATION_OWN_PERSON_ONLY)
 * ============================================================================
 *
 * "Make me a coaching form for <A>, <B>, and <C> for not closing duties correctly" (<A> a first name two people share)
 * → "Did you mean <A> <s1> or <A> <s2>?" → "create draft for failure to do closing duties and staying over hours" gave
 * ONE card, for one of the two <A>s unasked, its Observation "<B>, and <C> for … create draft for …", its reply "I have
 * the employee". QA's decisions: one form each (ask which <A> first, then offer <B>'s and <C>'s); the unanswered question
 * is asked again; the reply names the employee. The people are invented.
 */
const row = (id: string, firstName: string, lastName: string): DirectoryRow => ({ id, firstName, lastName, preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" });
const PEOPLE = [row("p7-tamsin-rookwood", "Tamsin", "Rookwood"), row("p7-tamsin-ashby", "Tamsin", "Ashby"), row("p7-corwin-halsey", "Corwin", "Halsey"), row("p7-ione-marchetti", "Ione", "Marchetti")];
const T1 = "Make me a coaching form for Tamsin, Corwin, and Ione for not closing duties correctly";
const T2 = "create draft for failure to do closing duties and staying over hours";
const FIX = ["ONE_FORM_EACH_PERSON_ENABLED", "DID_YOU_MEAN_STAYS_ASKED_ENABLED", "CARD_NAMES_EMPLOYEE_ENABLED", "OBSERVATION_OWN_PERSON_ONLY_ENABLED"];
const REPORT = "QA's P7, Sunny live (10 Nov 2026): three people asked for, one card for one of the two <A>s unasked";
const ASKS_WHICH_TAMSIN = /Did you mean \*\*Tamsin (?:Rookwood|Ashby)\*\* or \*\*Tamsin (?:Rookwood|Ashby)\*\*\?/;

function start(t: ReplayContext) {
  t.directory([...STAFF, ...PEOPLE]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

function observationOf(content: string): string {
  return /\*\*Observation of Offense:\*\*\s*(.+)/.exec(content)?.[1] ?? "";
}

export const NOV10_ONE_FORM_EACH_PERSON_CASES: ReplayCase[] = [
  {
    id: "nov10-p7-unanswered-which-tamsin-asked-again",
    title: "QA's two turns: \"Did you mean …?\" is asked again (no card for either Tamsin), and Corwin's and Ione's forms are queued",
    report: REPORT,
    status: { open: "a card for Tamsin Rookwood, asked about but never chosen" },
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      const first = await thread.say(T1);
      expect(first.content, `which Tamsin is not asked:\n${first.content}`).toMatch(ASKS_WHICH_TAMSIN);
      const reply = await thread.say(T2);
      expect(thread.proposal?.employeeName ?? null, `a card for one of the two Tamsins, never chosen:\n${reply.content}`).toBeNull();
      expect(reply.content, `which Tamsin is not asked again:\n${reply.content}`).toMatch(ASKS_WHICH_TAMSIN);
      expect(reply.content, `Corwin's and Ione's forms are not queued:\n${reply.content}`).toMatch(/\*\*Next:\*\* a Coaching Form each for \*\*Corwin Halsey\*\* and \*\*Ione Marchetti\*\*/);
    },
  },
  {
    id: "nov10-p7-one-form-each-named",
    title: "T1 → \"Tamsin Ashby\" → \"yes\" → \"yes\": one Coaching card each for Tamsin Ashby, Corwin Halsey and Ione Marchetti, each reply naming them, each Observation only the reason",
    report: REPORT,
    status: { open: "one card, for one person; the other two never handled" },
    fixFlags: FIX,
    async run(t) {
      const thread = start(t);
      await thread.say(T1);
      for (const [said, person, next] of [
        ["Tamsin Ashby", "Tamsin Ashby", "Corwin Halsey"],
        ["yes", "Corwin Halsey", "Ione Marchetti"],
        ["yes", "Ione Marchetti", null],
      ] as const) {
        const reply = await thread.say(said);
        expect(thread.proposal, `"${said}": no Coaching card for ${person}:\n${reply.content}`).toMatchObject({ templateKey: "coaching", employeeName: person });
        expect(reply.content, `"${said}": the reply does not name ${person}:\n${reply.content}`).toMatch(new RegExp(`I have \\*\\*${person}\\*\\*`));
        expect(reply.content, `"${said}": "I have the employee":\n${reply.content}`).not.toMatch(/I have the employee\b/);
        const observation = observationOf(reply.content);
        expect(observation, `"${said}": the Observation names someone else or the command:\n${reply.content}`).not.toMatch(/Tamsin|Corwin|Ione|create draft/i);
        expect(observation, `"${said}": the Observation lost the reason:\n${reply.content}`).toMatch(/not closing duties correctly/i);
        if (next) expect(reply.content, `"${said}": ${next} is not offered next:\n${reply.content}`).toMatch(new RegExp(`\\*\\*Next:\\*\\* a Coaching Form each for \\*\\*${next}\\*\\*`));
        else expect(reply.content, `"${said}": a Next line after the last person:\n${reply.content}`).not.toMatch(/\*\*Next:\*\*/);
      }
    },
  },
  {
    id: "nov10-p7-extra-yes-after-the-chain",
    title: "after the chain is done (Ione's card, no Next line), one more bare \"yes\" never makes a card for a person nobody chose",
    report: `${REPORT}; QA, 10 Nov 2026: the extra "yes" recorded so it does not fall off the list`,
    // OPEN, recorded on purpose (QA, 10 Nov 2026), not fixed in this PR: with nothing on offer, a bare "yes" is read
    // against the whole chat, and the card is for Tamsin Rookwood — the Tamsin the manager did not choose. The P7 flags
    // are turned on inside the case, so it fails the same way with production's flags and has no fix flags yet.
    status: { open: "a card for Tamsin Rookwood, never chosen" },
    async run(t) {
      // The flags are set for this case only and put back as they were, so no other case runs with them.
      const saved = FIX.map((flag) => [flag, process.env[flag]] as const);
      for (const flag of FIX) process.env[flag] = "true";
      try {
        const thread = start(t);
        for (const said of [T1, "Tamsin Ashby", "yes", "yes"]) await thread.say(said);
        expect(thread.proposal?.employeeName ?? null, "the chain did not end on Ione's card").toBe("Ione Marchetti");
        const reply = await thread.say("yes");
        expect(thread.proposal?.employeeName ?? null, `a card for a person nobody chose:\n${reply.content}`).not.toBe("Tamsin Rookwood");
      } finally {
        for (const [flag, value] of saved) {
          if (value === undefined) delete process.env[flag];
          else process.env[flag] = value;
        }
      }
    },
  },
];
