import { PRODUCTION_SALONS, salonById } from "@/data/salons";
import { formEditDateRulesEnabled } from "@/lib/config/chat-quality-flags";
import { datesInText, listIncidentDates, priorSteps } from "@/lib/forms/form-date-answer";
import { withYearlessDatesWritten } from "@/lib/forms/late-open";
import { readSalonMentions } from "@/lib/forms/salon-mention";
import type { ChatFormProposal, SourceCitation } from "@/types";

import { newRequestWithOwnDate } from "./new-request-own-date";
import type { AskResponse } from "./types";

/**
 * ============================================================================
 * EDITS ARE APPLIED OR ANSWERED; DATES FOLLOW THE INCIDENT
 * ============================================================================
 *
 * FORM_EDIT_DATE_RULES_ENABLED (QA history replay on prod 20120d7, 25 Oct 2026).
 *
 * THREE KINDS OF EDIT, KEPT APART.
 *   replace  "change observation of offense to: <text>" — the Observation is
 *            exactly <text> (S22, conv_mvnszqiq28bgs9z).
 *   add      "add that she was also on her phone", "also add …" — the clause
 *            is appended in the manager's words, and the reply says so (B17).
 *   anything else that talks to the app — "can you clean up my grammar"
 *            (S12), "change salon location to omaha center" (G12), "can you
 *            reference the late opening policy INSTEAD of the attendance
 *            policy" (d), "can you edit the form I already finalized" (S21) —
 *            never touches the Observation. Each is applied to its own field
 *            by its own reader, or answered.
 *
 * DATES.
 *   A prior action's date ("previous coaching jba manual 9-9-26", "verbal
 *   (06/25/2026)", "she was coached on 9-15") is never the form's Date (Q7,
 *   H8) and never its Follow-up (B-list). The Date is the current incident's,
 *   or today when the manager typed "today" (H8, B15). Follow-up is set only
 *   from a follow-up or review phrase ("follow up on 11-4-26").
 *
 * Pure: the caller decides when the flag applies.
 */

/* ------------------------------------------------------------------ edits -- */

/** "ok,", "please", "can you", "could you please" before the instruction itself. */
const LEAD = /^\s*(?:(?:ok(?:ay)?|yes|great|thanks|and|also|now|so)\b[,.!]?\s*)*(?:(?:please|pls)\s+)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)?(?:(?:please|pls)\s+)?/i;

const OBSERVATION_FIELD = String.raw`(?:the\s+)?(?:observation(?:\s+of\s+(?:the\s+)?offen[cs]e)?|what\s+happened|offen[cs]e\s+description|description(?:\s+of\s+(?:the\s+)?offen[cs]e)?|narrative)`;

const REPLACE = [
  new RegExp(
    String.raw`^(?:change|update|set|edit|make|rewrite|reword)\s+${OBSERVATION_FIELD}\s+(?:to(?:\s+(?:say|read))?|so\s+(?:that\s+)?it\s+(?:says|reads)|as|with|into)\s*[:\-–—]?\s*([\s\S]+)$`,
    "i",
  ),
  new RegExp(String.raw`^replace\s+${OBSERVATION_FIELD}\s+with\s*[:\-–—]?\s*([\s\S]+)$`, "i"),
  new RegExp(String.raw`^${OBSERVATION_FIELD}\s+(?:should|must|needs?\s+to)\s+(?:say|read|be)\s*[:\-–—]?\s*([\s\S]+)$`, "i"),
];

const ADD = [
  new RegExp(String.raw`^(?:also\s+)?add\s+to\s+${OBSERVATION_FIELD}\s*(?:that\b)?\s*[:\-–—]?\s*([\s\S]+)$`, "i"),
  /^(?:also\s+)?add\s+(?:in\s+)?that\s+([\s\S]+)$/i,
  /^(?:also\s+)?add\s*[:\-–—]\s*([\s\S]+)$/i,
  /^also\s+add\s+(?!(?:the|a|an)\s+\S+\s+(?:polic(?:y|ies)|section|date|salon|location|title)\b)([\s\S]+)$/i,
];

/** A verb that tells the app to change, cite, remove or redo something. */
const INSTRUCTION = /^(?:change|update|edit|fix|correct|set|switch|replace|swap|reference|cite|use|add|remove|delete|take\s+(?:out|off)|drop|include|put\s+(?!together\b)|clean\s+up|rewrite|reword|redo|re-do|move|make\s+(?:the|it|this|that|her|his|my)\b)/i;

const GRAMMAR = /\b(?:grammar|grammatical(?:ly)?|spelling|spell[- ]?check|capitali[sz]\w*|proof-?read\w*|punctuation)\b/i;

/** The state sentences the intent read writes in front of the question. They are not the manager's. */
const STATE_LINE =
  /^(?:(?:The form is the|The employee is|Job title:|It happened (?:at|on)|Warning level:|Payroll deduct applies|No payroll deduction|Policy reference:|Incident:|Payroll amount:)(?:[^.\n]|\.(?=\d))*\.\s*)+$/;

/** The turn without the intent read's state sentences: what the manager typed. */
export function managerWords(turn: string): string {
  return (turn ?? "")
    .split("\n")
    .filter((line) => !STATE_LINE.test(line.trim()))
    .join("\n")
    .trim();
}

export type EditReading =
  | { readonly kind: "replace"; readonly text: string }
  | { readonly kind: "add"; readonly text: string }
  | { readonly kind: "grammar" }
  | { readonly kind: "instruction" }
  | null;

function stripLead(text: string): string {
  return text.replace(LEAD, "").trim();
}

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim().replace(/^["“']|["”']$/g, "").trim();
}

/** A whole turn's edit: replace or add read to the end of the turn, from the line that starts it. */
export function readTurnEdit(turn: string): EditReading {
  const lines = (turn ?? "").split("\n").map((line) => line.trim()).filter((line) => line && !STATE_LINE.test(line));
  for (const [index, line] of lines.entries()) {
    const body = [stripLead(line), ...lines.slice(index + 1)].join(" ");
    for (const pattern of REPLACE) {
      const text = pattern.exec(body)?.[1];
      if (text && clean(text)) return { kind: "replace", text: clean(text) };
    }
    for (const pattern of ADD) {
      const text = pattern.exec(body)?.[1];
      if (text && clean(text)) return { kind: "add", text: clean(text) };
    }
  }
  return null;
}

/** One sentence: a grammar request, another instruction to the app, or null when it is account. */
export function readSentenceEdit(sentence: string): EditReading {
  const text = sentence.trim();
  if (!text) return null;
  if (GRAMMAR.test(text) && /\b(?:clean|fix|correct|check|improve|make|changes?|tidy|help|rewrite|reword|capitali[sz]\w*|proof-?read)\b/i.test(text)) {
    return { kind: "grammar" };
  }
  const body = stripLead(text);
  if (INSTRUCTION.test(body)) return { kind: "instruction" };
  /* "can you edit the form I already finalized for X?" is asked, not described. */
  if (/^(?:can|could|would|will)\s+you\b/i.test(text) && /\?\s*$/.test(text)) return { kind: "instruction" };
  return null;
}

function sentencesOf(turn: string): string[] {
  return turn
    .split(/\n+|(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

const OBSERVATION_LINE = "**Observation of Offense:**";

function observationOf(content: string): string | null {
  const found = content.split("\n").find((line) => line.trim().startsWith(OBSERVATION_LINE));
  return found ? found.trim().slice(OBSERVATION_LINE.length).trim() : null;
}

function withObservationText(content: string, text: string | null): string {
  const lines = content.split("\n").filter((line) => !line.trim().startsWith(OBSERVATION_LINE));
  let out = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (text && text.trim()) out = `${out}\n\n${OBSERVATION_LINE} ${text.trim()}`.trim();
  return out;
}

/**
 * The Observation line under the three edit kinds. `build` is the existing
 * reader (`withObservation` or `withAccount`), given only the turns that are
 * account: instruction and grammar sentences are taken out, a replace sets the
 * text from that turn on, and an add is appended as written.
 */
export function observationByRules(
  content: string,
  turns: readonly string[],
  build: (content: string, turns: readonly string[]) => string,
): string {
  let literal: string | null = null;
  let account: string[] = [];
  const added: string[] = [];
  for (const turn of turns) {
    const edit = readTurnEdit(turn);
    if (edit?.kind === "replace") {
      literal = edit.text;
      account = [];
      added.length = 0;
      continue;
    }
    if (edit?.kind === "add") {
      added.push(edit.text);
      continue;
    }
    const kept = sentencesOf(turn).filter((sentence) => !STATE_LINE.test(sentence) && readSentenceEdit(sentence) === null);
    if (kept.length > 0) account.push(kept.join(" "));
  }
  const base = withObservationText(content, null);
  const built = build(base, account);
  let text = observationOf(built);
  let out = withObservationText(built, null);
  if (literal) text = [literal, text].filter(Boolean).join(" ");
  for (const clause of added) {
    if (text && text.toLowerCase().includes(clause.toLowerCase())) continue;
    text = text ? `${text}${/[.!?]$/.test(text) ? "" : "."} ${clause}` : clause;
  }
  out = withObservationText(out, text);
  return out;
}

/* ------------------------------------------------------------------ dates -- */

/** Words that open the earlier steps: "previous coaching", "prior CA", "was coached". */
const PRIOR_CUE =
  /\b(?:previous(?:ly)?|prior|past|earlier)\s+(?:coaching|coached|ca\b|c\/a|corrective|warnings?|actions?|write-?ups?|steps?|discipline|history)|\b(?:was|were|been|got|has\s+been|had\s+been)\s+(?:coached|warned|written\s+up)\b|\bhistory\b/i;
/** The step a date belongs to, straight before the date. */
const STEP_BEFORE =
  /\b(?:verbal|written|final|coaching|coached|ca|c\/a|corrective\s+action|warning|write-?up|manual|acknowledg\w*|review|signed|received|given)\b[^.!?\n\d]{0,12}?(?:\bon\s+|\bdated\s+|\bwas\s+)?\(?\s*$/i;
const COACHED_ON = /\b(?:coached|warned|written\s+up)\b[^.!?\n\d]{0,24}?\bon\s*$/i;
/** "jba manual 11-1-25": the policy manual acknowledgement is always an earlier step. */
const MANUAL_BEFORE = /\b(?:jba\s+(?:policy\s+)?manual|policy\s+manual|manual\s+ack\w*)\b[^.!?\n\d]{0,20}$/i;

/** Every date that belongs to an earlier step the manager listed. */
export function priorActionDates(text: string, today: string): Set<string> {
  const written = withYearlessDatesWritten(text ?? "", today);
  const prior = new Set(priorSteps(written, today).map((step) => step.iso));
  for (const turn of written.split("\n")) {
    const cue = PRIOR_CUE.exec(turn);
    for (const found of datesInText(turn, today)) {
      const before = turn.slice(Math.max(0, found.index - 40), found.index);
      if (COACHED_ON.test(before) || MANUAL_BEFORE.test(before)) prior.add(found.iso);
      else if (cue && found.index > cue.index && STEP_BEFORE.test(before)) prior.add(found.iso);
    }
  }
  return prior;
}

const FOLLOW_UP_BEFORE =
  /\b(?:follow[- ]?up|re-?review|review|check[- ]?in|check\s+back|revisit|re-?evaluat\w*|reassess\w*)\b[^.!?\n]{0,30}$/i;

/** Follow-up dates: only those a follow-up or review phrase gives. */
export function followUpDatesByRules(text: string, today: string): string[] {
  const written = withYearlessDatesWritten(text ?? "", today);
  const prior = priorActionDates(text, today);
  const out: string[] = [];
  for (const found of datesInText(written, today)) {
    const before = written.slice(Math.max(0, found.index - 40), found.index);
    if (!FOLLOW_UP_BEFORE.test(before) || /\bpolicy\s+review\b[^.!?\n]{0,30}$/i.test(before)) continue;
    if (prior.has(found.iso) || out.includes(found.iso)) continue;
    out.push(found.iso);
  }
  return out;
}

const TODAY_WORD = /\btoday\b/i;
const DATE_CHANGE = /\b(?:change|set|update|make|move|put)\b[^.\n]{0,30}?\bdate\b[^.\n]{0,20}?\bto\s+(?:be\s+)?([^\n]+)$|\b(?:form\s+)?date\s+(?:is|should\s+be|=|:)\s+([^\n]+)$/i;

/** The date this turn sets on purpose: "change the date to 10-22", "the date is today". */
export function dateSetInTurn(question: string, today: string): string | null {
  const match = DATE_CHANGE.exec(withYearlessDatesWritten(question ?? "", today));
  const rest = match?.[1] ?? match?.[2];
  if (!rest) return null;
  if (/^\s*today\b/i.test(rest)) return today;
  return datesInText(rest, today)[0]?.iso ?? null;
}

/** Forms whose Date is the incident's. The exit form and the employment changes keep their own. */
const DATED_BY_INCIDENT = new Set(["dpoa", "coaching", "follow-up-coaching", "policy-review"]);

/**
 * The form's Date under the rules. Undefined leaves the card's own date.
 * A date set on purpose wins; a prior step's date is replaced by the single
 * current incident date, or by today when "today" was typed; with no date on
 * the card those fill it.
 */
export function formDateByRules(input: {
  readonly managerTurns: readonly string[];
  readonly question: string;
  readonly today: string;
  readonly current: string | null;
}): string | null | undefined {
  const set = dateSetInTurn(input.question, input.today);
  if (set) return set === input.current ? undefined : set;
  const text = input.managerTurns.join("\n");
  const prior = priorActionDates(text, input.today);
  const written = withYearlessDatesWritten(text, input.today);
  const incidents = [...new Set(listIncidentDates(written, input.today).map((found) => found.iso))].filter((iso) => !prior.has(iso));
  const fallback = incidents.length === 1 ? incidents[0]! : incidents.length === 0 && TODAY_WORD.test(text) ? input.today : null;
  if (input.current && !prior.has(input.current)) return undefined;
  if (input.current) return fallback;
  return fallback ?? undefined;
}

function slash(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${Number(month)}/${Number(day)}/${year}`;
}

const FIELD_ORDER = ["**Follow-up:**", "**Job title:**", "**Payroll deduction:**", "**Observation of Offense:**", "**Action Plan:**"];

function insertLine(content: string, line: string, before: readonly string[]): string {
  const lines = content.split("\n");
  const at = lines.findIndex((entry) => before.some((label) => entry.trim().startsWith(label)));
  if (at < 0) return `${content.trim()}\n\n${line}`.trim();
  lines.splice(at, 0, line, "");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

function withoutLines(content: string, test: (line: string) => boolean): string {
  return content
    .split("\n")
    .filter((line) => !test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** "You mentioned more than one date (**6/25**, **7/28**) …" — dropped when the prior steps leave one or none. */
function withoutPriorDateQuestion(content: string, prior: ReadonlySet<string>): string {
  const priorDays = new Set([...prior].map((iso) => slash(iso).replace(/\/\d{4}$/, "")));
  return content
    .split("\n\n")
    .filter((paragraph) => {
      const asked = /^You mentioned more than one date \(([^)]*)\)/.exec(paragraph.trim());
      if (!asked) return true;
      const days = [...asked[1]!.matchAll(/\*\*(\d{1,2}\/\d{1,2})\*\*/g)].map((match) => match[1]!);
      return days.filter((day) => !priorDays.has(day)).length > 1;
    })
    .join("\n\n");
}

/* ----------------------------------------------------------------- salons -- */

const SALON_EDIT =
  /\b(?:change|switch|update|set|move|correct|fix)\s+(?:the\s+)?(?:salon|location|store)(?:\s+(?:location|name))?\s+(?:from\s+[^.\n]+?\s+)?to\s+([^.\n]+)|\b(?:the\s+)?(?:salon|location)\s+(?:is|should\s+be)\s+([^.\n]+)/i;

const SMALL_WORDS = new Set(["the", "and", "salon", "location", "store", "ne", "ks", "mo", "ia", "sd"]);

/** The salon "change salon location to omaha center" names, by its words. */
export function salonSetInTurn(turn: string): string | null {
  const match = SALON_EDIT.exec(turn ?? "");
  const named = (match?.[1] ?? match?.[2])?.trim().replace(/\s+(?:location|salon)$/i, "");
  if (!named) return null;
  const ids = [...new Set(readSalonMentions(`at ${named}`).flatMap((mention) => mention.salonIds))];
  if (ids.length === 1) return ids[0]!;
  const words = named.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3 && !SMALL_WORDS.has(word));
  if (words.length === 0) return null;
  const hits = PRODUCTION_SALONS.filter((salon) => {
    const own = new Set(salon.name.toLowerCase().split(/[^a-z0-9]+/));
    return words.every((word) => own.has(word));
  });
  return hits.length === 1 ? hits[0]!.id : null;
}

/** The newest salon edit, unless a later turn names a salon of its own. */
function salonByEdit(turns: readonly string[]): string | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]!;
    const set = salonSetInTurn(turn);
    if (set) return set;
    if (readSalonMentions(turn).some((mention) => mention.salonIds.length === 1)) return null;
  }
  return null;
}

/* --------------------------------------------------------------- policies -- */

const EXCLUDE_BEFORE = String.raw`(?:instead\s+of|rather\s+than|in\s+place\s+of|replac(?:e|ing)|remov(?:e|ing)|take\s+(?:off|out)|drop|swap\s+out|not)\s+(?:the\s+|our\s+|that\s+)?`;

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** "the late opening policy INSTEAD of the attendance policy": Attendance is not cited. */
export function excludedHeadings(turns: readonly string[], headings: readonly string[]): string[] {
  const out: string[] = [];
  for (const heading of headings) {
    const name = escape(heading.replace(/\s+policy$/i, "").trim()).replace(/\s+/g, "\\s+");
    if (!name) continue;
    const named = new RegExp(String.raw`\b${name}\b`, "i");
    const excluded = new RegExp(String.raw`${EXCLUDE_BEFORE}${name}\b`, "i");
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index]!;
      if (!named.test(turn)) continue;
      if (excluded.test(turn)) out.push(heading);
      break;
    }
  }
  return out;
}

function citationHeading(citation: SourceCitation): string {
  return citation.excerpt.split(".")[0]?.trim() ?? "";
}

function withoutPolicies(response: AskResponse, turns: readonly string[]): AskResponse {
  const lineHeadings = [...response.content.matchAll(/^(.+?) Policy, JBA Policy Manual\b/gim)].map((match) => match[1]!.trim());
  const candidates = [...new Set([...lineHeadings, ...(response.citations ?? []).map(citationHeading)].filter(Boolean))];
  const excluded = excludedHeadings(turns, candidates);
  if (excluded.length === 0) return response;
  const keys = new Set(excluded.map((heading) => heading.toLowerCase()));
  let content = withoutLines(response.content, (line) => {
    const heading = /^(.+?) Policy, JBA Policy Manual\b/i.exec(line)?.[1]?.trim().toLowerCase();
    return Boolean(heading && keys.has(heading));
  });
  content = content.replace(/(Management will review the )(.+?)( polic(?:y|ies))( with)/, (whole, lead: string, list: string, _noun: string, tail: string) => {
    const kept = list
      .split(/\s*,\s*|\s+and\s+/)
      .map((item) => item.trim())
      .filter((item) => item && !keys.has(item.toLowerCase()));
    if (kept.length === 0 || kept.length === list.split(/\s*,\s*|\s+and\s+/).length) return whole;
    const joined = kept.length === 1 ? kept[0]! : `${kept.slice(0, -1).join(", ")} and ${kept[kept.length - 1]}`;
    return `${lead}${joined}${kept.length === 1 ? " policy" : " policies"}${tail}`;
  });
  const citations = (response.citations ?? []).filter((citation) => !keys.has(citationHeading(citation).toLowerCase()));
  return { ...response, content, citations };
}

/* ------------------------------------------------------------ the answer -- */

export const GRAMMAR_ANSWER =
  "I can't rewrite your wording for grammar here, so **Observation of Offense** keeps your words as you typed them — I won't add or change any facts. You can correct spelling and capitals on the form before you finalize it.";

function editAnswer(question: string, content: string): string | null {
  const turn = readTurnEdit(question);
  if (turn?.kind === "replace") return "**Observation of Offense** now reads exactly as you wrote it.";
  if (turn?.kind === "add") return `Added to **Observation of Offense**, in your words: "${turn.text}"`;
  if (sentencesOf(question).some((sentence) => readSentenceEdit(sentence)?.kind === "grammar")) {
    return content.includes(GRAMMAR_ANSWER) ? null : GRAMMAR_ANSWER;
  }
  return null;
}

/**
 * The card under the rules: the Date, the Follow-up lines, the date question,
 * the salon an edit set, a policy the manager said not to use, and a line
 * saying what an edit did. Off, the response is returned as it came.
 */
export function applyEditDateRules(
  response: AskResponse,
  input: {
    readonly question: string;
    readonly history: readonly { readonly role: string; readonly content: string }[];
    readonly today: string;
  },
): AskResponse {
  const proposal = response.formProposal;
  if (!formEditDateRulesEnabled() || !proposal) return response;
  const question = managerWords(input.question);
  const turns = [...input.history.filter((turn) => turn.role === "user").map((turn) => managerWords(turn.content)), question].filter(
    (turn) => turn.trim(),
  );
  const text = turns.join("\n");
  let next: ChatFormProposal = proposal;
  let content = response.content;

  if (DATED_BY_INCIDENT.has(proposal.templateKey)) {
    const prior = priorActionDates(text, input.today);
    content = withoutPriorDateQuestion(content, prior);
    // NEW_REQUEST_OWN_DATE_ENABLED: a new create request with its own date is dated by itself, not by the form before it.
    const dateTurns = newRequestWithOwnDate(question, input.today) ? [question] : turns;
    const date = formDateByRules({ managerTurns: dateTurns, question, today: input.today, current: proposal.formDate ?? null });
    if (date !== undefined && date !== proposal.formDate) next = { ...next, formDate: date };
    content = withoutLines(content, (line) => line.startsWith("**Date:**"));
    if (next.formDate) content = insertLine(content, `**Date:** ${slash(next.formDate)}`, FIELD_ORDER);
    content = withoutLines(content, (line) => line.startsWith("**Follow-up:**"));
    for (const iso of followUpDatesByRules(text, input.today).filter((iso) => iso !== next.formDate)) {
      content = insertLine(content, `**Follow-up:** ${slash(iso)}`, FIELD_ORDER.slice(1));
    }
  }

  const salon = salonByEdit(turns);
  if (salon && salonById(salon) && next.locationId !== salon) {
    next = {
      ...next,
      locationId: salon,
      locationName: salonById(salon)?.name ?? next.locationName ?? null,
      locationResolution: "resolved",
      status: next.employeeName ? "ready" : next.status,
    };
    content = withoutLines(content, (line) => /which salon is this about|choose the salon below/i.test(line));
    if (salonSetInTurn(question) === salon) {
      content = insertLine(content, `**Salon:** ${salonById(salon)!.name}, as you said.`, ["**Date:**", ...FIELD_ORDER]);
    }
  }

  let out: AskResponse = next === proposal && content === response.content ? response : { ...response, content, formProposal: next };
  out = withoutPolicies(out, turns);
  const said = editAnswer(question, out.content);
  if (said) out = { ...out, content: insertLine(out.content, said, ["**Date:**", ...FIELD_ORDER]) };
  return out;
}

/* ---------------------------------------------- the remap path (off here) -- */

/** "… INSTEAD of the attendance policy": the policy set aside, taken out before the sections are read. */
const SET_ASIDE_POLICY =
  /\b(?:instead\s+of|rather\s+than|in\s+place\s+of|replac(?:e|ing)|remov(?:e|ing)|take\s+(?:off|out)|drop|swap\s+out)\s+(?:the\s+|our\s+|that\s+)?[a-z/' -]{2,40}?\s+polic(?:y|ies)\b/gi;

export function withoutSetAsidePolicies(text: string): string {
  return (text ?? "").replace(SET_ASIDE_POLICY, " ");
}

/** The remap path's answer to "clean up my grammar" (its card says What happened). */
const REMAP_GRAMMAR_ANSWER =
  "I can't rewrite your wording for grammar here, so **What happened** keeps your words as you typed them — I won't add or change any facts. You can correct spelling and capitals on the form before you finalize it.";

/** The line that says what an edit in this turn did to What happened, or null. */
export function remapEditLine(question: string): string | null {
  const turn = readTurnEdit(question);
  if (turn?.kind === "replace") return "**What happened** now reads exactly as you wrote it.";
  if (turn?.kind === "add") return `Added to **What happened**, in your words: "${turn.text}"`;
  if (sentencesOf(question).some((sentence) => readSentenceEdit(sentence)?.kind === "grammar")) return REMAP_GRAMMAR_ANSWER;
  return null;
}

/**
 * What happened under the three edit kinds. `current` is what the remap read;
 * `reread` reads the account again from the manager's turns with every edit
 * and instruction taken out. A replace sets the text; an add is appended as
 * written; a value that came out of an instruction is read again.
 */
export function remapObservation(input: {
  readonly users: readonly string[];
  readonly current: string | null;
  readonly reread: (said: string) => string | null;
}): string | null {
  let literal: string | null = null;
  const added: string[] = [];
  const account: string[] = [];
  const edits: string[] = [];
  for (const turn of input.users) {
    const edit = readTurnEdit(turn);
    if (edit?.kind === "replace") {
      literal = edit.text;
      added.length = 0;
      account.length = 0;
      edits.push(turn);
      continue;
    }
    if (edit?.kind === "add") {
      added.push(edit.text);
      edits.push(turn);
      continue;
    }
    const kept: string[] = [];
    for (const sentence of sentencesOf(turn)) {
      if (readSentenceEdit(sentence) === null) kept.push(sentence);
      else edits.push(sentence);
    }
    if (kept.length > 0) account.push(kept.join(" "));
  }
  const norm = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
  let text = input.current;
  if (literal) text = literal;
  else if (text) {
    const value = norm(text);
    const fromEdit = edits.some((edit) => norm(edit).includes(value));
    const inAccount = account.some((turn) => norm(turn).includes(value));
    if (fromEdit && !inAccount) text = input.reread(account.join("\n"));
  }
  for (const clause of added) {
    if (text && norm(text).includes(norm(clause))) continue;
    text = text ? `${text}${/[.!?]$/.test(text) ? "" : "."} ${clause}` : clause;
  }
  return text;
}
