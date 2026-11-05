import { expect, vi } from "vitest";
import { endsAsSentence, KEARNEY, STAFF, type ReplayCase } from "./cases";

/*
 * REPLY_CUT_CHECK_ENABLED never blocks a different or second form asked for
 * while a card is open (QA's condition, 5 Nov 2026): the check removes only
 * the form picker and its heading, and these requests come as a new card.
 * Each case runs with the flag off and on; both must hold. The live-ending
 * case is `sf-b6-reply-live-ending`. The people are the pack's invented staff.
 */
const REPORT = "QA for Pau, 5 Nov 2026: replies that ended \"Based on what you've described, I can prepare:\"";
const [A, B] = [STAFF[0]!, STAFF[1]!];
const nameOf = (row: { firstName: string; lastName: string }) => `${row.firstName} ${row.lastName}`;
const REQUEST = `create a corrective action for ${nameOf(A)} for opening the salon late on 11-03-26, verbal warning, no payroll deduction`;

function start(t: Parameters<ReplayCase["run"]>[0]) {
  vi.setSystemTime(new Date("2026-11-05T15:30:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

const SECOND_FORMS: readonly { key: string; said: (a: string, b: string) => string }[] = [
  { key: "other-person", said: (_a, b) => `also make a coaching form for ${b}` },
  { key: "same-person", said: (a) => `also make a coaching form for ${a}` },
  { key: "instead", said: () => "actually make it a coaching form instead" },
];

export const NOV5_REPLY_CUT_CASES: readonly ReplayCase[] = [
  ...SECOND_FORMS.flatMap(({ key, said }) =>
    (["card", "created"] as const).map(
      (mode): ReplayCase => ({
        id: `nov5-reply-cut-second-form-${key}-${mode}`,
        title: `a second form asked for with a Corrective Action ${mode === "card" ? "card in progress" : "draft created"} ("${said("<A>", "<B>")}"): the Coaching Form card still comes`,
        report: REPORT,
        status: "fixed",
        fixFlags: ["REPLY_CUT_CHECK_ENABLED"],
        async run(t) {
          const thread = start(t);
          await thread.say(REQUEST);
          if (mode === "created") {
            t.draftWrites({});
            await thread.create();
          }
          const text = said(nameOf(A), nameOf(B));
          const reply = await thread.say(text);
          expect(reply.formProposal?.templateKey, `"${text}": no Coaching Form card\n${reply.content}`).toBe("coaching");
          endsAsSentence(reply, text);
        },
      }),
    ),
  ),
];
