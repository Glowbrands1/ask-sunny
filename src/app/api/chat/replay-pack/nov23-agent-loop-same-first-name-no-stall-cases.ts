import { expect, vi } from "vitest";

import { STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * TWO STAFF SHARE A FIRST NAME: THE WHICH-ONE QUESTION NEVER STALLS (port of Ask Bubbles #1081, its tester's A9)
 * ============================================================================
 *
 * Found in Ask Bubbles, the same loop in Sunny. An admin asked "Create a coaching form." then gave a first name two active
 * staff share (at two locations). The which-one question was right, but the manager answered "yes", went on with the
 * account, "yes, do that": the question came back again and again, in full each time, and no card. Its QA's ruling (b):
 * the account is held; the card is built the moment the person is named, by full name, surname or salon (one of the people
 * offered, read from the server's record of the question, never a word list); a question asked again is short. The turns
 * keep the tester's shape; the people (two "Lorcana"s) and the account are invented, in Sunny's own work (towels).
 */

const REPORT = "Ask Bubbles' A9 (round 1, admin/global): two staff share a first name; the which-one question came back again and again and no card was built";
const TAMBERLIN: DirectoryRow = { id: "e-lorcana-tamberlin", firstName: "Lorcana", lastName: "Tamberlin", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const DELACROIXE: DirectoryRow = { id: "e-lorcana-delacroixe", firstName: "Lorcana", lastName: "Delacroixe", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0311"], positionName: "Tanning Consultant" };
const ADMIN = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };
const ACCOUNT = "lorcana left the towels unwashed overnight and the morning shift ran out";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

type Found = { matches?: Array<{ employee_id?: string }>; reason_code?: string; ask_exactly?: string; asked_before?: boolean; confirmed_by_manager?: unknown };
const users = (view: LoopView) => view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0).length;
const said = (view: LoopView) => view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0).at(-1)?.text ?? "";

/** The manager's account turn, quoted as the model would (its message id and its opening words). */
function accountEvidence(view: LoopView): { request_evidence?: Array<{ message_id: string; quote: string }> } {
  const turn = view.turns.find((entry) => entry.role === "user" && entry.text === ACCOUNT);
  const id = turn?.messageIds?.at(-1);
  return id ? { request_evidence: [{ message_id: id, quote: "lorcana left the towels unwashed overnight" }] } : {};
}

/**
 * The model as the rules book has it: after "Create a coaching form." it asks who; then each turn it looks the person up
 * with the name the manager gave (the first name, or the surname they answer with), says find_staff's question when there
 * is one, and proposes the card with the account the moment find_staff settles one person.
 */
function model(lookupName: (view: LoopView) => string) {
  return loopStandIn((view): LoopDecision => {
    if (users(view) === 1) return { text: "Who is this Coaching Form for?" };
    if (lastResult(view, "propose_form")) return { text: "Here's the Coaching Form." };
    const found = lastResult(view, "find_staff") as Found | null;
    if (!found) return { tool: "find_staff", input: { name: lookupName(view), person_evidence: evidenceFrom(view) } };
    const one = found.matches?.length === 1 ? found.matches[0]!.employee_id : null;
    if (one) return { tool: "propose_form", input: { template_key: "coaching", employee_id: one, person_evidence: evidenceFrom(view), what_happened: "Lorcana left the towels unwashed overnight and the morning shift ran out.", ...accountEvidence(view) } };
    return { text: found.ask_exactly ?? "Which Lorcana is this for?" };
  });
}

async function chat(t: ReplayContext, turns: readonly string[], lookupName: (view: LoopView) => string) {
  vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
  t.directory([...STAFF, TAMBERLIN, DELACROIXE]);
  t.as("admin", ADMIN);
  const standIn = model(lookupName);
  t.loopModel!(standIn);
  const thread = t.thread();
  const replies: string[] = [];
  for (const turn of turns) replies.push((await thread.say(turn)).content);
  const lookups = standIn.views.flatMap((view) => view.results.filter((result) => result.tool === "find_staff").map((result) => ({ turn: users(view), out: result.output as Found })));
  return { thread, replies, lookups };
}

const fixed = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: ["AGENT_LOOP_ENABLED"],
  async run(t) {
    if (!t.loopOn?.() || !offline) return;
    await run(t);
  },
});

export const NOV23_AGENT_LOOP_SAME_FIRST_NAME_NO_STALL_CASES: ReplayCase[] = [
  fixed("nov23-same-first-name-answer-by-surname-builds-card", "A9: \"Lorcana\" (two Lorcanas), the account, then \"Delacroixe\": the card is built for Lorcana Delacroixe at once, with the account held from the earlier turn", async (t) => {
    const { thread, lookups } = await chat(t, ["Create a coaching form.", "Lorcana", ACCOUNT, "Delacroixe"], (view) => (said(view) === "Delacroixe" ? "Delacroixe" : "Lorcana"));
    expect(lookups.find((lookup) => lookup.turn === 2)?.out.reason_code, "the first lookup did not ask which (the case proves nothing)").toBe("ambiguous_person");
    expect(thread.proposal?.employeeName, `no card for Lorcana Delacroixe after "Delacroixe":\n${JSON.stringify(lookups.at(-1)?.out)}`).toBe("Lorcana Delacroixe");
    expect(String((thread.proposal as { issue?: string } | null)?.issue ?? ""), "the account from the earlier turn is not on the card").toMatch(/towels/);
  }),
  fixed("nov23-same-first-name-answer-by-salon-builds-card", "A9: \"Lorcana\" (two Lorcanas, at Kearney and Lincoln O Street), the account, then \"the o street one\": the card is built for Lorcana Delacroixe", async (t) => {
    const { thread, lookups } = await chat(t, ["Create a coaching form.", "Lorcana", ACCOUNT, "the o street one"], () => "Lorcana");
    expect(thread.proposal?.employeeName, `no card for Lorcana Delacroixe after "the o street one":\n${JSON.stringify(lookups.at(-1)?.out)}`).toBe("Lorcana Delacroixe");
  }),
  fixed("nov23-same-first-name-ignored-question-short-not-guessed", "Control, A9's turns: \"yes\", the account and \"yes, do that\" name nobody: no card and no guess; each turn asks, both people offered, and a question asked again is short", async (t) => {
    const { thread, lookups } = await chat(t, ["Create a coaching form.", "Lorcana", "yes", ACCOUNT, "yes, do that"], () => "Lorcana");
    expect(thread.proposal ?? null, "a card was built for a person the manager never named").toBeNull();
    const asks = lookups.map((lookup) => lookup.out);
    expect(asks.every((out) => out.reason_code === "ambiguous_person"), JSON.stringify(asks)).toBe(true);
    const first = asks[0]!.ask_exactly ?? "";
    const later = asks.at(-1)!;
    expect(first, "the first question does not offer both people").toMatch(/Tamberlin[\s\S]*Delacroixe|Delacroixe[\s\S]*Tamberlin/);
    expect(later.asked_before, "a question asked again is not marked as asked before").toBe(true);
    expect(later.ask_exactly ?? "", "the repeat does not offer both people").toMatch(/Tamberlin[\s\S]*Delacroixe|Delacroixe[\s\S]*Tamberlin/);
    expect((later.ask_exactly ?? "").length, `the repeat is not shorter:\n${first}\n${later.ask_exactly}`).toBeLessThan(first.length);
  }),
];
