import { observationNoEarlierQuestionEnabled } from "@/lib/config/chat-quality-flags";
import { isQuestion } from "@/lib/forms/employment-change";

/**
 * ============================================================================
 * THE OBSERVATION IS THE INCIDENT, NOT THE QUESTION ASKED BEFORE IT
 * ============================================================================
 *
 * OBSERVATION_NO_EARLIER_QUESTION_ENABLED (Pau via QA, sf-s25, 5 Nov 2026; QA, 10 Nov 2026). "closing policy" → "What
 * policy would it be if a tanning consultant did not complete the closing correctly and i have already talked to her
 * about it" → "Write a CA for <name> … on 11/3/26 she was scheduled until 9:15PM and clocked out at 9:01 …": the card's
 * Observation of Offense read "What policy would it be if a tanning consultant … about it <name> she is TC works and
 * on 11/3/26 …" — the earlier question opened the account.
 *
 * On: when a card's Observation line (and the card's issue, which a draft with no notes is written from) begins with
 * an earlier manager turn that asks rather than states ("what", "how", "which" … or a "?"), that question is taken off
 * the front; what follows it is the Observation. A question the manager asked inside their own account sentence, or
 * an Observation that would be left with almost nothing, is left as it is. After the reply is built; outside the
 * proposal flow. Pure.
 */

const OBSERVATION = /^(\*\*Observation of Offense:?\*\*\s*)(.*)$/im;

function fold(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** The text without a leading earlier question, or null when it does not begin with one. */
export function withoutLeadingQuestion(text: string, earlierTurns: readonly string[]): string | null {
  const said = fold(text);
  for (const turn of earlierTurns) {
    if (!isQuestion(turn)) continue;
    const asked = fold(turn);
    if (asked.split(" ").length < 4 || !said.startsWith(`${asked} `)) continue;
    // Walk the original text past as many letters/digits as the folded question has.
    let need = asked.replace(/ /g, "").length;
    let index = 0;
    while (index < text.length && need > 0) {
      if (/[a-z0-9]/i.test(text[index]!)) need -= 1;
      index += 1;
    }
    const rest = text.slice(index).replace(/^[\s?.,;:!-]+/, "");
    if (rest.replace(/[^\p{L}\d]/gu, "").length < 12) return null;
    return rest.charAt(0).toUpperCase() + rest.slice(1);
  }
  return null;
}

export function withObservationNoEarlierQuestion<T extends { content: string; formProposal?: { issue?: string | null } | null }>(
  answer: T,
  earlierTurns: readonly string[],
): T {
  if (!observationNoEarlierQuestionEnabled() || !answer.formProposal) return answer;
  const line = OBSERVATION.exec(answer.content);
  const fixedLine = line ? withoutLeadingQuestion(line[2]!, earlierTurns) : null;
  const issue = answer.formProposal.issue ?? null;
  const fixedIssue = issue ? withoutLeadingQuestion(issue, earlierTurns) : null;
  if (!fixedLine && !fixedIssue) return answer;
  return {
    ...answer,
    content: fixedLine ? answer.content.replace(OBSERVATION, (_whole, label: string) => `${label}${fixedLine}`) : answer.content,
    formProposal: fixedIssue ? { ...answer.formProposal, issue: fixedIssue } : answer.formProposal,
  };
}
