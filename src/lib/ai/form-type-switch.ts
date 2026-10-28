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
 * and the turn that asked for the old form is read as asking for the new one
 * ("create a coaching form for …" as "create a ca for …"), so the card becomes
 * the other form and keeps the employee, the date, the place and the account
 * (a form's account is read from the turns that asked for it). Earlier switch
 * turns too, so a later turn keeps the new form. What the manager typed is
 * stored as typed. After Create nothing changes here (a separate decision).
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

/** The other form's name, as the manager asked for it: "create a coaching form for …". */
const ASKED_FOR: Record<Family, RegExp> = {
  coaching: /(\b(?:create|start|make|need|open|draft|write|fill(?:\s+out)?|do|want|give)\b[^.!?\n]{0,40}?)\bcoaching(?:\s+form)?\b/i,
  ca: /(\b(?:create|start|make|need|open|draft|write|fill(?:\s+out)?|do|want|give)\b[^.!?\n]{0,40}?)\b(?:ca|c\/a|corrective\s+action(?:\s+form)?|write[- ]?up)\b/i,
};
const NAME: Record<Family, string> = { coaching: "coaching form", ca: "ca" };

/** The turn that asked for `from`, read as asking for `to`; any other turn as it is. */
function askedFor(turn: string, from: Family, to: Family): string {
  return turn.replace(ASKED_FOR[from], (_whole, lead: string) => `${lead}${NAME[to]}`);
}

function readAs(turn: string, current: Family): string | null {
  const wanted = requestedForm(turn);
  return wanted && wanted !== current ? READ_AS[wanted] : null;
}

export function withFormTypeSwitch(request: AskRequest): AskRequest {
  if (!formTypeSwitchEnabled() || request.activeFormInstanceId) return request;
  const current = familyOf(request.continueProposalTemplateKey);
  if (!current) return request;
  const question = readAs(request.question, current);
  // The newest switch decides the form; the turns before it are read as asking for that form.
  const users = request.history.map((turn, index) => ({ turn, index })).filter(({ turn }) => turn.role === "user" && typeof turn.content === "string");
  const switches = users.slice(1).filter(({ turn }) => requestedForm(turn.content as string) !== null);
  const last = question ? null : switches.at(-1);
  const target = question ? requestedForm(request.question)! : last ? requestedForm(last.turn.content as string)! : null;
  if (!target) return request;
  const from: Family = target === "coaching" ? "ca" : "coaching";
  const before = question ? request.history.length : last!.index;
  const switchAt = new Set(switches.map(({ index }) => index));
  const history = request.history.map((turn, index) => {
    if (turn.role !== "user" || typeof turn.content !== "string") return turn;
    if (switchAt.has(index)) return { ...turn, content: READ_AS[requestedForm(turn.content)!] };
    if (index > before) return turn;
    const content = askedFor(turn.content, from, target);
    return content === turn.content ? turn : { ...turn, content };
  });
  return { ...request, question: question ?? request.question, history };
}
