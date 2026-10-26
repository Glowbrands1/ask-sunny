import { stateCaGuardEnabled } from "@/lib/config/chat-quality-flags";

import type { AskRequest } from "./types";

/**
 * STATE_CA_GUARD_ENABLED: "CA" after a place is California, not a
 * Corrective Action.
 *
 * Ask Sunny conv_mvokdp2c24wi9re, 26 Oct 2026: the turn "Sacramento, CA"
 * opened the Corrective Action intake (seven questions). The form reader
 * takes the word "CA" wherever it stands, in any case.
 *
 * Before any reader sees a manager turn, "CA" is written as "California"
 * where it is a state: after a place and a comma ("Sacramento, CA",
 * "sacramento, ca"), before a ZIP code ("Los Angeles CA 90001"), or after a
 * capitalised city ("Los Angeles CA"). "ca" as a form ("ca", "ca for …",
 * "write up ca", "create a ca", "verbal ca …") is never changed. Off, every
 * turn is read as typed.
 *
 * The same file in Ask Bubbles.
 */

/** Words before "ca" that make it the form, never the state. */
const FORM_LEAD = /^(?:a|an|the|new|create|make|need|needs|write|draft|do|start|file|open|verbal|written|final|perf|another|this|that|my|up)$/i;
const AFTER_STATE = /^(?:\s*$|\s*[.,;!?)]|\s+\d{5}\b|\s+(?:last|this|next|in|on|at|and|area|since|until|before|after|location|store|salon)\b)/i;

export function withStateNames(request: AskRequest): AskRequest {
  if (!stateCaGuardEnabled()) return request;
  const question = statesSpelledOut(request.question);
  let changed = question !== request.question;
  const history = request.history.map((turn) => {
    if (turn.role !== "user" || typeof turn.content !== "string") return turn;
    const content = statesSpelledOut(turn.content);
    if (content === turn.content) return turn;
    changed = true;
    return { ...turn, content };
  });
  return changed ? { ...request, question, history } : request;
}

/** The text with every state "CA" written as "California". */
export function statesSpelledOut(text: string): string {
  if (!text) return text;
  return text.replace(/\b([A-Za-z][A-Za-z.'’-]*)(,\s*|\s+)(ca)\b/gi, (whole, place: string, gap: string, ca: string, offset: number, all: string) => {
    if (FORM_LEAD.test(place)) return whole;
    const after = all.slice(offset + whole.length);
    const comma = gap.includes(",");
    const zip = /^\s+\d{5}\b/.test(after);
    const capitalCity = /^[A-Z][a-z]/.test(place) && ca === "CA" && offset > 0;
    if (!(comma || zip || capitalCity) || !AFTER_STATE.test(after)) return whole;
    return `${place}${gap}California`;
  });
}
