import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * A CARD TURN ALWAYS ANSWERS THE MANAGER (October rebuild 6, #240, 10 Nov 2026)
 * ============================================================================
 *
 * conv_mvoenhk42lu3cxo (25 Oct 2026; #240, never merged): on a CA card, "i verified everythign i jsut need to
 * finalize it", "i need to edit this can you make it to where i can edit", "can you make the form the same way again"
 * and "Create a Corrective Action Form from this conversation." each got the previous card reply word for word. QA's
 * October triage (docs/parity-log/oct-pr-triage.md, 10 Nov 2026) and main ccfbe214 with production's flags: the last
 * two still repeat the reply; the first two are now appended to the card's Observation of Offense instead of
 * answered. The manager's words; the employee is the pack's Rowan Kestrel.
 */
const FLAG = "CARD_NEVER_SILENT_ENABLED";
const REPORT = "conv_mvoenhk42lu3cxo (25 Oct 2026, #240; the October triage, 10 Nov 2026)";
const WIRING = "CARD_NEVER_SILENT's reply step is wired in server-ask.ts by its sole writer (coding 2); until then a repeated reply stays as it is";
const REQUEST = "create a ca for rowan kestrel, she was late on 10-20-26";

const observation = (content: string) => /\*\*Observation of Offense:\*\*\s*([^\n]*)/.exec(content)?.[1]?.trim() ?? "";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-10-25T15:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

const TURNS = [
  { key: "finalize", text: "i verified everythign i jsut need to finalize it", answer: /create draft/i },
  { key: "edit", text: "i need to edit this can you make it to where i can edit", answer: /edit/i },
  { key: "same-way", text: "can you make the form the same way again", answer: null },
  { key: "create-from-conversation", text: "Create a Corrective Action Form from this conversation.", answer: /create draft/i },
] as const;

export const NOV10_CARD_NEVER_SILENT_CASES: ReplayCase[] = TURNS.map((turn) => ({
  id: `nov10-card-never-silent-${turn.key}`,
  title: `on a CA card, "${turn.text}" is answered — never the previous card reply word for word, never added to the Observation`,
  report: `${REPORT}: "${turn.text}"`,
  status: { open: "the turn gets the previous card reply word for word, or is added to the card's Observation of Offense" },
  fixFlags: [FLAG],
  fixStatus: { open: WIRING },
  async run(t: ReplayContext) {
    const thread = start(t);
    const card = await thread.say(REQUEST);
    const reply = await thread.say(turn.text);
    expect(observation(reply.content), `"${turn.text}" was added to the Observation`).not.toMatch(/verified|need to (?:finali[sz]e|edit)|make it to where/i);
    expect(reply.content, "the previous card reply came back word for word").not.toBe(card.content);
    if (turn.answer) expect(reply.content.split("\n")[0], `the turn is not answered:\n${reply.content}`).toMatch(turn.answer);
  },
}));
