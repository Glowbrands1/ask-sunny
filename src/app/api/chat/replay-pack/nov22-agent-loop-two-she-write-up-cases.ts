import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, headingWith, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * TWO PEOPLE WHO ARE BOTH "SHE" ARE NEVER MIXED UP; ANOTHER EMPLOYEE'S "THEY" STAYS IN THE SAVED FORM
 * (port of Ask Bubbles #1053, db7201b1: its QA, 22 Nov 2026, production, and its live round 3, U23; every person invented)
 * ============================================================================
 *
 * Found in Ask Bubbles, the same pronoun pass in Sunny (`reply-pronouns.ts`, on the reply, the card's account and the
 * saved write-up). The manager wrote about <A> (she) and a coworker <B> (she) who was giving <A> an attitude; the write-up
 * said "<A> was giving <A> an attitude". Now a pronoun whose nearest named person of its kind is another person is left as
 * the manager wrote it. Controls: one "she" (still named), and a coworker who is "he" (his "he" stays, her "her" is
 * named). Create's pass now reads the roster people the notes name and the notes themselves, so the saved Observation
 * agrees with the card, and (U23) keeps another employee's "they" when the manager calls the person only "she".
 */

const REPORT = "Ask Bubbles' QA (22 Nov 2026, production; names invented): two people who are both \"she\" — the write-up said \"<A> was giving <A> an attitude\"";
const FLAG = "AGENT_LOOP_ENABLED";

const SORCHA: DirectoryRow = { id: "e-sorcha-vantassel", firstName: "Sorcha", lastName: "Vantassel", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const PETRONELLA: DirectoryRow = { id: "e-petronella-fenmore", firstName: "Petronella", lastName: "Fenmore", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const IVO: DirectoryRow = { id: "e-ivo-marrack", firstName: "Ivo", lastName: "Marrack", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
/** Legal first name Elspeth, preferred Billie. */
const BILLIE: DirectoryRow = { id: "e-elspeth-dunleavy", firstName: "Elspeth", lastName: "Dunleavy", preferredFirstName: "Billie", employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };

interface Story {
  readonly personId: string;
  readonly person: string;
  readonly request: string;
  /** The account the loop's model writes on the card (its own paraphrase, pronouns as the manager used them). */
  readonly account: string;
}

/** One turn: the card is proposed with the story's account; then Create (the drafter writes the same account). */
async function tell(t: ReplayContext, story: Story): Promise<{ reply: string; issue: string; saved: string }> {
  vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
  t.directory([...STAFF, SORCHA, PETRONELLA, IVO, BILLIE]);
  t.as("salon_director", KEARNEY);
  t.loopModel!(loopStandIn((view): LoopDecision => {
    const proposed = lastResult(view, "propose_form") as { card?: { observation?: string | null } } | null;
    if (proposed?.card) return { text: `Here's the Corrective Action Form for **${story.person.split(" ")[0]}**.\n\n**Observation of Offense:** ${proposed.card.observation ?? ""}` };
    return { tool: "propose_form", input: { template_key: "dpoa", employee_id: story.personId, person_evidence: evidenceFrom(view, story.person), what_happened: story.account, incident_date: "2026-11-21", policy: headingWith(view, /standards of conduct/i) } };
  }));
  const thread = t.thread();
  const answer = await thread.say(story.request);
  const issue = String((thread.proposal as { issue?: string } | null)?.issue ?? "");
  t.draftWrites({ observation: `Observed:\n${story.account}\n\nExpectation:\n${story.person.split(" ")[0]} is expected to treat coworkers with respect.` });
  const id = await thread.create();
  return { reply: answer.content, issue, saved: t.values(id).observation ?? "" };
}

const TWO_SHE: Story = {
  personId: SORCHA.id,
  person: "Sorcha Vantassel",
  request: "ca for Sorcha Vantassel, she got into it with her coworker Petronella Fenmore on the front desk last night. she was giving her an attitude and Sorcha cussed at her in front of guests",
  account: "Sorcha got into it with her coworker Petronella Fenmore on the front desk on 11/21/26. She was giving her an attitude, and Sorcha cussed at her in front of guests.",
};

const ONE_SHE: Story = {
  personId: SORCHA.id,
  person: "Sorcha Vantassel",
  request: "ca for Sorcha Vantassel, she was rude to a guest on the front desk last night. she rolled her eyes at the guest and walked off",
  account: "Sorcha was rude to a guest on the front desk on 11/21/26. She rolled her eyes at the guest and walked off.",
};

const HE: Story = {
  personId: SORCHA.id,
  person: "Sorcha Vantassel",
  request: "ca for Sorcha Vantassel, she got into it with her coworker Ivo Marrack on the front desk last night. he was giving her an attitude and Sorcha cussed at him in front of guests",
  account: "Sorcha got into it with her coworker Ivo Marrack on the front desk on 11/21/26. He was giving her an attitude, and Sorcha cussed at him in front of guests.",
};

const PREFERRED: Story = {
  personId: BILLIE.id,
  person: "Billie Dunleavy",
  request: "ca for Billie Dunleavy, she got into it with her coworker Petronella Fenmore on the front desk last night. she was giving her an attitude and Billie cussed at her in front of guests",
  account: "Billie got into it with her coworker Petronella Fenmore on the front desk on 11/21/26. She was giving her an attitude, and Billie cussed at her in front of guests.",
};

/* U23 round 3 (Ask Bubbles' live re-run): Sunny's U23 chat, the tester's T5 verbatim (the pack's invented Juno Paxton). */
const U23_T1 = "i need to create a corrective action for Juno Paxton";
const U23_T5 = "Multiple times she has talked about her boyfriend or ex boyfriend with customers, she has stated that she takes medication for different things to customers, even stating that she was sick. Today, while checking out a customer, she asked another employee what they would do if they had 8 arms and 8 legs. I could tell the customer was very uncomfortable.";

const all = (out: { reply: string; issue: string; saved: string }) => `REPLY:\n${out.reply}\n\nCARD:\n${out.issue}\n\nSAVED:\n${out.saved}`;

const loopCase = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
    await run(t);
  },
});

export const NOV22_AGENT_LOOP_TWO_SHE_WRITE_UP_CASES: ReplayCase[] = [
  loopCase("nov22-two-she-coworkers-attitude-not-mixed-up", "Two \"she\": \"she was giving her an attitude\" (the coworker Petronella) never becomes \"Sorcha was giving Sorcha an attitude\" in the reply, the card or the saved Observation", async (t) => {
    const out = await tell(t, TWO_SHE);
    for (const text of [out.reply, out.issue, out.saved]) {
      expect(text, all(out)).not.toMatch(/Sorcha was giving/);
      expect(text, all(out)).not.toMatch(/Sorcha cussed at Sorcha/);
    }
    expect(out.saved, all(out)).toMatch(/Petronella/);
  }),
  loopCase("nov22-two-she-control-one-she-still-named", "Control, one \"she\": \"She rolled her eyes at the guest\" is still written with the employee's name in the reply, the card and the saved Observation", async (t) => {
    const out = await tell(t, ONE_SHE);
    for (const text of [out.reply, out.issue]) {
      expect(text, all(out)).toMatch(/Sorcha rolled/);
      expect(text, all(out)).not.toMatch(/\b[Ss]he\b/);
    }
    expect(out.saved, all(out)).not.toMatch(/\b[Ss]he rolled\b/);
  }),
  loopCase("nov22-two-she-control-coworker-is-he", "Control, the coworker is \"he\": \"He was giving her an attitude\" keeps his \"he\" and \"him\" (never Sorcha) and names her", async (t) => {
    const out = await tell(t, HE);
    for (const text of [out.reply, out.issue, out.saved]) {
      expect(text, all(out)).not.toMatch(/Sorcha was giving/);
      expect(text, all(out)).not.toMatch(/cussed at Sorcha/);
      expect(text, all(out)).toMatch(/(?:He|Ivo) was giving Sorcha an attitude/);
    }
  }),
  loopCase("nov22-two-she-preferred-name-never-legal", "Two \"she\" with legal Elspeth / preferred Billie: the coworker's \"she\" is never Billie, and the saved Observation never says Elspeth", async (t) => {
    const out = await tell(t, PREFERRED);
    for (const text of [out.reply, out.issue, out.saved]) expect(text, all(out)).not.toMatch(/Billie was giving|Elspeth was giving/);
    expect(out.saved, all(out)).not.toMatch(/\bElspeth\b/);
    expect(out.saved, all(out)).toMatch(/\bBillie\b/);
  }),
  loopCase("nov22-u23-saved-observation-keeps-they", "U23 round 3: \"… she asked another employee what they would do if they had 8 arms and 8 legs …\": Create's saved Observation keeps the other employee's \"they\", as the card does; never \"what Juno would do\"", async (t) => {
    vi.setSystemTime(new Date("2026-11-21T18:00:00Z"));
    t.directory([...STAFF]);
    t.as("salon_director", KEARNEY);
    t.loopModel!(loopStandIn((view): LoopDecision => {
      if (lastResult(view, "propose_form")) return { text: "Here's the Corrective Action Form for **Juno**." };
      return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-3", what_happened: "Today, while checking out a customer, she asked another employee what they would do if they had 8 arms and 8 legs.", incident_date: "2026-11-21", policy: headingWith(view, /standards of conduct/i), person_evidence: evidenceFrom(view, "Juno Paxton", 1) } };
    }));
    const thread = t.thread();
    await thread.say(U23_T1);
    await thread.say(U23_T5);
    const issue = String((thread.proposal as { issue?: string } | null)?.issue ?? "");
    expect(issue, issue).toMatch(/what they would do if they had 8 arms/);
    /* Create: the drafter writes the account as the live one did, the other employee's "they" kept, the person by name. */
    t.draftWrites({ observation: "Observed:\nOn multiple occasions, Juno talked with customers about her boyfriend or ex-boyfriend. On November 21, 2026, while checking out a customer, Juno asked another employee what they would do if they had 8 arms and 8 legs, and the customer appeared very uncomfortable.\n\nExpectation:\nJuno is expected to keep conversations with guests professional." });
    const id = await thread.create();
    const observation = t.values(id).observation ?? "";
    expect(observation, `the saved Observation made the other employee's "they" the card's person:\n${observation}`).not.toMatch(/what Juno would do|if Juno had 8 arms/);
    expect(observation, observation).toMatch(/what they would do if they had 8 arms/);
  }),
];
