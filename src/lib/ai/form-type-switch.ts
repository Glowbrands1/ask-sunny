import { formTypeSwitchEnabled } from "@/lib/config/chat-quality-flags";

import type { AskRequest } from "./types";

/**
 * ============================================================================
 * "CHANGE TO COACHING" WHILE THE CARD IS OPEN
 * ============================================================================
 *
 * FORM_TYPE_SWITCH_ENABLED (Pau, 28 Oct 2026; same flag in both apps):
 * "Sometimes a manager asks for a CA, then wants to change to coaching." With
 * the card open, "change to coaching", "switch it to coaching", "can this be
 * a ca instead", "ca instead of coaching" kept the old form, and only "change
 * this to a coaching form" / "actually make it a ca" switched it.
 *
 * With the flag on, while a card is open and nothing is created yet, a short
 * turn that asks for the other form is read as the request the chat already
 * switches on — "change this to a coaching form", "actually make it a ca" —
 * so the card becomes the other form and keeps the employee, the date, the
 * place and the account. Earlier turns of that shape too, so a later turn
 * keeps the new form. What the manager typed is stored as typed. After Create
 * nothing changes here (a separate decision).
 */
type Family = "coaching" | "ca";

const COACHING = /\bcoaching\b/i;
const CA = /\b(?:ca|c\/a|corrective(?:\s+action)?|write[- ]?up)\b/i;
const CUE = /\b(?:change|switch|make|turn|convert|instead|rather)\b|\b(?:can|could|should)\s+(?:this|it|we)\s+be\b/i;
const MAX_WORDS = 10;

const READ_AS: Record<Family, string> = {
  coaching: "change this to a coaching form",
  ca: "actually make it a ca",
};

function familyOf(templateKey: string | undefined): Family | null {
  if (!templateKey) return null;
  if (/coaching/.test(templateKey)) return "coaching";
  if (templateKey === "dpoa") return "ca";
  return null;
}

/** The form a short switch request asks for, or null. */
export function requestedForm(turn: string): Family | null {
  const text = turn.trim().replace(/[.!?]+$/, "");
  if (!text || text.split(/\s+/).length > MAX_WORDS || !CUE.test(text)) return null;
  const instead = /^(?:(?:a|an)\s+)?(.+?)\s+instead\s+of\s+/i.exec(text);
  const head = instead ? instead[1]! : text;
  const coaching = COACHING.test(head);
  const ca = CA.test(head.replace(COACHING, " "));
  if (coaching === ca) return null;
  return coaching ? "coaching" : "ca";
}

function readAs(turn: string, current: Family): string | null {
  const wanted = requestedForm(turn);
  return wanted && wanted !== current ? READ_AS[wanted] : null;
}

export function withFormTypeSwitch(request: AskRequest): AskRequest {
  if (!formTypeSwitchEnabled() || request.activeFormInstanceId) return request;
  const current = familyOf(request.continueProposalTemplateKey);
  if (!current) return request;
  // An earlier switch request (never the opening request) is read the same way, so the next turn keeps the form.
  let users = 0;
  let changed = false;
  const history = request.history.map((turn) => {
    if (turn.role !== "user" || typeof turn.content !== "string") return turn;
    users += 1;
    const wanted = users > 1 ? requestedForm(turn.content) : null;
    if (!wanted) return turn;
    changed = true;
    return { ...turn, content: READ_AS[wanted] };
  });
  const question = readAs(request.question, current);
  if (!question && !changed) return request;
  return { ...request, question: question ?? request.question, history };
}
