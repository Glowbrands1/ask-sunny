import { formNameFromRosterEnabled, rosterNearMissEnabled } from "@/lib/config/chat-quality-flags";
import type { AskResponse } from "@/lib/ai/types";

import { HAS_EMPLOYEE_AND_PLACE, SAYS_READY } from "@/lib/ai/ca-what-happened";

import { matchEmployeeName, normalizeTypedName, type RosterEmployee } from "./employee-match";
import { personRosterNames } from "./person-guard";
import { requestMessage } from "./request-slot";

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

  const employee = proposal?.employeeName?.trim() ?? "";
  if (proposal && employee && proposal.subject !== "team") {
    const spelled = rosterSpelling(employee, names);
    if (spelled) {
      if (spelled !== employee) {
        proposal = { ...proposal, employeeName: spelled };
        content = content.split(`**${employee}**`).join(`**${spelled}**`);
      }
    } else {
      const close = oneCloseRosterPerson(employee, names);
      /*
       * ROSTER_NEAR_MISS_ENABLED (QA's testers, 5 Nov 2026, R3): a near-miss of
       * one roster person is asked exactly as a first name typed alone is
       * (`ai/first-name-suggest.ts`): only the question, the card waits, and the
       * answer ("yes", the name) is read by that machinery as the request with
       * the roster's name in full.
       */
      if (rosterNearMissEnabled() && close) {
        return { ...response, content: `Is this for **${close}**? Tell me if that should change.`, formProposal: undefined };
      }
      proposal = { ...proposal, employeeName: null, status: "needs_employee" };
      // The reply never drafts for a name that is not on the card.
      content = content.replace(new RegExp(String.raw`\s+for\s+\*\*${escape(employee)}\*\*`, "g"), "").split(`**${employee}**`).join("the employee");
      ask = close ? `Is this for **${close}**?` : ASK_WHO;
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
      );
      if (!ask && !ASKS_WHO.test(content) && !ASKS_A_CHOICE.test(content)) ask = ASK_WHO;
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

  // "Which of them is this … for — A, B or C?": roster people only.
  content = content.replace(/Which of them is this ((?:\*\*[^*]+\*\* )?)for\s*[—–-]\s*([^?\n]+)\?/g, (whole, form: string, list: string) => {
    const kept = [...new Set(listedNames(list).map((name) => rosterSpelling(name, names)).filter((name): name is string => Boolean(name)))];
    if (kept.length >= 2) return `Which of them is this ${form}for — ${said(kept)}?`;
    if (kept.length === 1) return kept[0] === onCard ? "" : `Is this for **${kept[0]}**?`;
    return onCard ? "" : ASK_WHO;
  });
  // "Is this for X?": a roster person only.
  content = content.replace(/Is this for \*\*([^*]+)\*\*\?/g, (whole, name: string) => {
    if (rosterSpelling(name, names)) return whole;
    const close = oneCloseRosterPerson(name, names);
    return close ? `Is this for **${close}**?` : onCard ? "" : ASK_WHO;
  });

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
export const ASKS_A_CHOICE = /Did you mean|Which of them|Is this for \*\*/;

export function withoutUnseatedName(content: string, typed: readonly (string | null)[], names: readonly string[], drafted: readonly string[] = []): string {
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
      for (const pattern of [...whole, ...single]) next = next.replace(pattern, "the employee");
      next = next.replace(/(^|[.!?]\s+|\*\*\s*)the employee/g, (_all, lead: string) => `${lead}The employee`);
      return next.replace(/\u0000(\d+)\u0000/g, (_all, index: string) => kept[Number(index)]!);
    })
    .join("\n");
}

/** The person the reply says it drafts for: "I'll draft a **Corrective Action Form** for **<name>**". */
export function draftedFor(content: string): string[] {
  return [...content.matchAll(/\b(?:draft|create|put)\b[^\n.]*?\*\*[^*]+\*\* for \*\*([^*]+)\*\*/gi)].map((match) => match[1]!.trim());
}

/** The name the request put straight after "for" ("create a CA for <Name>, …"), when it is nobody's roster spelling; or null. */
export function slotName(message: string | undefined, names: readonly string[]): string | null {
  const named = message ? /\bfor\s+(\p{Lu}[\p{L}'’-]+(?:\s+\p{Lu}[\p{L}'’-]+){0,2})\s*[,.]/u.exec(message)?.[1] : undefined;
  return named && !rosterSpelling(named, names) ? named : null;
}

/** FORM_NAME_FROM_ROSTER_ENABLED: `rosterOnlyNames` with the actor's roster read this turn. Off, or no roster: as built. */
export function withRosterOnlyNames(response: AskResponse): AskResponse {
  if (!formNameFromRosterEnabled()) return response;
  const names = personRosterNames();
  if (!names || names.length === 0) return response;
  return rosterOnlyNames(response, names, requestMessage());
}
