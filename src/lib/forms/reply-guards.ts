import { refusalNoRepeatEnabled, titleNotSpeakersManagerEnabled } from "@/lib/config/chat-quality-flags";

/**
 * ============================================================================
 * TWO LAST CHECKS ON A REPLY (the 2 Nov 2026 scan, "CA for must see behaviors")
 * ============================================================================
 *
 * "It also gave the same refusal 3 times and listed a Tanning Consultant's job
 * title as District Manager."
 *
 * REFUSAL_NO_REPEAT_ENABLED — a REFUSAL ("won't", "can't", "isn't what …")
 * that opens with the same paragraph as the reply before it, and offers no
 * card, is not said again: the manager already has it. One line says so and
 * what would move things on. An ordinary answer is never held back.
 *
 * TITLE_NOT_SPEAKERS_MANAGER_ENABLED — "my DM told me she gets one this month"
 * is the manager's own District Manager, not the employee's title. A card
 * whose title is the role the manager called "my …" in this conversation
 * loses that title (the directory's, or the manager's own words for the
 * employee, apply), and the reply's Position line with it.
 */

interface Turn {
  readonly role: string;
  readonly content: string;
}

interface Answer {
  content: string;
  formProposal?: { employeeRole?: string | null } | null;
  formUpdate?: unknown;
}

/** Only a refusal is held back: an ordinary answer may open the same way twice. */
const REFUSAL = /\b(?:won't|will\s+not|can't|cannot|can\s+not|not\s+able\s+to|isn't\s+what|unable\s+to|not\s+allowed|is\s+for\s+one\s+person\s+at\s+a\s+time)\b/i;

function opening(text: string): string {
  return (text.split(/\n\s*\n/)[0] ?? "").trim();
}

export function withoutRepeatedRefusal<T extends Answer>(answer: T, history: readonly Turn[]): T {
  if (!refusalNoRepeatEnabled() || answer.formProposal || answer.formUpdate) return answer;
  const previous = [...history].reverse().find((turn) => turn.role === "assistant")?.content ?? "";
  const first = opening(answer.content);
  if (first.length < 40 || first !== opening(previous) || !REFUSAL.test(first)) return answer;
  const metric = /\blow number on its own\b|\boff a metric\b/i.test(first);
  const onward = metric
    ? "If coaching for this has already happened, say so — for example \"we already did coaching on 10/14\" — and I'll start the Corrective Action Form. Otherwise I can start a Coaching Form now."
    : "Tell me what's different, or what you'd like me to do instead.";
  return { ...answer, content: `That's the same answer as my last reply — nothing new changes it. ${onward}` };
}

/** "my DM", "my district manager", "my RD" … — the speaker's own manager, by role. */
const SPEAKERS_MANAGER: readonly [RegExp, RegExp][] = [
  [/\bmy\s+(?:dm|district\s+manager)\b/i, /^district\s+manager$/i],
  [/\bmy\s+(?:rd|regional\s+(?:director|manager))\b/i, /^regional\s+(?:director|manager)$/i],
];

export function withoutSpeakersManagerTitle<T extends Answer>(answer: T, managerTurns: readonly string[]): T {
  const role = answer.formProposal?.employeeRole?.trim();
  if (!titleNotSpeakersManagerEnabled() || !role) return answer;
  const said = managerTurns.join("\n");
  const hit = SPEAKERS_MANAGER.find(([phrase, title]) => title.test(role) && phrase.test(said));
  if (!hit) return answer;
  return {
    ...answer,
    content: answer.content.replace(new RegExp(`\\n?\\*\\*(?:Position|Job title):\\*\\*\\s*${role.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\n]*`, "gi"), "").trim(),
    formProposal: { ...answer.formProposal!, employeeRole: null },
  };
}
