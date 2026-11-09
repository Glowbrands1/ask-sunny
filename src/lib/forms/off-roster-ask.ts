import { offRosterAskBeforeCardEnabled, offRosterConfirmEnabled } from "@/lib/config/chat-quality-flags";
import type { AccessScope } from "@/types";

import { normalizeTypedName } from "./employee-match";
import { isAcceptedOffRoster, offRosterCardNote, offRosterOffer, offRosterTakenLine } from "./off-roster-confirm";
import { personRosterNames } from "./person-guard";
import { offRosterTyped } from "./roster-only-names";

/*
 * ============================================================================
 * A FULL NAME THAT IS NOT ON THE SALON'S ROSTER IS ASKED ABOUT BEFORE A CARD (OFF_ROSTER_ASK_BEFORE_CARD_ENABLED)
 * ============================================================================
 *
 * Ported from the sibling app (QA's round-6 live test there, 9 Nov 2026; pre-existing here too, checked on main
 * 24a380e5): "create a coaching form for <full name not on the roster>" gave a ready card, no question. UNKNOWN_NAME_ASK only rewords the "Who is this … for?" reply, and with
 * the name flags off the typed name goes on the card.
 *
 * With the flag on, for a salon-scoped manager (a district, region or global manager is never held up) a card whose
 * employee is a full name nobody on this manager's roster has is held back once: the reply asks "I can't find <name>
 * on your roster — is that the right name, or are they at another salon?", with OFF_ROSTER_CONFIRM's offer ("reply
 * use <name>") when that flag is on, so its flow is unchanged: "use <name>" / "yes" / the name again makes the card,
 * marked not from Woven. The question is asked once per name; after it, the card comes as it does today. No roster
 * read this turn (PERSON_GUARD off, or the read timed out): nothing changes. Off, as before.
 */

interface CardLike {
  employeeName: string | null;
  employeeRole?: string | null;
  templateName?: string;
  subject?: string;
  status: string;
  supportsInlineDraft?: boolean;
  closeMatchNote?: string;
}

type Turn = { readonly role: string; readonly content: string };

export function offRosterQuestion(name: string): string {
  return `I can't find **${name}** on your roster — is that the right name, or are they at another salon?`;
}

function words(name: string): string {
  return normalizeTypedName(name).toLowerCase().replace(/[^\p{L}\s'-]+/gu, " ").split(/\s+/).filter(Boolean).join(" ");
}

/** Somebody on the roster has this full name, or this first and last name. */
function onRoster(name: string, roster: readonly string[]): boolean {
  const typed = words(name).split(" ");
  return roster.some((person) => {
    const own = words(person).split(" ");
    return own.join(" ") === typed.join(" ") || (own[0] === typed[0] && own[own.length - 1] === typed[typed.length - 1]);
  });
}

export function withOffRosterAskBeforeCard<T extends { content: string; formProposal?: CardLike | null }>(
  answer: T,
  input: { readonly scope: AccessScope | null | undefined; readonly history: readonly Turn[]; readonly question: string },
): T {
  if (!offRosterAskBeforeCardEnabled() || input.scope?.level !== "salon") return answer;
  const card = answer.formProposal;
  const name = card?.employeeName?.trim();
  if (!card || !name || card.subject === "team" || words(name).split(" ").length < 2) return answer;
  const roster = personRosterNames();
  if (!roster || roster.length === 0 || onRoster(name, roster)) return answer;
  // The card already says it is not from Woven (FORM_NAME_FROM_ROSTER's flow): as it is.
  if (/Not in Woven/i.test(card.closeMatchNote ?? "")) return answer;
  /*
   * OFF_ROSTER_CONFIRM: the manager took the typed name ("use <name>", "yes", the name again). With the name flags off
   * nothing else says so; the card says it, in the reply and the card's note, as FORM_NAME's flow does.
   */
  if (isAcceptedOffRoster(name)) {
    return {
      ...answer,
      content: `${offRosterTakenLine(name)}\n\n${answer.content.trim()}`,
      formProposal: { ...card, closeMatchNote: offRosterCardNote(name) },
    };
  }
  /*
   * Only a name OFF_ROSTER_CONFIRM would offer: typed where a person goes, in a name's shape, nobody on the roster or
   * close to them (a near miss is asked as that person), never a product, an all-caps run or a title. Said back as it
   * would be offered (Title Case).
   */
  const typed = offRosterTyped(name, input.question, roster);
  if (!typed) return answer;
  const question = offRosterQuestion(typed);
  if (input.history.some((turn) => turn.role === "assistant" && turn.content.includes(question))) return answer;
  const offer = offRosterConfirmEnabled() ? ` ${offRosterOffer(typed)}` : "";
  return {
    ...answer,
    content: `${question}${offer}`,
    formProposal: { ...card, employeeName: null, employeeRole: null, status: "needs_employee", supportsInlineDraft: false },
  };
}
