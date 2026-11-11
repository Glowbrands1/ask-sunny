import { expect, vi } from "vitest";

import { STAFF, type ReplayCase } from "./cases";
import { PEOPLE, S21_T1, TEMPLATE } from "./nov5-pau-sf-s21-s25-cases";

/**
 * ============================================================================
 * A PASTED TEMPLATE FILLS THE OPEN DRAFT'S FIELDS (QA's Sunny round-25 live test, 11 Nov 2026, dpl_E584Q17G)
 * ============================================================================
 *
 * sf-s21's 5b as round 25 ran it, PASTED_OUTLINE_TO_OPEN_DRAFT on: with Wynne's Corrective Action draft open, the
 * manager pasted Tamsyn's CA as a template ("Observation of Offense: … Action Plan: …"). No new card and no "Is this
 * for Tamsyn?" any more, but nothing was saved; the reply was "Nothing on the form has changed yet. I couldn't place
 * that on the open Corrective Action Form…". PASTED_TEMPLATE_FIELDS_TO_OPEN_DRAFT_ENABLED: the template's labelled
 * sections fill the open draft's fields, and the template's person is never a person switch. Every person invented.
 */
const FLAG = "PASTED_TEMPLATE_FIELDS_TO_OPEN_DRAFT_ENABLED";
const LIVE_REPLY = /Nothing on the form has changed yet\.\*?\*? I couldn't place that on the open Corrective Action Form/;

export const NOV11_PASTED_TEMPLATE_FIELDS_CASES: ReplayCase[] = [
  {
    id: "nov11-r25-sf-s21-pasted-template-fills-open-draft",
    title: "sf-s21 5b as round 25 ran it: the pasted Tamsyn template fills Wynne's open draft's Observation and Action Plan, in Wynne's name",
    report: `QA's Sunny round-25 live test (11 Nov 2026): 5b "Nothing on the form has changed yet. I couldn't place that on the open Corrective Action Form…"`,
    status: { open: "the revision writes nothing for the pasted template, so the open draft is unchanged" },
    fixFlags: [FLAG],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-11T03:30:00Z"));
      t.directory([...STAFF, ...PEOPLE]);
      t.as("admin", { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] } as never);
      const thread = t.thread();
      await thread.say(S21_T1);
      expect(thread.proposal, "no CA card for Wynne Sarrow").toMatchObject({ templateKey: "dpoa", employeeName: "Wynne Sarrow" });
      t.draftWrites({ observation: "Observed:\nWynne completed 146 tans, below average in PPTA, LPSVA, Average Club, CC% and Spa%." });
      const id = await thread.create();
      // The live failure: the revision writes nothing for the pasted template (the stand-in writes nothing by default).
      const reply = await thread.say(TEMPLATE);
      expect(reply.formProposal ?? null, `a new card over Wynne's open draft:\n${reply.content}`).toBeNull();
      expect(reply.content, `asked whether the form is for Tamsyn:\n${reply.content}`).not.toMatch(/is this for \**tamsyn/i);
      expect(reply.content, `nothing was saved:\n${reply.content}`).not.toMatch(LIVE_REPLY);
      const saved = t.values(id);
      expect(saved.observation ?? "", "the template's Observation is not on Wynne's draft").toMatch(/Must See Behaviors/);
      expect(saved.action_plan ?? "", "the template's Action Plan is not on Wynne's draft").toMatch(/Must See Behaviors/);
      expect(JSON.stringify(saved), "the template's person is on Wynne's form").not.toMatch(/Tamsyn/);
      expect(saved.employee_name, "the draft's employee changed").toBe("Wynne Sarrow");
    },
  },
];
