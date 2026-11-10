import { exitFormDateFromTerminationEnabled } from "@/lib/config/chat-quality-flags";

import { terminationEffectiveDate } from "./exit-facts";
import { exitDateInWords } from "./exit-intake";
import { EXIT_TEMPLATE_KEY } from "./exit-library";

/*
 * ============================================================================
 * A TERMINATION'S EXIT FORM IS DATED THE DAY IT TOOK EFFECT (EXIT_FORM_DATE_FROM_TERMINATION_ENABLED)
 * ============================================================================
 *
 * QA, the live round 11 (9 Nov 2026): the letter "… your employment … is terminated, effective 11/08/2026, due to
 * repeated no-call no-shows on 11/3, 11/5 and 11/7" gave the exit card the Date November 7, 2026 (the last no-show,
 * read as the incident's date) beside the Resignation Date November 8, 2026. Round 10 had November 8 for both.
 *
 * With the flag on, the last check on the card: an exit card whose manager's words state the termination and its one
 * "effective <date>" is dated that day, on the card and on the reply's "- **Date:**" line. A card with no stated
 * termination keeps its date. Off, as before.
 */

const DATE_LINE = /^- \*\*Date:\*\* .+$/m;

interface CardLike {
  templateKey?: string;
  formDate?: string | null;
}

export function withExitFormDateFromTermination<T extends { content: string; formProposal?: CardLike | null }>(
  answer: T,
  managerTurns: readonly string[],
  today: string,
): T {
  if (!exitFormDateFromTerminationEnabled()) return answer;
  const card = answer.formProposal;
  if (!card || card.templateKey !== EXIT_TEMPLATE_KEY) return answer;
  const effective = terminationEffectiveDate(managerTurns.join("\n"), today);
  if (!effective || card.formDate === effective) return answer;
  return {
    ...answer,
    content: answer.content.replace(DATE_LINE, `- **Date:** ${exitDateInWords(effective)}`),
    formProposal: { ...card, formDate: effective },
  };
}
