import type { AskResponse, OpenFormSummary } from "./types";

/**
 * ============================================================================
 * NO CARD, NO CLAIM THAT A DRAFT IS OPEN
 * ============================================================================
 *
 * NO_CARD_NO_DRAFT_CLAIM_ENABLED (QA B22-2, 25 Oct 2026). In one chat, after
 * a Corrective Action card for "Test Employee", the manager typed "now one for
 * Test Employee Two, …, late today". The answering model replied "A new
 * Corrective Action Form draft is open for Test Employee Two … press Finalize
 * on the card" — and no card came with it. No draft for Test Employee Two
 * existed; the only card on screen was the first one.
 *
 * A card is what makes a draft real in the chat: a proposal (`formProposal`,
 * `formProposals`), a choice of forms (`formSelection`), a form this turn
 * changed (`formUpdate`) or put on screen (`formOpened`). A reply that comes
 * with none of these may still speak about the form that is ALREADY open
 * (`openForm`): "press Finalize on the card" is true of that draft. What it may
 * not do is say a new draft is open or was created, say a draft is open for
 * somebody other than the open form's employee, or tell the manager to press
 * Finalize or Create on a card that is not there.
 *
 * Those sentences are replaced, once, with an honest line that says how to get
 * the card; the rest of the reply is kept as written. Off, or with a card,
 * the response is returned as it came.
 *
 * ONLY A CLAIM IS REWRITTEN (QA-7, 26 Oct 2026). A claim says a draft IS open
 * or was created now, asserted. A conditional, future or instructional
 * sentence is not one and is kept: "Once you press Create, the draft for … will
 * open.", "Press Create after you add it." Claims are read clause by clause,
 * so "The draft for Test Employee is open, and I've created a new draft for
 * …" keeps its true first clause, and the honest line names the person of the
 * false claim. A bare "press Create on the card below" with no card on screen
 * and no proposal waiting points at a card that is not there (the B22-2 bug):
 * on its own it is dropped and names nobody — the turn's person is not the
 * person of an instruction — and only where nothing else is left is the
 * no-person honest line said instead.
 */

export interface NoCardClaimContext {
  /** The manager's turn, as typed. */
  readonly question: string;
  /** The form already open in this conversation, if any. */
  readonly openForm?: OpenFormSummary | null;
  /** A proposal card from an earlier turn is still waiting for Create. */
  readonly proposalPending?: boolean;
  /**
   * Every form open on screen when several are and the turn named none (two
   * cards from one message): `openForm` is null then, and a true line about
   * either card is still true.
   */
  readonly openForms?: readonly OpenFormSummary[] | null;
}

/**
 * Any card this turn puts on screen. `formProposals` (several cards from one
 * message) is read where the response carries it.
 */
export function hasCard(response: AskResponse): boolean {
  const several = (response as { formProposals?: readonly unknown[] }).formProposals;
  return Boolean(
    response.formProposal ||
    (several && several.length > 0) ||
    response.formSelection ||
    response.formUpdate ||
    response.formOpened,
  );
}

/** "… draft is open", "the form has been created", "card is ready". */
const DRAFT_STATE =
  /\b(?:draft|form|card)\b[^.!?\n]{0,80}?\b(?:is|are|has\s+been|have\s+been|was|were)\s+(?:now\s+)?(?:open|opened|created|ready|started|drafted|up|on\s+screen|in\s+progress|filled\s+in)\b/i;

/** "I've created a new draft", "I drafted the form for …". */
const SAID_I_MADE =
  /\bI(?:['’]ve|\s+have)?\s+(?:just\s+|now\s+|also\s+|already\s+)?(?:created|drafted|opened|started|prepared|made|filed|generated|set\s+up|put\s+together)\b[^.!?\n]{0,60}\b(?:draft|form|card)\b/i;

/** "Here's the new draft for …". */
const HERE_IS =
  /\bhere(?:['’]s|\s+is)\s+(?:a|the|your)\s+[^.!?\n]{0,40}\b(?:draft|card)\b/i;

/** "press Finalize", "click **Create**", "tap “Finalize”". */
const PRESS =
  /\b(?:press|click|tap|hit|select|use)\s+(?:the\s+|on\s+)?[*_"“'‘]*\s*(finalize|create)\b/i;

/** A state claim that is hedged, negated or conditional is not a claim. */
const HEDGED =
  /\b(?:not|never|nothing|no|once|when|whenever|if|until|before|after|will|would|can|could|should)\b|n['’]t\b/i;

const NEW_DRAFT = /\b(?:new|another|second|separate)\b/i;

/** A clause that says what will or would happen, or on what condition. */
const CONDITIONAL =
  /\b(?:once|when|whenever|if|until|before|after|will|would|can|could|should)\b|['’]ll\b/i;

/** "on the card", "the card below": an instruction that points at a card. */
const POINTS_AT_CARD = /\bcards?\b/i;

/**
 * Where one sentence holds two clauses: ", and", ", but", ", so", ";", a dash,
 * or "and I've …". A bare "and" is not split: "Test Employee and Rook".
 */
const CLAUSE_BREAK =
  /(,\s*(?:and|but|so|while)\s+|;\s+|\s+[—–]\s+|\s+and\s+(?=I(?:['’]ve|\s+have)?\s))/i;

/** A capitalised run after "for": the person a sentence is about. */
const FOR_PERSON = /\bfor\s+((?:[A-Z][\w'’-]*)(?:\s+[A-Z][\w'’-]*){0,3})/g;

/** Capitalised words after "for" that are not a person: a form, a day, a button. */
const NOT_A_PERSON =
  /^(?:the|a|an|her|him|them|this|that|my|our|your|being|not|no|today|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|corrective|coaching|ca|policy|written|verbal|final|finalize|create|review|now|it)$/i;

/** A form's own name in a sentence: "Corrective Action Form" → "corrective action". */
const FORM_NAME = /\b((?:[A-Z][\w-]*\s+){0,3}[A-Z][\w-]*)\s+Form\b/;

/** Words that end a name typed without a comma: "for test employee two late today". */
const NOT_A_NAME_WORD =
  /^(?:late|tardy|absent|early|again|no|call|show|missed|left|was|is|were|did|didn['’]t|who|at|on|in|from|to|with|because|and|or|but|about|since|after|before)$/i;

/** What follows "for" in the manager's turn, up to a comma or a stop. */
const FOR_SPAN = /\bfor\s+([^,.;:!?\n]+)/gi;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The names this turn is about, in any case: what the manager typed after
 * "for" (a full name, or a first name typed alone) and the open form's
 * employee. A manager or a model writing "test employee two" all lowercase is
 * read the same as "Test Employee Two" (Pau's register rule): the capitalised
 * run alone missed it, and a claim for another employee went out.
 */
/** The form open on screen, or every one of several. */
function openFormsOf(context: NoCardClaimContext): OpenFormSummary[] {
  return [context.openForm ?? null, ...(context.openForms ?? [])].filter(
    (form): form is OpenFormSummary => form !== null,
  );
}

function knownNames(context: NoCardClaimContext): string[] {
  const names: string[] = [];
  for (const match of context.question.matchAll(FOR_SPAN)) {
    const all = match[1]!.trim().split(/\s+/);
    const stop = all.findIndex((word, index) => index > 0 && (NOT_A_PERSON.test(word) || NOT_A_NAME_WORD.test(word)));
    const words = (stop < 0 ? all : all.slice(0, stop)).slice(0, 4);
    if (words.length === 0 || NOT_A_PERSON.test(words[0]!) || NOT_A_NAME_WORD.test(words[0]!)) continue;
    const shortest = words.length === 1 ? 1 : 2;
    for (let size = words.length; size >= shortest; size -= 1) names.push(words.slice(0, size).join(" "));
  }
  for (const form of openFormsOf(context)) {
    const employee = form.employeeName?.trim();
    if (employee) names.push(employee);
  }
  return names;
}

function peopleAfterFor(text: string, known: readonly string[] = []): string[] {
  const found: { at: number; name: string }[] = [];
  const taken = new Set<number>();
  for (const match of text.matchAll(FOR_PERSON)) {
    const all = match[1]!.split(/\s+/);
    if (NOT_A_PERSON.test(all[0]!)) continue;
    /* "FOR TEST EMPLOYEE IS OPEN" in capitals: the name ends before "IS". */
    const stop = all.findIndex((word, index) => index > 0 && (NOT_A_PERSON.test(word) || NOT_A_NAME_WORD.test(word)));
    const words = stop < 0 ? all : all.slice(0, stop);
    taken.add(match.index);
    found.push({ at: match.index, name: words.join(" ") });
  }
  /*
   * A name the turn is about, after "for", in any case (longest first), where
   * the capitalised reading found nobody: "for test employee two" typed or
   * echoed lowercase. One that runs on into a capitalised word is left to the
   * capitalised reading above.
   */
  for (const name of [...known].sort((a, b) => b.length - a.length)) {
    const pattern = new RegExp(`\\bfor\\s+(${escapeRegExp(name).replace(/\s+/g, "\\s+")})(?![\\w'’-])`, "gi");
    for (const match of text.matchAll(pattern)) {
      if (taken.has(match.index)) continue;
      if (/^\s+[A-Z]/.test(text.slice(match.index + match[0].length))) continue;
      taken.add(match.index);
      found.push({ at: match.index, name: match[1]! });
    }
  }
  return found.sort((a, b) => a.at - b.at).map((person) => person.name);
}

function normalName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The same person: the same name, or a first name alone that is theirs. */
function samePersonName(a: string, b: string): boolean {
  const x = normalName(a);
  const y = normalName(b);
  if (x === "" || y === "") return false;
  if (x === y) return true;
  const short = x.includes(" ") ? (y.includes(" ") ? null : y) : x;
  const full = short === x ? y : x;
  return short !== null && full.split(" ")[0] === short;
}

/** Sentences of one line, each with its own trailing space. */
function sentencesOf(line: string): string[] {
  return line.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)\s*/g) ?? [line];
}

/** A sentence's clauses, each with the break that follows it. */
function clausesOf(sentence: string): { text: string; tail: string }[] {
  const parts = sentence.split(CLAUSE_BREAK);
  const clauses: { text: string; tail: string }[] = [];
  for (let index = 0; index < parts.length; index += 2) {
    clauses.push({ text: parts[index]!, tail: parts[index + 1] ?? "" });
  }
  return clauses;
}

type Claim = "state" | "made" | "press-finalize" | "press-create";

/** What one clause claims or instructs. */
function claimsIn(clause: string): Claim[] {
  const claims: Claim[] = [];
  if (
    (DRAFT_STATE.test(clause) || HERE_IS.test(clause)) &&
    !HEDGED.test(clause)
  )
    claims.push("state");
  if (
    SAID_I_MADE.test(clause) &&
    !/\b(?:not|never|haven['’]t|hasn['’]t|didn['’]t)\b/i.test(clause) &&
    !/\b(?:if|once|would)\b/i.test(clause)
  ) {
    claims.push("made");
  }
  const press = clause.match(PRESS);
  if (press)
    claims.push(
      press[1]!.toLowerCase() === "finalize"
        ? "press-finalize"
        : "press-create",
    );
  return claims;
}

/** The honest line when nobody is named: it never guesses a person. */
const NAMES_NOBODY = `I haven't created a new form yet — say which form and who it's for (for example "create a corrective action for" and their name) and I'll put a card here.`;

interface Clause {
  readonly text: string;
  readonly tail: string;
  readonly claims: Claim[];
}

const isPress = (claim: Claim): boolean => claim.startsWith("press-");

/**
 * The reply with any claim of a draft that is not on screen replaced by one
 * honest line. Returns the content unchanged when it makes no such claim.
 */
export function withoutPhantomDraftClaim(
  content: string,
  context: NoCardClaimContext,
): string {
  const opens = openFormsOf(context);
  const known = knownNames(context);
  const lines = content.split("\n").map((line) =>
    sentencesOf(line).map((text) => ({
      text,
      clauses: clausesOf(text).map(
        (clause): Clause => ({ ...clause, claims: claimsIn(clause.text) }),
      ),
    })),
  );
  const clauses = lines.flat().flatMap((sentence) => sentence.clauses);
  if (!clauses.some((clause) => clause.claims.length > 0)) return content;

  /**
   * Whether a clause CLAIMS a draft that does not exist: one said to be open
   * or created now that is new, or for somebody whose form is not open.
   */
  const falseClaim = (clause: Clause): boolean =>
    clause.claims.some((claim) => {
      if (isPress(claim)) return false;
      if (opens.length === 0) return true;
      if (NEW_DRAFT.test(clause.text)) return true;
      return peopleAfterFor(clause.text, known).some(
        (person) => !opens.some((form) => samePersonName(person, form.employeeName)),
      );
    });
  /**
   * Whether a clause tells the manager to press a button on a card that is
   * not there: Create with no proposal waiting, Finalize with no draft open.
   * "Press Create after you add it" points at no card and is kept.
   */
  const phantomCard = (clause: Clause): boolean =>
    POINTS_AT_CARD.test(clause.text) &&
    clause.claims.some((claim) =>
      claim === "press-create"
        ? !context.proposalPending
        : claim === "press-finalize"
          ? !opens.some((form) => form.status === "draft")
          : false,
    );
  const claimed = clauses.filter(falseClaim);

  /*
   * Once a reply claims a draft that is not there, its "press Finalize on the
   * card" is about that same draft, so it goes too — and so does a plain
   * "press Create", but not one that only says what will happen ("once you
   * press Create, …") or when ("press Create after you add it").
   */
  const goes = (clause: Clause): boolean =>
    falseClaim(clause) ||
    phantomCard(clause) ||
    (claimed.length > 0 &&
      clause.claims.some(isPress) &&
      (POINTS_AT_CARD.test(clause.text) || !CONDITIONAL.test(clause.text)));
  if (!clauses.some(goes)) return content;

  let honest: string | null = null;
  if (claimed.length > 0) {
    const person =
      claimed.flatMap((clause) => peopleAfterFor(clause.text, known))[0] ??
      peopleAfterFor(context.question, known)[0] ??
      null;
    const named =
      claimed.map((clause) => clause.text.match(FORM_NAME)?.[1]).find(Boolean) ??
      null;
    const formWords = (
      named ?? (opens[0] ? opens[0].templateName.replace(/\s+Form$/i, "") : "form")
    ).toLowerCase();
    const another = person !== null && opens.some((form) => samePersonName(person, form.employeeName));
    honest = person
      ? `I haven't created ${another ? "a new form" : "a form"} for ${person} yet — say "create a ${formWords} for ${person}" and I'll put a card here.`
      : NAMES_NOBODY;
  }
  let placed = false;
  const kept = lines.map((sentences) => {
    const parts: string[] = [];
    for (const sentence of sentences) {
      if (!sentence.clauses.some(goes)) {
        parts.push(sentence.text);
        continue;
      }
      /*
       * A true claim in the same sentence is kept, by the clause; the words
       * around a false one go with it.
       */
      const trueClauses = sentence.clauses.filter(
        (clause) => clause.claims.length > 0 && !goes(clause),
      );
      const trailing = /\s$/.test(sentence.text) ? " " : "";
      const stop = sentence.text.trimEnd().match(/[.!?]+$/)?.[0] ?? ".";
      const keptText = trueClauses.length
        ? capitalisedLike(
            sentence.text,
            `${trueClauses
              .map((clause, index) =>
                index < trueClauses.length - 1 ? clause.text + clause.tail : clause.text,
              )
              .join("")
              .trim()
              .replace(/[.!?,;:]+$/, "")}${stop}`,
          )
        : null;
      const honestFirst =
        keptText !== null && goes(sentence.clauses[0]!) && !placed && honest;
      const pieces: string[] = [];
      if (honestFirst) {
        pieces.push(honest!);
        placed = true;
      }
      if (keptText !== null) pieces.push(keptText);
      if (!placed && honest) {
        pieces.push(honest);
        placed = true;
      }
      if (pieces.length) parts.push(`${pieces.join(" ")}${trailing}`);
    }
    return {
      text: parts.join("").trimEnd(),
      emptied:
        sentences.some((s) => s.text.trim() !== "") && parts.length === 0,
    };
  });
  const out = kept
    .filter((line) => !line.emptied)
    .map((line) => line.text)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  /* Nothing left once a phantom-card instruction went: say so, naming nobody. */
  return out === "" ? NAMES_NOBODY : out;
}

/** A kept clause opens as its sentence did: capitalised, or not. */
function capitalisedLike(sentence: string, text: string): string {
  const first = sentence.trimStart()[0] ?? "";
  if (first !== first.toUpperCase() || first === first.toLowerCase()) return text;
  return text.replace(/^(\s*)([a-z])/, (_m, lead: string, letter: string) => `${lead}${letter.toUpperCase()}`);
}

/**
 * The response with a phantom draft claim made honest, when it carries no
 * card. With a card, or with nothing claimed, it is returned as it came.
 */
export function noCardNoDraftClaim(
  response: AskResponse,
  context: NoCardClaimContext,
): AskResponse {
  if (hasCard(response)) return response;
  const content = withoutPhantomDraftClaim(response.content, context);
  return content === response.content ? response : { ...response, content };
}
