import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * A POLICY NAMED ONLY IN THE APP'S "ON FILE" LISTING IS NEVER THE REQUEST'S POLICY (ON_FILE_LINE_NOT_THE_POLICY_ENABLED)
 * ============================================================================
 *
 * Pau's morning scan (Ask Sunny production, 13 Nov 2026, 22:40-22:45Z), via QA, the manager's words with an invented
 * name: t1 out of dresscode, t2 a black crewneck not a zip up jacket, t3 the same text again, t4 not in dresscode. Every
 * reply listed her forms on file, one of them "Verbal corrective action (Tardiness/Leaving Early — Late Opening)". t3 was
 * carded "Policy: Late Opening — read from this request": the intent reader reads the whole chat, the app's replies
 * included, and with no policy in the manager's words it took the heading the listing named; the app wrote it onto the
 * turn ("Policy reference: Late Opening …") and the card read it as the request's. On: a heading only the app's "On file"
 * listing names is dropped and the request keeps the heading it had (`ai/on-file-heading.ts`).
 *
 * WHAT THIS REPLAY SHOWS, AND DOES NOT: the intent reader's headings are scripted (`slotsRead`), as live read them; the
 * harness reads no prior forms for this card, so the live "On file" line is put on each reply in the chat. The Dress
 * Code card lines of t1/t2/t4 come from the live reader and manual and are not replayed: the invariant is that no card
 * names Late Opening and the resent request says what it said the first time.
 */

const PERSON: DirectoryRow = { id: "e-briony-calloway", firstName: "Briony", lastName: "Calloway", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const T1 = "Please create a CA written warning for Briony Calloway for being out of dresscode on 11/13. Briony Calloway wore her coat during Briony Calloways shift after previosly being asked to take it off multiple times.";
const T2 = "Write me a CA form for Briony Calloway having a black crewneck on during her shift, not a zip up jacket on 11/13 and 11/6";
/** Gate-Sunny-3's wordings (14 Nov 2026), invented name: a repeat offender's real late opening, named or described. */
const REPEAT_OFFENDER: readonly (readonly [string, string])[] = [
  ["ok-ca", "ok CA for Briony Calloway, she opened the salon 25 minutes late on 11/12"],
  ["make-it-about", "make it about her opening the salon 15 minutes late on 11/13 instead"],
  ["separate-ca", "separate CA for Briony Calloway: she opened the salon 25 minutes late on 11/12"],
  ["typo", "change it to late openng"],
];
const T4 = "CA for Briony Calloway  not being in dresscode on 11/13 and 11/6";

async function lateOpeningOnFile(t: ReplayContext) {
  const thread = t.thread();
  await thread.say("create a verbal ca for Briony Calloway for late opening on 10/26/26, she opened the salon 20 minutes late");
  t.draftWrites({ observation: "Observed:\nBriony Calloway opened the salon 20 minutes late on 10/26/26." }, { warning_type: ["verbal"], offense_type: ["tardiness"] });
  const id = await thread.create();
  const row = t.forms().find((entry) => entry.id === id)!;
  Object.assign(row, { status: "finalized", form_date: "2026-10-26" });
}

const ON_FILE = "**On file in Form Monitoring for Briony Calloway:** Verbal corrective action (Tardiness/Leaving Early — Late Opening) — finalized 10/26/2026; Verbal corrective action (Attendance Policy, JBA Policy Manual p.14) — finalized 11/02/2026. I'll list them under prior coaching and corrective action on the form — remove any that shouldn't count.";

const REPORT = "Pau's morning scan (Ask Sunny production, 13 Nov 2026 22:40-22:45Z), via QA: a dress-code CA request sent again word for word was carded \"Policy: Late Opening — read from this request\"";
const FLAG = "ON_FILE_LINE_NOT_THE_POLICY_ENABLED";

const policyLine = (content: string) => content.split("\n").find((line) => line.startsWith("**Policy:**")) ?? "(no Policy line)";

async function chat(t: ReplayContext): Promise<string[]> {
  vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
  t.directory([...STAFF, PERSON]);
  t.as("salon_director", KEARNEY);
  await lateOpeningOnFile(t);
  const thread = t.thread();
  // The intent reader as live: its heading on t3 is the one the app's "On file" listing names (it reads the whole chat).
  const heads = ["Dress Code for The Company", "Dress Code for The Company", "Late Opening", null];
  const lines: string[] = [];
  for (const [i, turn] of [T1, T2, T2, T4].entries()) {
    if (heads[i]) t.slotsRead({ employee: "Briony Calloway", formType: "Corrective Action Form", formTurn: true, policyHeading: heads[i] });
    const reply = await thread.say(turn);
    lines.push(policyLine(reply.content));
    // Live, every reply listed her forms on file; the harness reads no prior forms for this card, so the live line is put on.
    const last = [...((thread.conversation ?? []) as unknown as { role: string; content: string }[])].reverse().find((m) => m.role === "assistant");
    if (last) last.content = `${last.content}\n\n${ON_FILE}`;
  }
  return lines;
}

export const NOV14_ON_FILE_LINE_NOT_THE_POLICY_CASES: ReplayCase[] = [
  {
    id: "nov14-on-file-line-not-the-policy-dress-code-resent",
    title: `Pau's dress-code chat ("${T2}" sent twice, every reply listing a Late Opening CA on file): no card names Late Opening, and the resent request keeps its policy`,
    report: REPORT,
    status: { open: "the resent request is carded \"Policy: Late Opening — read from this request\", from the app's own On file listing" },
    fixFlags: [FLAG],
    async run(t) {
      const lines = await chat(t);
      lines.forEach((line, i) => expect(line, `t${i + 1} names the policy from the On file listing: ${line}`).not.toMatch(/late opening/i));
      expect(lines[2], "the resent request changed its policy").toBe(lines[1]);
    },
  },
  ...REPEAT_OFFENDER.map(([key, said]): ReplayCase => ({
    id: `nov14-on-file-line-not-the-policy-late-opening-kept-${key}`,
    title: `a real late opening the manager describes ("${said}"), with Late Opening on file: the card keeps its Late Opening line`,
    report: `${REPORT}; negative (Gate-Sunny-3, 14 Nov 2026: a repeat offender's described late opening lost its Policy line)`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-13T22:40:00Z"));
      t.directory([...STAFF, PERSON]);
      t.as("salon_director", KEARNEY);
      await lateOpeningOnFile(t);
      const thread = t.thread();
      t.slotsRead({ employee: "Briony Calloway", formType: "Corrective Action Form", formTurn: true, policyHeading: "Dress Code for The Company" });
      await thread.say(T1);
      const last = [...((thread.conversation ?? []) as unknown as { role: string; content: string }[])].reverse().find((m) => m.role === "assistant");
      if (last) last.content = `${last.content}\n\n${ON_FILE}`;
      t.slotsRead({ employee: "Briony Calloway", formType: "Corrective Action Form", formTurn: true, policyHeading: "Late Opening" });
      const reply = await thread.say(said);
      expect(policyLine(reply.content), `the described late opening lost its Policy line:\n${reply.content}`).toMatch(/late opening/i);
    },
  })),
];
