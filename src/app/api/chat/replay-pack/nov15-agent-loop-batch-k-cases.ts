import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * BATCH K: THE 266 SHADOW REPLAY'S GUARD BREACHES (QA, 15 Nov 2026)
 * ============================================================================
 *
 * QA's shadow replay of real manager chats through the agent loop (part 1, 138 conversations with a truth form)
 * found the loop carded the wrong person where today's app asked. The Runner's masked pack gave each conversation's
 * shape; every case here keeps that shape with invented people (Remy Calder is on the roster; "Remi Calder", "Remi" and
 * "Remi Caldor" are close spellings of her that are nobody on it).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const NEAR_MISS = "NEAR_MISS_NEVER_SEATED_ENABLED";
const REPORT = "QA's 266 shadow replay, part 1 (15 Nov 2026), from the Runner's masked pack";

const latest = (view: LoopView) => [...view.turns].reverse().find((turn) => turn.role === "user")?.text ?? "";

type StaffResult = { matches?: { employee_id: string; name: string }[]; did_you_mean?: unknown[]; not_on_roster?: string; note?: string } | null;

/**
 * A stand-in that does what the tool results say: a Did-you-mean (or any "Ask …" note) is asked in the note's own
 * words; one match is carded with the account the manager gave.
 */
function namingModel(name: (said: string) => string, account: string) {
  return loopStandIn((view): LoopDecision => {
    const staff = lastResult(view, "find_staff") as StaffResult;
    if (!staff) return { tool: "find_staff", input: { name: name(latest(view)) } };
    const asked = /Ask the manager, in these words: ([\s\S]+)$/.exec(staff.note ?? "")?.[1];
    if (asked) return { text: asked };
    const person = staff.matches?.[0];
    if (!person) return { text: "Who is this Coaching Form for?" };
    if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "coaching", employee_id: person.employee_id, what_happened: account } };
    return { text: `Here's the Coaching Form for **${person.name}**.\n\nUsing **${person.name}** from your staff list.` };
  });
}

async function salon(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

export const NOV15_AGENT_LOOP_BATCH_K_CASES: ReplayCase[] = [
  ...([
    ["c119", "create a coaching document for Remi Calder", "Remi Calder"],
    ["c137", "put together a coaching document for Remi", "Remi"],
  ] as const).map(([tag, words, typed]): ReplayCase => ({
    id: `nov15-k1-near-miss-is-asked-${tag}`,
    title: `K1 (QA's shadow replay, ${tag}'s shape): "${words}", where "${typed}" is nobody on the roster but spells close to Remy Calder, gets today's Did-you-mean (with keeping the name as typed), never a card for Remy Calder`,
    report: `${REPORT}: ${tag}, an off-roster person carded as a roster person who only spelled close`,
    status: { open: "\"Using **Remy Calder** from your staff list.\": the close spelling is seated (Pau's 14 Nov one-strong-close-match)" },
    fixFlags: [FLAG, NEAR_MISS],
    async run(t) {
      if (!t.loopOn?.()) return;
      await salon(t);
      t.loopModel!(namingModel(() => typed, "She was late to her shift on 11/14."));
      const thread = t.thread();
      const reply = await thread.say(words);
      expect(thread.proposal ?? null, `a card was made for a close spelling:\n${reply.content}`).toBeNull();
      expect(reply.content).toMatch(/Did you mean \*\*Remy Calder\*\*\?/);
      expect(reply.content, "keeping the typed name is not offered").toMatch(new RegExp(`"no" to keep \\*\\*${typed}\\*\\*`));
    },
  })),
  {
    id: "nov15-k1-card-shortcut-never-overrides-a-different-name-c022",
    title: "K1 (QA's shadow replay, c022's shape): a card made from a first name alone (\"remy\"), then the manager types a different full name (\"Remi Caldor\"): asked about, never \"the person on this chat's card, use them\"",
    report: `${REPORT}: c022, the manager re-typed the truth person's full name and the card kept the close spelling`,
    status: { open: "\"A close spelling of Remy Calder, the person on this chat's card. Use them\"" },
    fixFlags: [FLAG, NEAR_MISS],
    async run(t) {
      if (!t.loopOn?.()) return;
      await salon(t);
      t.loopModel!(namingModel((said) => (/caldor/i.test(said) ? "Remi Caldor" : "remy"), "She was late to her shift on 11/14."));
      const thread = t.thread();
      await thread.say("coaching for remy, she was late to her shift on 11/14");
      expect(thread.proposal?.employeeName, "the first card is not Remy Calder's").toBe("Remy Calder");
      const reply = await thread.say("Remi Caldor");
      expect(reply.content, `the different name was read as the card's person:\n${reply.content}`).toMatch(/Did you mean \*\*Remy Calder\*\*\?/);
    },
  },
  {
    id: "nov15-k1-card-shortcut-kept-for-a-person-the-manager-typed",
    title: "K1, the control: after a card for \"Remy Calder\" typed in full, \"edit remy caldr ca\" is still that card's person, with no Did-you-mean",
    report: `${REPORT}; the live re-run's sf-s26 shape, kept`,
    status: "fixed",
    fixFlags: [FLAG, NEAR_MISS],
    async run(t) {
      if (!t.loopOn?.()) return;
      await salon(t);
      const model = namingModel((said) => (/caldr\b/i.test(said) ? "remy caldr" : "Remy Calder"), "She was late to her shift on 11/14.");
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say("coaching for Remy Calder, she was late to her shift on 11/14");
      const reply = await thread.say("edit remy caldr ca");
      expect(reply.content, "the card's own person was asked about").not.toMatch(/Did you mean/);
    },
  },
];
