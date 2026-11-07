import { addressNotPersonEnabled, formNameFromRosterEnabled, metricChoiceOneQuestionEnabled, metricGuardEnabled, offRosterConfirmEnabled, rosterNearMissEnabled, rosterNotFoundAnyPhrasingEnabled, nearMissQuestionRulesEnabled } from "@/lib/config/chat-quality-flags";
import { isGlossaryTerm } from "@/lib/ai/chat-glossary";
import type { AskResponse } from "@/lib/ai/types";

import { HAS_EMPLOYEE_AND_PLACE, SAYS_READY } from "@/lib/ai/ca-what-happened";

import { matchEmployeeName, normalizeTypedName, type RosterEmployee } from "./employee-match";
import { isAcceptedOffRoster, offRosterCardNote, offRosterOffer, offRosterTakenLine } from "./off-roster-confirm";
import { addressNotPersonAsk, followsHouseNumber, personRosterNames } from "./person-guard";
import { namesThisCompany } from "./company-name";
import { namesCompanyPositionTitle } from "./staff-picker";
import { metricMessage, namesAMetric, requestMessage, cardOnScreen } from "./request-slot";
import { namesAForm } from "./template-intent";

/**
 * ============================================================================
 * ONLY ROSTER PEOPLE ARE EVER THE EMPLOYEE OR A CHOICE (Pau, 5 Nov 2026)
 * ============================================================================
 *
 * FORM_NAME_FROM_ROSTER_ENABLED. Pau, after the flip's eval check (lowercase
 * names lost) and the coordinator's message 8 ("Which of them is this
 * Corrective Action Form for — Dana Lane, LPSVA or Average Club?"):
 *
 *   "Don't treat raw text after 'for' as the person. Match it against the
 *    roster ignoring capitals, and put the roster's spelling on the card. No
 *    roster match means ask who it's for. Only roster names can ever be
 *    offered as choices."
 *
 * The last step of every chat turn, on the finished reply, with the actor's
 * roster read this turn (`person-guard.ts` personRosterNames):
 *
 *   THE CARD'S EMPLOYEE. A name that is somebody's whole roster name, in any
 *   case ("odalys merriwether"), takes the roster's spelling. A name close to
 *   exactly one roster person, or a first name that is exactly one roster
 *   person's, is not put on the card: the reply asks "Is this for <them>?". Any
 *   other name is not the employee: the card has none and the reply asks once
 *   who the form is for.
 *
 *   THE CHOICES. "Which of them is this … for — A, B or C?" keeps only roster
 *   people; "Is this for X?" stands only for a roster person. A choice left
 *   with nobody becomes "Who is this form for?"; one left with only the
 *   card's own person is dropped.
 *
 * Matching is the directory matcher's (`employee-match.ts`); no word list. No
 * roster read this turn (the directory slow or empty): the reply as built.
 */

export const ASK_WHO = "Who is this form for? Tell me the employee's full name.";
/** The card's own invitation to create the draft (`ai/form-proposal.ts`), said only when the card has its employee. */
export const CREATE_WHEN_READY = /Create the draft here when you're ready,? and edit it below — nothing is saved to anyone's file until you do\.[ \t]*/g;
export const ASKS_WHO = /Who is this (?:\*\*[^*]+\*\* |form )?for\?/i;

function rowsFrom(names: readonly string[]): RosterEmployee[] {
  return names.flatMap((name, index) => {
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (words.length < 2) return [];
    return [{ id: `roster-${index}`, firstName: words[0]!, lastName: words.slice(1).join(" "), salonIds: [] }];
  });
}

/** The roster's spelling of this whole name, in any case; null when it is nobody's. */
export function rosterSpelling(name: string, names: readonly string[]): string | null {
  const typed = normalizeTypedName(name);
  if (!typed) return null;
  return names.find((roster) => normalizeTypedName(roster) === typed)?.trim() ?? null;
}

/** The one roster person this name is close to (a typo, a first name, an initial), or null. */
export function oneCloseRosterPerson(name: string, names: readonly string[]): string | null {
  const match = matchEmployeeName(name, rowsFrom(names));
  if (match.kind === "exact") return match.name;
  if (match.kind === "confirm") {
    const people = [...new Set(match.candidates.map((candidate) => candidate.name))];
    return people.length === 1 ? people[0]! : null;
  }
  return null;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The names in "A, B or C" / "**A**, **B** or **C**". */
function listedNames(list: string): string[] {
  return list
    .split(/\s*,\s*(?:or\s+|and\s+)?|\s+or\s+|\s+and\s+/i)
    .map((name) => name.replace(/\*/g, "").trim())
    .filter(Boolean);
}

function said(names: readonly string[]): string {
  const bold = names.map((name) => `**${name}**`);
  return bold.length <= 1 ? (bold[0] ?? "") : `${bold.slice(0, -1).join(", ")} or ${bold[bold.length - 1]}`;
}

/** The reply and card with only roster people as the employee and as choices. Pure; see `withRosterOnlyNames`. */
export function rosterOnlyNames(response: AskResponse, names: readonly string[], message?: string): AskResponse {
  if (names.length === 0) return response;
  let content = response.content;
  let proposal = response.formProposal;
  let ask: string | null = null;
  // OFF_ROSTER_CONFIRM_ENABLED: the off-roster offer was made this reply, so it is the one question about the person.
  let offerMade = false;

  const employee = proposal?.employeeName?.trim() ?? "";
  if (proposal && employee && proposal.subject !== "team") {
    const spelled = rosterSpelling(employee, names);
    if (spelled) {
      if (spelled !== employee) {
        proposal = { ...proposal, employeeName: spelled };
        content = content.split(`**${employee}**`).join(`**${spelled}**`);
      }
    } else if (!oneCloseRosterPerson(employee, names) && isAcceptedOffRoster(employee)) {
      /*
       * OFF_ROSTER_CONFIRM_ENABLED: the manager took the name as typed ("use <name>" to the offer below) — somebody
       * not in Woven, nobody close on it. The card keeps it and says so, in the reply and in the card's note.
       */
      // A name typed in lowercase goes on the card in Title Case, as the offer said it.
      const named = titleCased(employee);
      proposal = { ...proposal, employeeName: named, wovenCloseMatch: offRosterCardNote(named) };
      content = `${offRosterTakenLine(named)}\n\n${content.trim().split(`**${employee}**`).join(`**${named}**`)}`;
    } else {
      const close = oneCloseRosterPerson(employee, names);
      /*
       * ROSTER_NEAR_MISS_ENABLED (QA's testers, 5 Nov 2026, R3): a near-miss of
       * one roster person is asked exactly as a first name typed alone is
       * (`ai/first-name-suggest.ts`): only the question, the card waits, and the
       * answer ("yes", the name) is read by that machinery as the request with
       * the roster's name in full.
       */
      /*
       * NEAR_MISS_QUESTION_RULES_ENABLED (QA's Sunny round-4 gate, 8 Nov 2026: nov5-r6-policy-kept-across-turns t7, "make
       * that change to Marisol Prtega Valdez"): a card already on screen is never replaced by the bare question. A
       * near-miss of the card's own employee is her, in the roster's spelling; anyone else is asked under the card.
       */
      const onScreen = nearMissQuestionRulesEnabled() ? cardOnScreen() : undefined;
      if (onScreen && close && close.toLowerCase() === onScreen.toLowerCase()) {
        return { ...response, content: content.split(`**${employee}**`).join(`**${close}**`), formProposal: { ...proposal, employeeName: close } };
      }
      if (rosterNearMissEnabled() && close && !onScreen) {
        return { ...response, content: `Is this for **${close}**? Tell me if that should change.`, formProposal: undefined };
      }
      proposal = { ...proposal, employeeName: null, status: "needs_employee" };
      // The reply never drafts for a name that is not on the card.
      content = content.replace(new RegExp(String.raw`\s+for\s+\*\*${escape(employee)}\*\*`, "g"), "").split(`**${employee}**`).join("the employee");
      ask = close ? `Is this for **${close}**?` : ASK_WHO;
      /*
       * The Sunny flip-3 gate (6 Nov 2026, defect 2): "coaching form for 123 Main Street" — the name follows a house
       * number in this turn, so ADDRESS_NOT_PERSON's question (it runs later and finds the card already empty) is
       * asked here, not the bare who-ask.
       */
      if (!close && addressNotPersonEnabled() && message && followsHouseNumber(employee, message)) {
        ask = addressNotPersonAsk(proposal.templateName ?? "form", employee);
        content = content.split("\n").filter((line) => !ASKS_WHO.test(line)).join("\n");
      }
      /*
       * THE GATE (5 Nov 2026, nov3-street-then-placeholder): the card was ready
       * when it was built, so the reply said "Everything I need is here … I have
       * the employee and the salon" — and then asked who. A card with no
       * employee never says it has one (the same sentences
       * `ai/ca-what-happened.ts` takes out of a card with no account).
       */
      content = content
        .replace(HAS_EMPLOYEE_AND_PLACE, "")
        .split("\n")
        .filter((line) => !SAYS_READY.test(line.trim()))
        .join("\n");
    }
  }
  const onCard = proposal?.employeeName ?? null;
  if (proposal && !onCard && proposal.subject !== "team") {
    content = withoutSlotNameInObservation(content, message, names);
    // QA, 5 Nov 2026: "Create the draft here when you're ready" beside "Who is this form for?" contradicts it.
    content = content.replace(CREATE_WHEN_READY, "");
    if (rosterNearMissEnabled()) {
      // ROSTER_NEAR_MISS_ENABLED: an empty card never says it has the employee, never names them, and asks who.
      content = withoutUnseatedName(
        content.replace(HAS_EMPLOYEE_AND_PLACE, "").split("\n").filter((line) => !SAYS_READY.test(line.trim())).join("\n"),
        [employee, slotName(message, names)],
        names,
        draftedFor(content),
        // The app's own words stay (QA, 5 Nov 2026: "QA Probe XZT One" made "One more question" "The employee more question").
        { ownWords: true },
      );
      if (!ask && !ASKS_WHO.test(content) && !ASKS_A_CHOICE.test(content) && !ASKS_FOR_THE_NAME.test(content)) ask = ASK_WHO;
      // OFF_ROSTER_CONFIRM_ENABLED: the cleared name, however it was typed (alone on its own line too), is said back and offered.
      const offered = offRosterConfirmEnabled() && employee ? offRosterTyped(employee, message, names) : null;
      content = withNotFoundNote(content, notFoundName(message, names) ?? offered, names);
      if (offered) {
        content = withOffRosterOffer(content, offered);
        offerMade = true;
      }
    }
  }

  // "I'll draft a **Corrective Action Form** for **ima**": the person drafted for is the card's, in the roster's spelling.
  if (onCard && proposal?.subject !== "team") {
    content = content.replace(/(\b(?:draft|create|put)\b[^\n.]*?\*\*[^*]+\*\* for )\*\*([^*]+)\*\*/gi, (whole, lead: string, name: string) => {
      if (name === onCard) return whole;
      const same = rosterSpelling(name, names) === onCard || oneCloseRosterPerson(name, names) === onCard;
      return same ? `${lead}**${onCard}**` : whole;
    });
  }

  /*
   * "Which of them is this … for — A, B or C?": roster people only. The question's own "Tell me and I'll …" after it
   * on the same line stays with a choice that is still asked, and goes with one that is not: ASK_WHO asks it already
   * (the sibling app's FORM_NAME re-flip gate, 7 Nov 2026: "… full name. Tell me and I'll fill in …" asked twice).
   */
  content = content.replace(/Which of them is this ((?:\*\*[^*]+\*\* )?)for\s*[—–-]\s*([^?\n]+)\?([ \t]+Tell me\b[^\n]*)?/g, (whole, form: string, list: string, tail: string | undefined) => {
    const kept = [...new Set(listedNames(list).map((name) => rosterSpelling(name, names)).filter((name): name is string => Boolean(name)))];
    if (kept.length >= 2) return `Which of them is this ${form}for — ${said(kept)}?${tail ?? ""}`;
    if (kept.length === 1) return kept[0] === onCard ? "" : `Is this for **${kept[0]}**?${tail ?? ""}`;
    return onCard ? "" : ASK_WHO;
  });
  // "Is this for X?": a roster person only.
  content = content.replace(/Is this for \*\*([^*]+)\*\*\?/g, (whole, name: string) => {
    if (rosterSpelling(name, names)) return whole;
    const close = oneCloseRosterPerson(name, names);
    return close ? `Is this for **${close}**?` : onCard ? "" : ASK_WHO;
  });

  /*
   * OFF_ROSTER_CONFIRM_ENABLED (the sibling app's flip-3 tester, 6 Nov 2026, finding C): with the offer ("reply
   * **use <name>**") made, the reply never also asks "Who is this form for?", and the card list never shows "Name: The
   * employee". Any other question (the job title) stays.
   */
  if (offerMade) {
    ask = null;
    content = content
      .split("\n")
      .filter((line) => !ASKS_WHO.test(line) && !/^- \*\*Name:\*\* the employee$/i.test(line.trim()))
      .join("\n");
  }
  if (ask && !content.includes(ask) && !(ask === ASK_WHO && ASKS_WHO.test(content))) {
    content = `${content.trim()}\n\n${ask}`;
  }
  // Keep "Who is this form for?" once.
  const first = content.indexOf(ASK_WHO);
  if (first >= 0) content = content.slice(0, first + ASK_WHO.length) + content.slice(first + ASK_WHO.length).split(ASK_WHO).join("");
  content = content.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n").trim();

  if (content === response.content && proposal === response.formProposal) return response;
  return { ...response, content, formProposal: proposal };
}

/**
 * THE GATE (5 Nov 2026, nov5-roster-only-ima-off-roster): "create a CA form for
 * ima employee, for opening salon late on 9-28-26" asked who, as it should, but
 * the Observation read "ima employee, opening salon late on 9-28-26" — the name
 * that is not on the card, kept because the account is drafted without the
 * employee it would have left out. With no employee on the card, an
 * Observation that opens with the request's own "for <…>," — words of the
 * manager's message, not a roster person — opens with what happened instead.
 * Only the opening clause, and only when the message has it straight after
 * "for": a name later in the account is the account's.
 */
function withoutSlotNameInObservation(content: string, message: string | undefined, names: readonly string[]): string {
  if (!message) return content;
  return content.replace(/(\*\*Observation of Offense:\*\*[ \t]*)([^,\n]+),[ \t]*(?=\S)/g, (whole, label: string, lead: string) => {
    const typed = lead.trim();
    if (!typed || typed.split(/\s+/).length > 4 || rosterSpelling(typed, names)) return whole;
    // The Sunny flip-3 gate (6 Nov 2026, defect 3): "a CA for Under Performance on PPTA, LPSVA, …" — the clause after
    // "for" opens with what happened (the name readers' metric rule: "Under Performance"), not a person, so the
    // Observation keeps it.
    const words = typed.split(/\s+/);
    if (metricGuardEnabled() && words.some((_, end) => namesAMetric(words.slice(0, end + 1).join(" "), message))) return whole;
    return new RegExp(String.raw`\bfor\s+${escape(typed)}\s*,`, "i").test(message) ? label : whole;
  });
}

/**
 * ROSTER_NEAR_MISS_ENABLED (QA's testers, 5 Nov 2026, R3/R5/R7): with no
 * employee on the card, no reply text names the person who is not on it.
 * The card was emptied and the reply asked "Who is this form for?", but the
 * Action Plan still read "… with Ignatius", and an off-roster request's reply
 * said "I can create a CA for <A>" / "Name: <B>". The name taken off the card,
 * and the name the manager's request put after "for", are "the employee" in
 * every line; a "Name:" line goes. The line that says the name is not on the
 * roster ("I couldn't find **<name>** …") says why, and stays. The person's
 * words only: no word list.
 */
/** A reply line that asks the manager to choose or confirm a person: its names are the choices. */
/** The reply's own list of details asks who already: "1. Employee's full name", "1. The employee's full name — or tell me it's for the whole team." */
// FIRST_NAME_ASK's "Is this for ivy? Tell me her full name." asks too (the sibling app's final gate, 5 Nov 2026).
export const ASKS_FOR_THE_NAME = /\b(?:employee['’]s|her|his|their) full name\b/i;
export const ASKS_A_CHOICE = /Did you mean|Which of them|Is this for (?:\*\*|[^?\n*]{1,60}\?)/;

/**
 * `ownWords` (REPLY_MATCHES_CARD_ENABLED's rule 1; QA, 5 Nov 2026): one word of the name, alone, is the app's own
 * word — kept — where it starts a line or a sentence with no other word of that name beside it ("One more
 * question" for "QA Probe XZT One", "Will you want …" for "Will Drummet"), and where it is written in another case
 * than the name was typed ("Management will review"), unless the name was typed all in lowercase. The whole name,
 * and the word mid-sentence as typed ("with Will"), are still "the employee".
 */
export function withoutUnseatedName(
  content: string,
  typed: readonly (string | null)[],
  names: readonly string[],
  drafted: readonly string[] = [],
  options: { readonly ownWords?: boolean } = {},
): string {
  const unseated = (list: readonly (string | null)[]) => [...new Set(list.map((name) => name?.trim() ?? "").filter((name) => name && !rosterSpelling(name, names)))];
  const people = unseated(typed);
  // The name the reply drafted for ("… for **zebulon marchbanks**") is a person's however it was typed: its words in any case.
  const draftedPeople = unseated(drafted);
  if (people.length === 0 && draftedPeople.length === 0) return content;
  const words = [...new Set(people.flatMap((name) => name.split(/\s+/)).filter((word) => /^\p{Lu}[\p{L}'’-]{2,}$/u.test(word)))];
  const anyCase = [...new Set(draftedPeople.flatMap((name) => name.split(/\s+/)).filter((word) => /^[\p{L}'’-]{3,}$/u.test(word)))];
  const whole = [...people, ...draftedPeople].map((name) => new RegExp(String.raw`\*{0,2}\b${escape(name)}\b\*{0,2}`, "gi"));
  const single = [
    ...words.map((word) => new RegExp(String.raw`\*{0,2}\b${escape(word)}\b\*{0,2}`, "g")),
    ...anyCase.map((word) => new RegExp(String.raw`\*{0,2}\b${escape(word)}\b\*{0,2}`, "gi")),
  ];
  const nameWords = new Set([...people, ...draftedPeople].flatMap((name) => name.toLowerCase().split(/\s+/)));
  const typedLower = new Set(draftedPeople.filter((name) => name === name.toLowerCase()).flatMap((name) => name.split(/\s+/)));
  const typedAs = new Set([...people, ...draftedPeople].flatMap((name) => name.split(/\s+/)));
  /** `ownWords`: this one-word match is the app's word, not the name. */
  const ownWord = (line: string, found: string, at: number): boolean => {
    if (!options.ownWords) return false;
    const word = found.replace(/\*/g, "");
    if (!typedAs.has(word) && !typedLower.has(word.toLowerCase())) return true;
    const before = line.slice(0, at);
    const after = line.slice(at + found.length);
    const besideName = nameWords.has((/([\p{L}'’-]+)\W*$/u.exec(before)?.[1] ?? "").toLowerCase()) || nameWords.has((/^\W*([\p{L}'’-]+)/u.exec(after)?.[1] ?? "").toLowerCase());
    // A line or a sentence starts here (after ".", "!" or "?"; never after ":", where a name begins a field: "action plan: Zebulon will …").
    return /^\s*$|[.!?]\s+$/.test(before) && !besideName && !found.startsWith("*");
  };
  return content
    .split("\n")
    .filter((line) => !/^\s*\**\s*Name\s*:/i.test(line))
    .map((line) => {
      if (/I couldn['’]t find \*\*/.test(line) || ASKS_A_CHOICE.test(line)) return line;
      // A roster person's name in the line is somebody else's: kept as written.
      const kept: string[] = [];
      let next = line;
      for (const roster of names) {
        next = next.replace(new RegExp(String.raw`\b${escape(roster)}\b`, "gi"), (found) => `\u0000${kept.push(found) - 1}\u0000`);
      }
      for (const pattern of whole) next = next.replace(pattern, "the employee");
      for (const pattern of single) next = next.replace(pattern, (found: string, at: number, line: string) => (ownWord(line, found, at) ? found : "the employee"));
      next = next.replace(/(^|[.!?]\s+|\*\*\s*)the employee/g, (_all, lead: string) => `${lead}The employee`);
      return next.replace(/\u0000(\d+)\u0000/g, (_all, index: string) => kept[Number(index)]!);
    })
    .join("\n");
}

/**
 * OFF_ROSTER_CONFIRM_ENABLED (the Sunny flip-3 gate, 6 Nov 2026): anybody on the roster the typed name is close to —
 * one person or several ("Odalys Vansikcle" beside Odalys Prewett Vansickle and Odalys Dunmore Vansickle) — means the
 * name is a near miss of a roster person, asked about as them, and never offered as a name not in Woven. A first name
 * typed with another surname ("Remy Fenn" beside Remy Calder) is close to nobody, and is still offered.
 */
function anyRosterPersonClose(name: string, names: readonly string[]): boolean {
  if (oneCloseRosterPerson(name, names)) return true;
  // Each roster person on their own: the matcher answers "none" when two people are equally close, which is no answer here.
  return rowsFrom(names).some((row) => {
    const kind = matchEmployeeName(name, [row]).kind;
    return kind === "exact" || kind === "confirm";
  });
}

/**
 * OFF_ROSTER_CONFIRM_ENABLED (the sibling app's gate rerun 2, 6 Nov 2026; QA: lowercase too): the cleared name is offered only where the
 * manager typed it as a person — "for <name>," / "for <name>" ending the message / "employee, <name>", a line of the
 * message that is only the name (an exit form typed as lines), or "use <name>" — and only in a name's shape: two or
 * three words, each capitalised with a lowercase letter in it, or all lowercase (an all-caps word, "BY", "QA", is no name word), never a form's name,
 * nobody on the roster or close to them. So "Bath Bomb Kits" (typed as no person) and "BY CORIN BELLWEATHER" or
 * "QA Probe XZT One" are never offered; "zebulon marchbanks" is, said back in Title Case. Null: no offer; else the
 * name in Title Case.
 */
function offRosterTyped(employee: string, message: string | undefined, names: readonly string[]): string | null {
  const typed = employee.trim();
  if (!NAME_SHAPE.test(typed) || rosterSpelling(typed, names) || anyRosterPersonClose(typed, names) || namesAForm(typed)) return null;
  if (normalizeTypedName(typed).split(/\s+/).includes(UNNAMED_PERSON_WORD)) return null;
  // B1: a company position title is never offered as a person.
  if (namesCompanyPositionTitle(typed)) return null;
  // QA, 7 Nov 2026: nor is the company's own name or initials.
  if (namesThisCompany(typed)) return null;
  const same = (said: string | null | undefined) => Boolean(said) && normalizeTypedName(said!) === normalizeTypedName(typed);
  const text = message ?? "";
  const placed =
    personPlaces(typed).some((place) => place.test(text.trim())) ||
    afterCompanyTitle(typed, text) ||
    text.split(/\n/).some((line) => same(line.trim().replace(USE_NAME, "")) && NAME_SHAPE.test(line.trim().replace(USE_NAME, "")));
  return placed ? titleCased(typed) : null;
}

/**
 * The app's own word for a person it has no name for ("the employee", "Tell me the employee's full name"); QA, 6 Nov
 * 2026, under OFF_ROSTER_CONFIRM_ENABLED. A cleared name that holds it ("ima employee") is a placeholder, never
 * offered. The one word, from the app's wording; nothing else is added.
 */
const UNNAMED_PERSON_WORD = "employee";

/**
 * One word of a name, as typed: a capital, then letters, apostrophes or hyphens with at least one lowercase letter
 * ("Marchbanks", "McAllister", "O'Callaghan", "DeLuca", "St-Pierre"; QA, 6 Nov 2026), or all lowercase. An all-caps
 * word ("BY", "QA") is no name word.
 */
const NAME_WORD = String.raw`(?:\p{Lu}(?=[\p{L}'’-]*\p{Ll})[\p{L}'’-]+|\p{Ll}[\p{Ll}'’-]+)`;
const NAME_RUN = String.raw`(${NAME_WORD}(?:\s+${NAME_WORD}){1,2})`;
/** Two or three name words. */
const NAME_SHAPE = new RegExp(String.raw`^${NAME_RUN}$`, "u");
/**
 * Where a request types its person — "for <name>,", "for <name>" ending it, "employee, <name>" — read with the card's
 * own name, so the words after it ("…, Zebulon Marchbanks that needs …"; gate rerun 3) are never taken as part of it.
 */
/**
 * The sibling app's FORM_NAME live re-run (QA, 7 Nov 2026, FAIL 1, the real B1 message there): "create a written
 * corrective action for <job title>, <name>. …" — the name in a person's place after a company position title (the
 * title list's, `staff-picker.ts` namesCompanyPositionTitle). The offer was never made, so the manager was asked who on
 * every turn.
 */
function afterCompanyTitle(name: string, text: string): boolean {
  const spelled = name.trim().split(/\s+/).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(String.raw`\s+`);
  const found = new RegExp(String.raw`\bfor\s+([\p{L}][\p{L} ]{1,40}?),\s*${spelled}(?![\p{L}'’-])`, "iu").exec(text);
  return Boolean(found && namesCompanyPositionTitle(found[1]!));
}

function personPlaces(name: string): RegExp[] {
  const spelled = name.trim().split(/\s+/).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(String.raw`\s+`);
  const end = String.raw`(?![\p{L}'’-])`;
  return [
    new RegExp(String.raw`\bfor\s+${spelled}${end}\s*[,.]`, "iu"),
    new RegExp(String.raw`\bfor\s+${spelled}${end}\s*[.!]?$`, "iu"),
    new RegExp(String.raw`\bemployee,?\s+${spelled}${end}`, "iu"),
    // B1 (the sibling app's flip-3 tester, 6 Nov 2026): the name given after the first reply — "name is <name>", "her name
    // is <name>", "it's <name>", "the employee is <name>".
    new RegExp(String.raw`(?:^|[\s,.])(?:(?:her|his|their)\s+)?name\s+is\s+${spelled}${end}`, "iu"),
    new RegExp(String.raw`(?:^|[\s,.])(?:it['’]?s|it\s+is|the\s+employee\s+is|this\s+is\s+for)\s+${spelled}${end}`, "iu"),
  ];
}

/** "use <name>": the manager says which name to use. */
const USE_NAME = /^use\s+/i;

/** "zebulon marchbanks" → "Zebulon Marchbanks"; a word already capitalised is kept. */
function titleCased(name: string): string {
  return name.replace(/(^|[\s'’-])(\p{Ll})/gu, (_whole, lead: string, letter: string) => `${lead}${letter.toUpperCase()}`);
}

/** OFF_ROSTER_CONFIRM_ENABLED: the offer right after the not-found note about this name (or first, with none). */
function withOffRosterOffer(content: string, name: string): string {
  if (content.includes(offRosterOffer(name))) return content;
  const note = `I couldn't find **${name}** in the Woven roster, so that name is not on the form.`;
  return content.includes(note) ? content.replace(note, `${note} ${offRosterOffer(name)}`) : `${offRosterOffer(name)}\n\n${content.trim()}`;
}

/**
 * ROSTER_NEAR_MISS_ENABLED (port from the sibling app; QA's live run there, 5 Nov 2026, mgr-1-off-roster-name):
 * "I need a corrective action verbal for <name>. This is for Under Performance …" with the name on no roster got
 * an empty card and "Who is this form for? Tell me the employee's full name." — never that the typed name was not
 * found, so the manager retypes it. Checked here with the flip's flags: the same. When the request's "for <Name>"
 * is nobody's roster spelling and close to nobody, the empty card's reply opens with "I couldn't find **<name>**
 * in the Woven roster, so that name is not on the form." (the scrub keeps that line); the name is said nowhere
 * else. A metric or a form's name is never the request's name (`slotName`).
 */
function withNotFoundNote(content: string, typed: string | null, names: readonly string[]): string {
  // B1 (the sibling app's flip-3 tester, 6 Nov 2026): a company position title is never a person said back as not found.
  if (typed && namesCompanyPositionTitle(typed)) return content;
  // QA, 7 Nov 2026: the company's own name or initials ("… a requirement for <initials>.") is never a person said back as not found.
  if (typed && namesThisCompany(typed)) return content;
  if (!typed || /I couldn['’]t find \*\*/.test(content) || oneCloseRosterPerson(typed, names)) return content;
  return `I couldn't find **${typed}** in the Woven roster, so that name is not on the form.\n\n${content.trim()}`;
}

/**
 * The name the not-found note is about. ROSTER_NOT_FOUND_ANY_PHRASING_ENABLED (QA-A/QA-B, the re-flip's live
 * testers, 5 Nov 2026): also "employee, <Name>" ("i have an employee, <Name> that needs …") and "for <Name>"
 * ending the message, each name word Title Case, never a roster spelling or a form's name. Off: the
 * "for <Name>," / "for <Name>." slot only.
 */
function notFoundName(message: string | undefined, names: readonly string[]): string | null {
  const slot = slotName(message, names);
  if (slot || !rosterNotFoundAnyPhrasingEnabled() || !message) return slot;
  // QA-A ("i have an employee, <Name> that needs…") and QA-B ("… for <Name>" ending the message) only;
  // each word Title Case, so all-caps runs ("BY CORIN BELLWEATHER") and lowercase words ("ima employee") never qualify.
  const word = String.raw`\p{Lu}\p{Ll}[\p{Ll}'’-]*`;
  const name = String.raw`(${word}(?:\s+${word}){1,2})`;
  const found =
    new RegExp(String.raw`\bemployee,?\s+${name}(?=[\s,.!?]|$)`, "u").exec(message)?.[1] ??
    new RegExp(String.raw`\bfor\s+${name}\s*[.!]?\s*$`, "u").exec(message.trim())?.[1];
  return found && !rosterSpelling(found, names) && !namesAForm(found) ? found : null;
}

/** The person the reply says it drafts for: "I'll draft a **Corrective Action Form** for **<name>**". */
export function draftedFor(content: string): string[] {
  return [...content.matchAll(/\b(?:draft|create|put)\b[^\n.]*?\*\*[^*]+\*\* for \*\*([^*]+)\*\*/gi)].map((match) => match[1]!.trim());
}

/** The name the request put straight after "for" ("create a CA for <Name>, …"), when it is nobody's roster spelling; or null. */
export function slotName(message: string | undefined, names: readonly string[]): string | null {
  const named = message ? /\bfor\s+(\p{Lu}[\p{L}'’-]+(?:\s+\p{Lu}[\p{L}'’-]+){0,2})\s*[,.]/u.exec(message)?.[1] : undefined;
  // A form's name is never the person: "a corrective action for Coaching Form." (the sibling app's pre-check, 5 Nov 2026).
  return named && !rosterSpelling(named, names) && !namesAForm(named) ? named : null;
}

/** FORM_NAME_FROM_ROSTER_ENABLED: `rosterOnlyNames` with the actor's roster read this turn. Off, or no roster: as built. */
export function withRosterOnlyNames(response: AskResponse): AskResponse {
  // METRIC_GUARD_ENABLED: with FORM_NAME off, the choices still never offer a metric (`withoutMetricChoices`).
  if (!formNameFromRosterEnabled()) return metricGuardEnabled() ? withoutMetricChoices(response, metricMessage(), personRosterNames() ?? []) : response;
  const names = personRosterNames();
  if (!names || names.length === 0) return response;
  return rosterOnlyNames(response, names, requestMessage());
}

/**
 * METRIC_GUARD_ENABLED (the sibling app's LIVE=1, 5 Nov 2026, the smaller set: CA_SALES + REPLY_MATCHES_CARD
 * + TITLE, 3/3 runs). "I need a corrective action verbal for <first name> <last initial>. This is for Under
 * Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %." replied "Which of them is this Corrective
 * Action Form for — **Club Close**, **<first name>** or **Under**?". Every guard that rules a metric out
 * (`request-slot.ts` outsideRequestSlot, `answer-not-a-name.ts`) is behind FORM_NAME_FROM_ROSTER_ENABLED; this
 * runs on the final reply whatever FORM_NAME says. A choice of "Which of them … — A, B or C?" or "Is this for
 * **X**?" whose every word is an item of the request's capitalised list ("Club Close") or of a "for <offense>"
 * phrase ("Under Performance") is never offered; a roster person is always kept. One choice left is asked
 * "Is this for **<them>**?" (their roster name when one roster person has that first name), none asks who.
 * Pure; no message, as built.
 */
export function withoutMetricChoices(response: AskResponse, message: string | undefined, names: readonly string[]): AskResponse {
  if (!message) return response;
  const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}'’]+/gu) ?? [];
  const isMetric = (name: string) => {
    if (rosterSpelling(name, names)) return false;
    // CHAT_GLOSSARY_ENABLED: an approved term ("MSB") is never a person, wherever the message put it.
    if (isGlossaryTerm(name)) return true;
    // The same rule as the name readers' (`request-slot.ts` namesAMetric): a list item, a "… %" phrase, an offense word.
    return namesAMetric(name, message);
  };
  const asked = (name: string) => {
    const byFirst = names.filter((roster) => words(roster)[0] === words(name)[0]);
    return `Is this for **${rosterSpelling(name, names) ?? (words(name).length === 1 && byFirst.length === 1 ? byFirst[0] : name)}**?`;
  };
  // METRIC_CHOICE_ONE_QUESTION_ENABLED: the question's own "Tell me and I'll …" after it on the same line is read with it.
  const oneQuestion = metricChoiceOneQuestionEnabled();
  const CHOICE = oneQuestion
    ? /Which of them is this ((?:\*\*[^*]+\*\* )?)for\s*[—–-]\s*([^?\n]+)\?([ \t]+Tell me\b[^\n]*)?/g
    : /Which of them is this ((?:\*\*[^*]+\*\* )?)for\s*[—–-]\s*([^?\n]+)\?/g;
  let content = response.content.replace(CHOICE, (whole, form: string, list: string, tail: string | undefined) => {
    const all = listedNames(list);
    const kept = all.filter((name) => !isMetric(name));
    if (kept.length === all.length) return whole;
    const keptTail = oneQuestion ? (tail ?? "") : "";
    if (kept.length >= 2) return `Which of them is this ${form}for — ${said(kept)}?${keptTail}`;
    return kept.length === 1 ? `${asked(kept[0]!)}${keptTail}` : ASK_WHO;
  });
  content = content.replace(/Is this for \*\*([^*]+)\*\*\?/g, (whole, name: string) => (isMetric(name) ? ASK_WHO : whole));
  return content === response.content ? response : { ...response, content };
}
