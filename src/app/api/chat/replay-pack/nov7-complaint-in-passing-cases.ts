import { expect } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * A CUSTOMER COMPLAINT IS THE ACCOUNT, NOT THE DATE LINE BEFORE IT (port of the sibling app's audit find, QA, 7 Nov 2026)
 * ============================================================================
 *
 * In the sibling app, "create a ca form for <name>", then "verbal warning The date she complained was Oct 31st . The
 * customer said she was giving her an attitude … very rude to her … no payroll deduct." made the card's Issue "verbal
 * warning The date she complained was Oct 31st" (QA's audit; a real manager's chat there, 3 Nov 2026). Here the
 * Observation of Offense keeps the complaint, but opens with the warning level: "verbal warning The date she
 * complained was Oct 31st. The customer said …". The warning level is the form's Type of Warning, never the account.
 * The manager's words; the people are invented (STAFF's Marnie Holloway; the district manager "Ottoline Brackett", on
 * neither directory).
 */
const SAID =
  "verbal warning The date she complained was Oct 31st . The customer said she was giving her an attitude when she brought up that the register was charging for scent in her lotion refills and it has never done that before. When Marnie spoke with District manager Ottoline Brackett on the phone about how to fix this, Marnie told the customer that she was making her job really hard. The customer reached out to district manager Ottoline Brackett saying Marnie was very rude to her and Marnie told her she knows how to do her job she has worked here for two years. no payroll deduct.";

const line = (content: string, label: string) => new RegExp(String.raw`\*\*${label}:\*\*[^\n·]*`).exec(content)?.[0] ?? "";

export const NOV7_COMPLAINT_IN_PASSING_CASES: ReplayCase[] = [
  {
    id: "nov7-complaint-in-passing-account",
    title: "\"create a ca form for <name>\", then \"verbal warning The date she complained was Oct 31st . The customer said …\": the card's account is what the customer said happened, not the date line",
    report: "QA's audit (7 Nov 2026), the sibling app's real manager chat: \"Complaint mentioned in passing not used as the account\"",
    status: { open: "the Observation opens \"verbal warning The date she complained was Oct 31st.\"" },
    fixFlags: ["COMPLAINT_ACCOUNT_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("create a ca form for Marnie Holloway");
      const reply = await thread.say(SAID);
      const account = line(reply.content, "Issue") || line(reply.content, "Observation of Offense");
      expect(account, `no account on the card:\n${reply.content}`).not.toBe("");
      expect(account, `the account is the date line, not the complaint:\n${reply.content}`).toMatch(/attitude|rude|making her job really hard/i);
      expect(account, `the account opens with the warning level:\n${reply.content}`).not.toMatch(/\*\*(?:Issue|Observation of Offense):\*\*\s*verbal warning/i);
    },
  },
];
