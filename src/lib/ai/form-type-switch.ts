import { formTypeSwitchAfterCreateNoteEnabled, formTypeSwitchEnabled, switchKeepsNamedFormEnabled } from "@/lib/config/chat-quality-flags";
import { detectTemplateIntent } from "@/lib/forms/template-intent";

import type { AskRequest, AskResponse } from "./types";

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
export type Family = "coaching" | "ca";

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

/** The form a turn asked for ("create a ca for …"), or null. */
export function askedForm(turn: string): Family | null {
  const coaching = ASKED_FOR.coaching.exec(turn);
  const ca = ASKED_FOR.ca.exec(turn);
  if (coaching && ca) return coaching.index <= ca.index ? "coaching" : "ca";
  return coaching ? "coaching" : ca ? "ca" : null;
}

/** The other form's name, as the manager asked for it: "create a coaching form for …". */
const ASKED_FOR: Record<Family, RegExp> = {
  coaching: /(\b(?:create|start|make|need|open|draft|write|fill(?:\s+out)?|do|want|give)\b[^.!?\n]{0,40}?)\bcoaching(?:\s+form)?\b/i,
  ca: /(\b(?:create|start|make|need|open|draft|write|fill(?:\s+out)?|do|want|give)\b[^.!?\n]{0,40}?)\b(?:ca|c\/a|corrective\s+action(?:\s+form)?|write[- ]?up)\b/i,
};
const NAME: Record<Family, string> = { coaching: "coaching form", ca: "ca" };

/** The turn that asked for `from`, read as asking for `to`; any other turn as it is. */
export function askedFor(turn: string, from: Family, to: Family): string {
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
  // SWITCH_KEEPS_NAMED_FORM_ENABLED: "make it a follow up coaching" is read as typed here too, so the card and Create agree.
  const question = namesAnotherForm(request.question) ? null : readAs(request.question, current);
  // The newest switch decides the form; the turns before it are read as asking for that form.
  const users = request.history.map((turn, index) => ({ turn, index })).filter(({ turn }) => turn.role === "user" && typeof turn.content === "string");
  const switches = users.slice(1).filter(({ turn }) => requestedForm(turn.content as string) !== null && !namesAnotherForm(turn.content as string));
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

/**
 * THE STORED CONVERSATION, READ THE WAY THE CHAT READ IT. QA live, 28 Oct
 * 2026: the switched card's "Create draft" saved nothing — the create route
 * checks a card against the conversation the browser sends, which still read
 * "create a ca …" as the last form asked for, and refused the Coaching Form as
 * out of date. With FORM_TYPE_SWITCH_ENABLED the route reads it here first: the
 * newest switch request as the request the chat switched on, and the turns
 * before it as asking for that form. Nothing stored is changed.
 */
export function switchReadConversation<T extends { readonly role: string; readonly content: string }>(turns: T[]): T[] {
  // Either flag: the after-Create switch's new card is checked against the same conversation.
  if (!formTypeSwitchEnabled() && !formTypeSwitchAfterCreateNoteEnabled()) return turns;
  const users = turns.map((turn, index) => ({ turn, index })).filter(({ turn }) => turn.role === "user" && typeof turn.content === "string");
  const switches = users.slice(1).filter(({ turn }) => requestedForm(turn.content) !== null && !namesAnotherForm(turn.content));
  const last = switches.at(-1);
  if (!last) return turns;
  const target = requestedForm(last.turn.content)!;
  const from: Family = target === "coaching" ? "ca" : "coaching";
  const switchAt = new Set(switches.map(({ index }) => index));
  return turns.map((turn, index) => {
    if (turn.role !== "user" || typeof turn.content !== "string") return turn;
    if (switchAt.has(index)) return { ...turn, content: READ_AS[requestedForm(turn.content)!] };
    if (index > last.index) return turn;
    const content = askedFor(turn.content, from, target);
    return content === turn.content ? turn : { ...turn, content };
  });
}

/**
 * SWITCH_KEEPS_NAMED_FORM_ENABLED (audit, 29 Oct 2026; same flag in both
 * apps): "make it a follow up coaching" names a form of its own, so it is not
 * read as "change this to a coaching form" — the Follow-Up Coaching card it
 * made was refused at Create as asking for a different form. Read as typed by
 * the chat (`withFormTypeSwitch`, `withSwitchSources`) and by Create
 * (`switchReadConversation`) alike: on a CA card, the route alone reading it
 * as typed refused the Coaching card the chat still switched to. Off: as
 * before.
 */
function namesAnotherForm(turn: string): boolean {
  if (!switchKeepsNamedFormEnabled()) return false;
  const intent = detectTemplateIntent(turn);
  return intent.kind === "explicit" && familyOf(intent.templateKey) !== null && intent.templateKey !== "coaching" && intent.templateKey !== "dpoa";
}

/**
 * ============================================================================
 * "CHANGE TO COACHING" AFTER THE FORM WAS CREATED
 * ============================================================================
 *
 * FORM_TYPE_SWITCH_AFTER_CREATE_NOTE_ENABLED (Pau, 28 Oct 2026; same flag in
 * both apps): once this conversation's form exists, a request for the other
 * form starts that form's card — read as the request that asked for the first
 * one, with the other form named, so it keeps the employee, the date, the place
 * and the account — and the reply says the existing form is left as it is
 * (`withSwitchNote`). The existing form is never changed, archived or deleted:
 * the turn is no longer about it, so none of the open-form paths run.
 */
export function withSwitchAfterCreate<T extends AskRequest>(request: T): T {
  if (!formTypeSwitchAfterCreateNoteEnabled() || !request.activeFormInstanceId) return request;
  const wanted = requestedForm(request.question);
  if (!wanted) return request;
  const opening = request.history
    .filter((turn) => turn.role === "user" && typeof turn.content === "string")
    .map((turn) => turn.content)
    .reverse()
    .find((turn) => askedForm(turn) !== null);
  const from = opening ? askedForm(opening) : null;
  if (!opening || !from || from === wanted) return request;
  return {
    ...request,
    question: askedFor(opening, from, wanted),
    activeFormInstanceId: undefined,
    continueProposalTemplateKey: undefined,
    switchedFromForm: from,
  };
}

const DRAFT_NAME: Record<Family, string> = { ca: "Corrective Action", coaching: "Coaching Form" };
const START_NAME: Record<Family, string> = { ca: "Corrective Action Form", coaching: "Coaching Form" };

/** "You already have a Corrective Action draft for **Quinn Marlowe**. I'll start a Coaching Form too, …" */
export function switchNote(from: Family, to: Family, employeeName: string, register: string): string {
  return `You already have a ${DRAFT_NAME[from]} draft for **${employeeName}**. I'll start a ${START_NAME[to]} too, and the ${DRAFT_NAME[from]} draft stays in ${register} until you delete it.`;
}

/** Once, above the new form's card, when `withSwitchAfterCreate` started it. */
export function withSwitchNote(response: AskResponse, request: AskRequest, register: string): AskResponse {
  const from = request.switchedFromForm;
  const card = response.formProposal;
  const to = familyOf(card?.templateKey);
  if (!from || !card || !to || to === from || !card.employeeName) return response;
  const note = switchNote(from, to, card.employeeName, register);
  if (response.content.includes(note)) return response;
  return { ...response, content: `${note}\n\n${response.content}` };
}

/**
 * THE SWITCHED FORM IS DRAFTED FROM THE ACCOUNT, NEVER FROM THE SWITCH TURN.
 * QA live, 28 Oct 2026: after Create, the new Coaching draft read "A change to
 * coaching was noted for <name>" — the card's draft sources (`sourceMessageIds`,
 * the turns its draft is written from) were the turns about the new form,
 * which after Create is only "change to coaching". With either switch flag on:
 * a switch turn is never a draft source, and after Create the turns from the
 * one that asked for the first form are (the account it was drafted from).
 */
export function withSwitchSources(response: AskResponse, request: AskRequest): AskResponse {
  const card = response.formProposal;
  if (!card || (!formTypeSwitchEnabled() && !formTypeSwitchAfterCreateNoteEnabled())) return response;
  const users = request.history.filter(
    (turn): turn is typeof turn & { id: string } => turn.role === "user" && typeof turn.content === "string" && typeof turn.id === "string",
  );
  // A switch turn asks for the OTHER form than the one asked for before it; "make it a written ca" on a CA is not one.
  const dropped = new Set<string>();
  let current: Family | null = null;
  const read = (content: string, id: string | undefined, first: boolean) => {
    const wanted = first || namesAnotherForm(content) ? null : requestedForm(content);
    if (wanted && current && wanted !== current) {
      if (id) dropped.add(id);
      current = wanted;
      return;
    }
    current = askedForm(content) ?? current;
  };
  users.forEach((turn, index) => read(turn.content, turn.id, index === 0));
  if (request.switchedFromForm) {
    if (request.questionMessageId) dropped.add(request.questionMessageId);
  } else {
    read(request.question, request.questionMessageId, users.length === 0);
  }
  let sources = card.sourceMessageIds.filter((id) => !dropped.has(id));
  if (request.switchedFromForm) {
    const opening = users.map((turn) => askedForm(turn.content)).lastIndexOf(request.switchedFromForm);
    if (opening >= 0) sources = users.slice(opening).map((turn) => turn.id).filter((id) => !dropped.has(id));
  }
  if (sources.length === 0 || sources.join() === card.sourceMessageIds.join()) return response;
  return { ...response, formProposal: { ...card, sourceMessageIds: sources } };
}
