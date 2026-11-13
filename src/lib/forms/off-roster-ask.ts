import { formNameOffRosterAskEnabled, offRosterAskBeforeCardEnabled, offRosterConfirmEnabled, offRosterStoreAnswerOnlyEnabled } from "@/lib/config/chat-quality-flags";
import { salonById } from "@/data/salons";
import type { AccessScope } from "@/types";

import { normalizeTypedName } from "./employee-match";
import { isAcceptedOffRoster, offRosterCardNote, offRosterOffer, offRosterTakenLine } from "./off-roster-confirm";
import { personRosterNames } from "./person-guard";
import { offRosterTyped } from "./roster-only-names";
import { editDistance } from "./typo-match";
import { readSalonMentions } from "./salon-mention";

/** Words around a salon that say nothing else ("at", "the salon is", "she works at our …"). */
const SALON_FILLER = new Set(["at", "the", "our", "salon", "store", "location", "is", "its", "it's", "in", "she", "he", "they", "work", "works", "from"]);
const salonWords = (text: string) =>
  text
    .toLowerCase()
    .replace(/\bstreet\b/g, "st")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

/**
 * OFF_ROSTER_STORE_ANSWER_ONLY_ENABLED: the turn is only a salon: one salon the readers are sure of, and nothing else but
 * its own name's words, filler and a state abbreviation ("kearney, ne", "o st", "NE Lincoln O Street").
 */
export function storeOnlyAnswer(text: string): boolean {
  // A whole-turn reply carries no cue of its own ("kearney, ne"); it is read as "at …", the place it answers.
  const mentions = readSalonMentions(/^\s*at\b/i.test(text) ? text : `at ${text}`).filter((mention) => mention.salonIds.length === 1);
  if (mentions.length !== 1) return false;
  const salon = salonById(mentions[0]!.salonIds[0]!);
  if (!salon) return false;
  const own = new Set(salonWords(salon.name));
  const rest = salonWords(text).filter((word) => !own.has(word) && !SALON_FILLER.has(word));
  return rest.length === 0 || (rest.length === 1 && /^[a-z]{2}$/.test(rest[0]!));
}

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
 * use <name>"). It runs only beside OFF_ROSTER_CONFIRM, so that flow is unchanged: "use <name>" / "yes" / the name again makes the card,
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
  wovenCloseMatch?: string | null;
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

/**
 * A near miss of somebody on the roster: the same first name and a last word at most two edits away ("Odalys
 * Vansikcle" beside "Odalys Prewett Vansickle", "Remy Caldor" beside "Remy Calder"). That is asked as them, never
 * offered as a name not on the roster — the matcher answers "none" when two roster people are equally close.
 */
function nearSomeone(name: string, roster: readonly string[]): boolean {
  const typed = words(name).split(" ");
  return roster.some((person) => {
    const own = words(person).split(" ");
    return own[0] === typed[0] && editDistance(own[own.length - 1]!, typed[typed.length - 1]!) <= 2;
  });
}

export function withOffRosterAskBeforeCard<T extends { content: string; formProposal?: CardLike | null }>(
  answer: T,
  input: { readonly scope: AccessScope | null | undefined; readonly history: readonly Turn[]; readonly question: string },
): T {
  // Only beside OFF_ROSTER_CONFIRM: its "use <name>" offer and taking it are how the manager answers this question.
  if (!offRosterAskBeforeCardEnabled() || !offRosterConfirmEnabled() || input.scope?.level !== "salon") return answer;
  const card = answer.formProposal;
  const name = card?.employeeName?.trim();
  /*
   * FORM_NAME_OFF_ROSTER_ASK_ENABLED (QA, 10 Nov 2026, the Sunny roster-set gate): with FORM_NAME on, the name has
   * already left the card, and the reply says "I couldn't find **<name>** in the Woven roster, so that name is not on
   * the form." with OFF_ROSTER_CONFIRM's offer, under the empty card. It is asked as this flow asks it: the question
   * and the offer, the card held, once per name.
   */
  if (formNameOffRosterAskEnabled() && card && !name && card.subject !== "team") {
    const noted = /I couldn['’]t find \*\*([^*]+)\*\* in the Woven roster, so that name is not on the form\./.exec(answer.content)?.[1];
    if (noted && answer.content.includes(offRosterOffer(noted))) {
      const question = offRosterQuestion(noted);
      if (input.history.some((turn) => turn.role === "assistant" && turn.content.includes(question))) return answer;
      return {
        ...answer,
        content: `${question} ${offRosterOffer(noted)}`,
        formProposal: { ...card, employeeName: null, employeeRole: null, status: "needs_employee", supportsInlineDraft: false },
      };
    }
  }
  if (!card || !name || card.subject === "team" || words(name).split(" ").length < 2) return answer;
  const roster = personRosterNames();
  if (!roster || roster.length === 0 || onRoster(name, roster) || nearSomeone(name, roster)) return answer;
  // The card already says it is not from Woven (FORM_NAME_FROM_ROSTER's flow): as it is.
  if (/Not in Woven/i.test(card.wovenCloseMatch ?? "")) return answer;
  /*
   * OFF_ROSTER_CONFIRM: the manager took the typed name ("use <name>", "yes", the name again). With the name flags off
   * nothing else says so; the card says it, in the reply and the card's note, as FORM_NAME's flow does.
   */
  if (isAcceptedOffRoster(name)) {
    return {
      ...answer,
      content: `${offRosterTakenLine(name)}\n\n${answer.content.trim()}`,
      formProposal: { ...card, wovenCloseMatch: offRosterCardNote(name) },
    };
  }
  /*
   * Only a name OFF_ROSTER_CONFIRM would offer: typed where a person goes, in a name's shape, nobody on the roster or
   * close to them (a near miss is asked as that person), never a product, an all-caps run or a title. Said back as it
   * would be offered (Title Case).
   */
  /*
   * OFF_ROSTER_STORE_ANSWER_ONLY_ENABLED (QA's ruling on Ask Bubbles' #735 gate, 12 Nov 2026): a salon-only answer to
   * this question sets the salon; the name still needs "use <name>". The card is held, with its salon, and the question
   * and offer are asked again.
   */
  if (offRosterStoreAnswerOnlyEnabled() && !isAcceptedOffRoster(name)) {
    const offered = [...input.history].reverse().find((turn) => turn.role === "assistant")?.content ?? "";
    const pending = /reply \*\*use ([^*]+)\*\*/.exec(offered)?.[1]?.trim();
    if (pending && offered.includes(offRosterQuestion(pending)) && storeOnlyAnswer(input.question)) {
      return {
        ...answer,
        content: `${offRosterQuestion(pending)} ${offRosterOffer(pending)}`,
        formProposal: { ...card, employeeName: null, employeeRole: null, status: "needs_employee", supportsInlineDraft: false },
      };
    }
  }
  const typed = offRosterTyped(name, input.question, roster);
  if (!typed) return answer;
  const question = offRosterQuestion(typed);
  if (input.history.some((turn) => turn.role === "assistant" && turn.content.includes(question))) return answer;
  return {
    ...answer,
    content: `${question} ${offRosterOffer(typed)}`,
    formProposal: { ...card, employeeName: null, employeeRole: null, status: "needs_employee", supportsInlineDraft: false },
  };
}
