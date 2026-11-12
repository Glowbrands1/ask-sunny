import type { AskResponse } from "@/lib/ai/types";
import { futureIncidentDateAskEnabled } from "@/lib/config/chat-quality-flags";

import { explicitFormDate } from "./form-date-answer";
import { FUTURE_DATE_TAG, futureDateQuestion } from "./incident-dates";

/**
 * ============================================================================
 * A CARD IS NEVER DATED AFTER TODAY (FUTURE_INCIDENT_DATE_ASK_ENABLED; S#285 / #207 BH5, rebuilt 10 Nov 2026)
 * ============================================================================
 *
 * QA, 26 Oct 2026 (U4): a written CA "for not attending the monthly meeting on 12-20-26", written on 10/25, was
 * accepted, dated 12/20/2026. `decideFormDate` asks about a future incident date on the proposal, but with
 * production's flags several later steps read the card's date from the manager's words again (the intent read's
 * saved state, `enrichFormCard`, `holdFilledSlots`, `applyEditDateRules`) and put 12/20/2026 back.
 *
 * This is the last word on the turn's card: a date after today is taken off it (the form is dated the day it is
 * created), and the question is asked — once in the conversation. A date the manager gave the form itself ("dated
 * 12/20") is kept, as `decideFormDate` keeps it. Off, the response is returned as it came.
 */
/*
 * Port from Ask Bubbles (Gate-Bubbles-5, G5-743, 12 Nov 2026): the answer to this flag's own question ("it was 10-20-26")
 * was glued onto the Observation ("… on 12-20-26 it was 10-20-26"). A turn that only gives a day is the date, never part
 * of the account; the date readers still read it. The callers check the flag.
 */
const DAY = String.raw`(?:\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?|today|yesterday)`;
const BARE_DATE_ANSWER = new RegExp(
  String.raw`^\s*(?:(?:it|that|this|the\s+(?:incident|meeting|date|day))\s+(?:was|happened|is)\s+)?(?:on\s+)?(?:the\s+)?${DAY}\s*[.!]?\s*$`,
  "i",
);

export function isBareDateAnswer(text: string): boolean {
  return BARE_DATE_ANSWER.test(text);
}

export function withoutFutureCardDate(
  response: AskResponse,
  input: {
    readonly question: string;
    readonly history: readonly { readonly role: string; readonly content: string }[];
    readonly today: string;
  },
): AskResponse {
  const proposal = response.formProposal;
  const date = proposal?.formDate ?? null;
  if (!futureIncidentDateAskEnabled() || !proposal || !date || date <= input.today) return response;
  const said = [...input.history.filter((turn) => turn.role === "user").map((turn) => turn.content), input.question].join("\n");
  if (explicitFormDate(said, input.today) === date) return response;
  const lines = response.content.split("\n").filter((line) => !line.startsWith("**Date:**"));
  let content = lines.join("\n").replace(/\n{3,}/g, "\n\n");
  const asked = input.history.some((turn) => turn.role === "assistant" && turn.content.includes(FUTURE_DATE_TAG));
  if (!asked && !content.includes(FUTURE_DATE_TAG)) content = `${content.trimEnd()}\n\n${futureDateQuestion(date, input.today)}`;
  return { ...response, content, formProposal: { ...proposal, formDate: null } };
}
