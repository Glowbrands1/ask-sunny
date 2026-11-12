import { outlineOnOpenProposalEnabled } from "@/lib/config/chat-quality-flags";


/*
 * ============================================================================
 * AN OUTLINE PASTED ON AN OPEN PROPOSAL NEVER COSTS THE PROPOSAL ITS FACTS (OUTLINE_ON_OPEN_PROPOSAL_ENABLED)
 * ============================================================================
 *
 * Ported from the sibling app: QA's Bubbles 17i live test (11 Nov 2026); reproduced here, on a proposal (Create never pressed): (a) "create a corrective action for
 * <A>, she was late on 11/3/26" made the card (Issue, Attendance p.14); (b) an "Observation of Offense: … / Action
 * Plan: …" outline written for another person, pasted next, was ignored; (c) "same outline but with <A first>'s info"
 * left the card with no Issue, no Policy and a generic plan (in the replay pack, the outline's date became <A>'s). The
 * card is re-read from the manager's turns every time, and the outline — another person's account — was read as hers.
 *
 * With the flag on and no form open, a pasted labelled outline and a turn asking for "the same outline" are no account:
 * they are left out of the re-read, and such a turn is read as the request before it, so step (a)'s Issue, date, Policy
 * and plan are kept. The reply says her own details are kept and nothing from the pasted example's person goes on the
 * card. Pure.
 */

/** Two or more "<Label>:" lines: a pasted labelled outline ("Observation of Offense: … / Action Plan: …"). */
const LABEL_LINE = /(?:^|\n)[ \t]*[A-Z][A-Za-z /&'’-]{3,40}[ \t]*:/g;
function looksLikePastedTemplate(text: string): boolean {
  return (text.match(LABEL_LINE) ?? []).length >= 2;
}

const SAME_OUTLINE = /\b(?:same|this|that)\s+(?:outline|template|format|layout)\b/i;
/* A turn that asks for a form ("create a ca for …", "… in the format of <B>") is the request: never left out (the sibling's s22 case). */
const FORM_REQUEST = /\b(?:create|make|write|draw\s+up|need|draft|prepare|start)\b[^.?!\n]{0,40}\b(?:ca|c\/a|corrective\s+action|coaching|write[- ]?up|warning|form)\b/i;

/*
 * Gate-Bubbles-4's NO-GO (G4-802, 12 Nov 2026) and Gate-Sunny-3's probe of S#875: the manager's own account, labelled
 * ("Date: 11/3/26\nWhat happened: <A> arrived 40 minutes late …", "Time: 9am\nShift: opening\nshe was late") or asking for
 * a format with her facts ("<A> was late on 11/3/26. Use this format for the action plan."), is never left out. A pasted
 * outline is no account only when it names a person other than the card's employee; a "same outline …" turn only when it
 * adds nothing but her name.
 */
const NOT_A_PERSON = new Set(
  "the she he they it this that these those we i you management leadership team manager employee associate everyone nobody someone client guest store salon shift".split(" "),
);
/** A capitalised name as the subject of a reported act ("Corisande arrived …", "Tamsyn completed …"). */
const ACTS = String.raw`(?:was|is|has|had|did|didn['’]?t|arrived|completed|failed|left|came|called|took|refused|walked|clocked|showed|missed|will|must|should)`;
const NAMED_ACT = new RegExp(String.raw`\b([A-Z][a-z'’]+)(?:\s+[A-Z][a-z'’]+)?\s+${ACTS}\b`, "g");
const NAMED_ACT_ANY_CASE = new RegExp(String.raw`\b([a-z][a-z'’]{2,})\s+${ACTS}\b`, "gi");
/** Filler a "same outline …" turn may carry beside her name: nothing of an account. */
const SAME_OUTLINE_FILLER =
  /\b(?:same|this|that|the|a|an|outline|template|format|layout|but|with|use|using|for|her|his|their|info|information|details|please|pls|it|make|do|apply|to|on|and|just|instead|of|s)\b|['’]s?\b|[^\p{L}\p{N}]+/giu;

/** Her names: the card's employee, and the name the manager typed in the request ("for liz varnholt"). */
type Her = string | readonly string[] | null | undefined;
function nameWords(her: Her): string[] {
  const names = typeof her === "string" ? [her] : (her ?? []);
  return names.flatMap((name) => name.toLowerCase().split(/[^\p{L}'’-]+/u)).filter((word) => word.length >= 2);
}

const REQUEST_NAME = /\b(?:for|on)\s+([a-z][a-z'’-]*)(?:\s+([a-z][a-z'’-]*))?/i;
/** The name typed after "for" in a form request, when the request has one. */
export function requestedName(turn: string): string | null {
  if (!FORM_REQUEST.test(turn)) return null;
  const typed = REQUEST_NAME.exec(turn);
  return typed ? [typed[1], typed[2]].filter(Boolean).join(" ") : null;
}

/*
 * Gate-Sunny-3's NO-GO on S#875 here (12 Nov 2026): the manager's own labelled account names coworkers, witnesses and
 * nicknames ("What happened: Ilsa was 40 minutes late … Jordan had to cover the front desk"). So an outline is another
 * person's only when (1) it never mentions the card's employee, (2) it names someone, and (3) it is laid out as a filled
 * form — its labels are the form's own sections (Observation of Offense, Action Plan …), not an account's (Date, What
 * happened, Time, Shift). Any doubt keeps the turn as her account.
 */
const FORM_SECTION_LABEL =
  /(?:^|\n)[ \t]*(?:observation\s+of\s+offense|action\s+plan|going\s+forward|expectations?|policy\s+violated|policy\s+language|prior\s+actions?|details\s*[–—-]\s*observed)[ \t]*:/i;
const ARTICLE_BEFORE = /\b(?:the|a|an|her|his|their|my|our|your|this|that)\s+$/i;

/** Whether the text mentions the card's employee: a word of her name, in any case, possessive or not. */
function mentionsEmployee(text: string, employeeName: Her): boolean {
  const own = nameWords(employeeName);
  const words = text.toLowerCase().split(/[^\p{L}'’-]+/u).map((word) => word.replace(/['’]s?$/, ""));
  return own.some((part) => words.includes(part));
}

/** Whether the text names someone as the subject of an act: "Corisande arrived …", or lower case when the name recurs. */
function namesSomeone(text: string): boolean {
  for (const match of text.matchAll(NAMED_ACT)) {
    if (!NOT_A_PERSON.has(match[1]!.toLowerCase())) return true;
  }
  // "corisande arrived … coach corisande": a lower-case name counts only when it recurs and no article owns it.
  for (const match of text.matchAll(NAMED_ACT_ANY_CASE)) {
    const name = match[1]!.toLowerCase();
    if (NOT_A_PERSON.has(name) || ARTICLE_BEFORE.test(text.slice(0, match.index))) continue;
    if ((text.toLowerCase().match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length >= 2) return true;
  }
  return false;
}

/** A pasted outline for another person: laid out as a filled form, naming someone, never the card's employee. */
function outlineForAnotherPerson(text: string, employeeName: Her): boolean {
  return FORM_SECTION_LABEL.test(text) && !mentionsEmployee(text, employeeName) && namesSomeone(text);
}

/** Whether a "same outline …" turn says nothing but the employee's name. */
function addsOnlyTheName(text: string, employeeName: Her): boolean {
  const own = nameWords(employeeName);
  if (own.length === 0) return false;
  const words = text.replace(SAME_OUTLINE_FILLER, " ").toLowerCase().split(/\s+/).filter(Boolean);
  const named = words.filter((word) => own.some((part) => word === part || word.replace(/s$/, "") === part));
  return named.length > 0 && named.length === words.length;
}

/** A pasted filled-form outline for another person, or a turn asking for "the same outline …" with only her name. */
export function isOutlineTurn(text: string, employeeName?: Her): boolean {
  if (FORM_REQUEST.test(text)) return false;
  // A lower-case outline ("observation of offense: …") has the form's own labels even when no label is capitalised.
  if (looksLikePastedTemplate(text) || FORM_SECTION_LABEL.test(text)) return outlineForAnotherPerson(text, employeeName);
  return SAME_OUTLINE.test(text) && addsOnlyTheName(text, employeeName);
}

interface Turn {
  readonly id?: string;
  readonly role: string;
  readonly content: string;
  readonly formProposal?: { readonly employeeName?: string | null } | null;
}

/** The card's employee: the latest card's name in the history ("… for **<A>** …" when the turn carries no card). */
function cardEmployee(history: readonly Turn[]): string | null {
  for (const turn of [...history].reverse()) {
    if (turn.role !== "assistant") continue;
    const name = turn.formProposal?.employeeName ?? /\bfor \*\*([^*\n]+)\*\*/.exec(turn.content)?.[1];
    if (name) return name;
  }
  return null;
}

interface Asked<T extends Turn> {
  readonly question: string;
  readonly history: readonly T[];
  readonly activeFormInstanceId?: string | null;
}

/**
 * The request as the proposal re-read takes it: outline turns left out of the history, and an outline turn read as the
 * manager's last request before it. `outline` is true when this turn was an outline turn. Null when nothing changes.
 */
export function withoutOutlineTurns<T extends Turn, A extends Asked<T>>(asked: A): { asked: A; outline: boolean; requestId?: string } | null {
  if (!outlineOnOpenProposalEnabled() || asked.activeFormInstanceId) return null;
  const card = cardEmployee(asked.history);
  if (!card) return null;
  const typed = asked.history.filter((turn) => turn.role === "user").map((turn) => requestedName(turn.content));
  const employee = [card, ...typed.filter((name): name is string => name !== null)];
  const outline = isOutlineTurn(asked.question, employee);
  const kept = asked.history.filter((turn) => !(turn.role === "user" && isOutlineTurn(turn.content, employee)));
  if (!outline && kept.length === asked.history.length) return null;
  if (!outline) return { asked: { ...asked, history: kept }, outline: false };
  const request = [...kept].reverse().find((turn) => turn.role === "user" && turn.content.trim() !== "");
  if (!request) return null;
  return { asked: { ...asked, history: kept, question: request.content }, outline: true, ...(request.id ? { requestId: request.id } : {}) };
}

interface CardLike {
  readonly employeeName: string | null;
  readonly templateName?: string;
  readonly sourceMessageIds?: readonly string[];
}

/** On the outline turn, the reply says her own details are kept, and nothing from the pasted example's person. */
export function withOutlineKeptNote<T extends { content: string; formProposal?: CardLike | null }>(
  answer: T,
  cited?: { readonly outlineTurnId?: string; readonly requestId?: string },
): T {
  const card = answer.formProposal;
  if (!card?.employeeName) return answer;
  // The card cites the request it was read from, never the outline turn, so Create's notes are her account.
  const ids = card.sourceMessageIds;
  const sourceMessageIds =
    ids && cited?.outlineTurnId && cited.requestId
      ? [...new Set(ids.map((id) => (id === cited.outlineTurnId ? cited.requestId! : id)))]
      : ids;
  // QA (12 Nov 2026): say what is true — nothing keeps the outline as a layout.
  const note = `I've kept **${card.employeeName}**'s own details; nothing from the person in the pasted example goes on this card.`;
  return { ...answer, content: `${note}\n\n${answer.content}`, formProposal: { ...card, ...(sourceMessageIds ? { sourceMessageIds } : {}) } };
}

/**
 * The draft's notes (the manager's turns, a blank line between them) without the outline turns: the pasted outline is
 * another person's account, and "same outline but with <A>'s info" is no account, so neither person's name, date or
 * events from the outline reach <A>'s draft (QA, 11 Nov 2026). The form's own fields give the layout (Observation of
 * Offense, Action Plan …); the content comes only from <A>'s turns. Unchanged with the flag off, or when every turn is
 * an outline turn.
 */
export function notesWithoutOutline(notes: string, employeeName: string | null): string {
  if (!outlineOnOpenProposalEnabled() || !employeeName) return notes;
  const turns = notes.split(/\n{2,}/);
  const her = [employeeName, ...turns.map(requestedName).filter((name): name is string => name !== null)];
  const kept = turns.filter((turn) => !isOutlineTurn(turn, her));
  return kept.length === turns.length || kept.length === 0 ? notes : kept.join("\n\n");
}
