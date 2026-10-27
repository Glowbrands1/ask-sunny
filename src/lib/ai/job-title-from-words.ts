import { jobTitleAppositionEnabled, jobTitleFromWordsEnabled } from "@/lib/config/chat-quality-flags";

import type { AskRequest, AskResponse } from "./types";

/**
 * JOB_TITLE_FROM_WORDS_ENABLED (ported from Ask Bubbles, QA item 3, 27 Oct
 * 2026): "<name> was a <title> at <salon> location" left the exit form's Job
 * Title empty when the title is not one of this company's — the title reader
 * knows only those. With the flag on, a title the manager typed in "<who> is /
 * was a <title>" or "position is <title>" is the card's Job Title, as typed.
 * (Ask Bubbles also asks for the position once; this app has no position
 * question, so only the fill is ported.)
 *
 * Only an empty Job Title is filled: a title from the directory or this
 * company's list stays as the card has it. After the reply is built, outside
 * the proposal flow.
 */

/** Ends in a word that names a job, so "was a no call no show" is not a title. */
const ROLE_NOUN =
  /\b(?:associate|consultant|lead|manager|director|maker|member|cashier|supervisor|keyholder|key\s+holder|trainee|specialist|assistant|clerk|representative|rep|coordinator|stylist|technician|attendant|host|agent|trainer)$/i;
const IS_A = (who: string) =>
  new RegExp(`\\b(?:she|he|they|${who})\\s+(?:is|was|works\\s+as|worked\\s+as)\\s+(?:an?|our|the)\\s+((?:[a-z][a-z'’-]*\\s+){0,3}[a-z][a-z'’-]*)`, "gi");
/** JOB_TITLE_APPOSITION_ENABLED: "<name>, tan consultant at manhattan", the title set off by a comma right after the name (QA S12). */
const APPOSITION = (who: string) =>
  new RegExp(`\\b(?:${who}),\\s+((?:[a-z][a-z'’-]*\\s+){0,3}[a-z][a-z'’-]*)`, "gi");
const LABELED = /\b(?:job\s+title|position|title|role)\s*(?:is|was|:|-)\s*(?:an?\s+|the\s+)?((?:[a-z][a-z'’-]*\s+){0,3}[a-z][a-z'’-]*)/gi;
const STOP_AFTER = /\s+(?:at|in|for|from|on|and|who|that|with|since)\b.*$/i;

function titleCase(phrase: string): string {
  return phrase
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The last job title the manager typed for this employee in their own turns, or null. */
export function typedJobTitle(turns: readonly string[], name: string): string | null {
  const parts = name.trim().split(/\s+/).map(escaped);
  const who = [parts.join("\\s+"), parts[0]].filter(Boolean).join("|");
  let found: string | null = null;
  for (const turn of turns) {
    for (const pattern of [IS_A(who), ...(jobTitleAppositionEnabled() ? [APPOSITION(who)] : []), LABELED]) {
      for (const match of turn.matchAll(pattern)) {
        const phrase = match[1]!.replace(STOP_AFTER, "").trim();
        if (ROLE_NOUN.test(phrase)) found = titleCase(phrase);
      }
    }
  }
  return found;
}

type Turn = { readonly role: string; readonly content: string };

export function withJobTitleFromWords(response: AskResponse, request: AskRequest): AskResponse {
  if (!jobTitleFromWordsEnabled()) return response;
  const proposal = response.formProposal;
  if (!proposal?.employeeName || proposal.subject === "team" || proposal.employeeRole) return response;
  const history = (request.history ?? []) as readonly Turn[];
  const managerTurns = [...history.filter((turn) => turn.role === "user").map((turn) => turn.content), request.question];
  const title = typedJobTitle(managerTurns, proposal.employeeName);
  if (!title) return response;
  return { ...response, formProposal: { ...proposal, employeeRole: title } };
}
