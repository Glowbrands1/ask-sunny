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
 */

export interface NoCardClaimContext {
  /** The manager's turn, as typed. */
  readonly question: string;
  /** The form already open in this conversation, if any. */
  readonly openForm?: OpenFormSummary | null;
  /** A proposal card from an earlier turn is still waiting for Create. */
  readonly proposalPending?: boolean;
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

/** A capitalised run after "for": the person a sentence is about. */
const FOR_PERSON = /\bfor\s+((?:[A-Z][\w'’-]*)(?:\s+[A-Z][\w'’-]*){0,3})/g;

/** Capitalised words after "for" that are not a person: a form, a day, a button. */
const NOT_A_PERSON =
  /^(?:the|a|an|her|him|them|this|that|my|our|your|being|not|no|today|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|corrective|coaching|ca|policy|written|verbal|final|finalize|create|review|now|it)$/i;

/** A form's own name in a sentence: "Corrective Action Form" → "corrective action". */
const FORM_NAME = /\b((?:[A-Z][\w-]*\s+){0,3}[A-Z][\w-]*)\s+Form\b/;

function peopleAfterFor(text: string): string[] {
  const people: string[] = [];
  for (const match of text.matchAll(FOR_PERSON)) {
    const words = match[1]!.split(/\s+/);
    if (NOT_A_PERSON.test(words[0]!)) continue;
    people.push(words.join(" "));
  }
  return people;
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

type Claim = "state" | "made" | "press-finalize" | "press-create";

function claimsIn(sentence: string): Claim[] {
  const claims: Claim[] = [];
  if (
    (DRAFT_STATE.test(sentence) || HERE_IS.test(sentence)) &&
    !HEDGED.test(sentence)
  )
    claims.push("state");
  if (
    SAID_I_MADE.test(sentence) &&
    !/\b(?:not|never|haven['’]t|hasn['’]t|didn['’]t)\b/i.test(sentence)
  ) {
    claims.push("made");
  }
  const press = sentence.match(PRESS);
  if (press)
    claims.push(
      press[1]!.toLowerCase() === "finalize"
        ? "press-finalize"
        : "press-create",
    );
  return claims;
}

/**
 * The reply with any claim of a draft that is not on screen replaced by one
 * honest line. Returns the content unchanged when it makes no such claim.
 */
export function withoutPhantomDraftClaim(
  content: string,
  context: NoCardClaimContext,
): string {
  const open = context.openForm ?? null;
  const lines = content
    .split("\n")
    .map((line) =>
      sentencesOf(line).map((text) => ({ text, claims: claimsIn(text) })),
    );
  const claimed = lines.flat().filter((sentence) => sentence.claims.length > 0);
  if (claimed.length === 0) return content;

  /** Whether a claim sentence speaks of a draft that does not exist. */
  const phantom = (sentence: { text: string; claims: Claim[] }): boolean =>
    sentence.claims.some((claim) => {
      if (claim === "press-create") return !context.proposalPending;
      if (claim === "press-finalize") return open?.status !== "draft";
      if (!open) return true;
      if (NEW_DRAFT.test(sentence.text)) return true;
      return peopleAfterFor(sentence.text).some(
        (person) => !samePersonName(person, open.employeeName),
      );
    });
  const phantoms = claimed.filter(phantom);
  if (phantoms.length === 0) return content;

  const person =
    phantoms.flatMap((sentence) => peopleAfterFor(sentence.text))[0] ??
    peopleAfterFor(context.question)[0] ??
    null;
  const named =
    phantoms
      .map((sentence) => sentence.text.match(FORM_NAME)?.[1])
      .find(Boolean) ?? null;
  const formWords = (
    named ?? (open ? open.templateName.replace(/\s+Form$/i, "") : "form")
  ).toLowerCase();
  const honest = person
    ? `I haven't created ${open && samePersonName(person, open.employeeName) ? "a new form" : "a form"} for ${person} yet — say "create a ${formWords} for ${person}" and I'll put a card here.`
    : `I haven't created a new form yet — say which form and who it's for (for example "create a corrective action for" and their name) and I'll put a card here.`;

  /*
   * Once a reply speaks of a draft that is not there, its "press Finalize on
   * the card" is about that same draft, so it goes too. A true line about the
   * form already open is kept.
   */
  const goes = (sentence: { text: string; claims: Claim[] }): boolean =>
    phantom(sentence) ||
    sentence.claims.some((claim) => claim.startsWith("press-"));
  let placed = false;
  const kept = lines.map((sentences) => {
    const parts: string[] = [];
    for (const sentence of sentences) {
      if (sentence.claims.length === 0 || !goes(sentence)) {
        parts.push(sentence.text);
        continue;
      }
      if (!placed) {
        parts.push(`${honest}${/\s$/.test(sentence.text) ? " " : ""}`);
        placed = true;
      }
    }
    return {
      text: parts.join("").trimEnd(),
      emptied:
        sentences.some((s) => s.text.trim() !== "") && parts.length === 0,
    };
  });
  return kept
    .filter((line) => !line.emptied)
    .map((line) => line.text)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
