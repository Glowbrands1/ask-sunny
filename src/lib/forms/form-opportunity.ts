import { extractJobTitle } from "./proposal";
import type { BoundedContext } from "./bounded-context";

/**
 * ============================================================================
 * WHEN A CONVERSATION IS ALREADY A FORM, AND NOBODY HAS SAID SO
 * ============================================================================
 *
 * "Jessica is an SDIT at Lincoln South. She's great with customers but she's
 * been late several times." is a complete performance-plan brief. Ask Sunny
 * answered it as a question about coaching and waited to be asked for a
 * document — so the manager's next move was to find "Create a form from this
 * conversation", press it, and be shown a picker for a decision the sentence
 * had already made.
 *
 * This module reads that sentence and says which forms are worth OFFERING.
 *
 * ============================================================================
 * OFFERING IS NOT CREATING, AND THAT LINE IS THE WHOLE SAFETY ARGUMENT
 * ============================================================================
 *
 * Nothing here creates, proposes, drafts or writes. It returns template keys
 * for the EXISTING form picker — the same cards an ambiguous request already
 * produces, which send `formRequestPhrase(name)` back through the composer and
 * land in `proposeFormForTurn` like any typed request. So a suggested form and
 * a typed form are the same request, resolved against the published library
 * and the actor's own permission, and there is no second creation path.
 *
 * IT NEVER RANKS A DISCIPLINARY FORM FIRST. A manager describing a problem is
 * not a manager asking to write somebody up: the framework's §7 is that
 * underperformance enters at coaching. The Corrective Action Form is offered
 * only where the manager has raised a formal step THEMSELVES, and never as the
 * primary card.
 *
 * ============================================================================
 * WHAT KEEPS IT QUIET
 * ============================================================================
 *
 * Three conditions, all required, and each removes a class of false positive:
 *
 *   A PERSON. Not "the team", not "everyone on Saturday". The employee is
 *   resolved by the caller through `resolveEmployee`, from the manager's own
 *   turns — the same reader the proposal uses.
 *
 *   SOMETHING OBSERVED ABOUT THEM. A behaviour, an attendance fact, a
 *   performance concern, a policy point, or praise paired with a development
 *   point. "Jessica is working Saturday" is a rota note and raises nothing.
 *
 *   A MANAGEMENT FRAME. The observation has to read as something a manager
 *   would document: a concern, a pattern, a coaching point, or a strength set
 *   against a gap. A single passing compliment is not a performance plan.
 */

export type FormOpportunityKind =
  /** Praise and a development point in the same breath — the EPP's own shape. */
  | "development"
  /** A concern on its own: coaching territory. */
  | "concern"
  /** The manager named a formal step, so the corrective form belongs on the list. */
  | "formal";

export interface FormOpportunity {
  readonly kind: FormOpportunityKind;
  /** The job title the manager stated, where they stated one. */
  readonly role: string | null;
  /** Why it fired, so a surprising card can be explained rather than guessed at. */
  readonly signals: string[];
}

function normalize(text: string): string {
  return (text ?? "").toLowerCase().replace(/[^\S\n]+/g, " ");
}

const any = (text: string, patterns: readonly RegExp[]) =>
  patterns.some((pattern) => pattern.test(text));

/**
 * A PROBLEM WORTH DOCUMENTING. Deliberately the vocabulary managers use about
 * behaviour, not about numbers: a metric on its own is §7's case and must not
 * conjure a form.
 */
const CONCERN: readonly RegExp[] = [
  /\b(?:late|lateness|tardy|tardiness|punctual\w*|overslept)\b/,
  /\bcall(?:ed|ing|s)?[- ]?off\b/,
  /\b(?:absent|absence|absenteeism|no[- ]call|no[- ]show|missed (?:her|his|their|the) shift)\b/,
  /\b(?:struggl\w+|inconsisten\w+|slipping|falling short|not meeting|needs? (?:to )?(?:work|improve)|needs improvement)\b/,
  /\b(?:unprofessional|rude|disrespect\w*|argued|arguing|insubordinat\w+|attitude)\b/,
  /\b(?:dress code|uniform|name ?tag|policy violation|violated (?:the|our) polic\w+)\b/,
  /\b(?:closing duties|opening duties|follow[- ]?through|accountab\w+)\b/,
  /\b(?:safety|hazard|spill|incident)\b/,
];

/** Praise, which on its own is not a form and beside a concern is an EPP. */
const STRENGTH: readonly RegExp[] = [
  /\b(?:great|good|strong|excellent|fantastic|brilliant|wonderful)\s+(?:with|at)\b/,
  /\b(?:does|doing) (?:really |very )?well\b/,
  /\b(?:strength|strengths|excels?|shines?|thrives?)\b/,
  /\b(?:improved|improving|has improved)\b/,
];

/** The manager has already reached for the formal ladder. */
const FORMAL: readonly RegExp[] = [
  /\b(?:corrective action|written warning|verbal warning|final warning|write (?:her|him|them) up|written up)\b/,
  /\b(?:disciplin\w+|performance plan|performance improvement|epp)\b/,
  /\bdocument(?:ed|ing)? (?:this|it|her|him|them)\b/,
];

/**
 * THE MANAGER HAS ALREADY TRIED THE FIRST RUNG. "I verbally coached her … and
 * she still is out of dress code" is a prior conversation plus a repeat, which
 * the framework answers with the next rung, not another coaching form. Both
 * halves are required, so a coaching conversation that worked ("I coached her
 * and she improved") and a first offence raise nothing.
 *
 * Ask Bubbles admin feedback, 16 Oct 2026 (ported from 8e3e81e): that exact
 * account was offered a Coaching Form alone, and the form that carries the
 * policy to acknowledge was never on the card.
 */
const PRIOR_ACTION: readonly RegExp[] = [
  /\b(?:verbal(?:ly)?|already)\s+(?:coach\w*|warn\w*|talk\w*|address\w*|spoke|spoken|discuss\w*|counsel\w*)\b/,
  /\b(?:coached|counseled|counselled|warned|talked to|spoke (?:to|with)|addressed|discussed (?:it |this )?with)\s+(?:her|him|them)\b/,
  /*
   * THE SAME FIRST RUNG, IN THE OTHER WAYS MANAGERS SAY IT. QA, 22 Oct 2026:
   * "I talked to Pat Rivera about being late and she was late again", "she
   * was coached last week", "she's been coached before", "she had a coaching
   * on 10/1", "previous coaching 10/1", "this is after her coaching", "we had
   * a talk with her", "we discussed attendance with her" each offered the
   * Coaching Form alone. A name for the pronoun, a passive, a conversation
   * held with her, an earlier step named as one, or what this follows.
   */
  /\b(?:coached|counseled|counselled|warned|talked (?:to|with)|spoke (?:to|with)|sat down with)\s+(?!(?:her|him|them)\b)[a-z][\w'’-]*(?:\s+[a-z][\w'’-]*)?\s+(?:about|regarding|over|on|for)\b/,
  /\b(?:was|were|(?:has|have|had)\s+been|['’]s\s+been)\s+(?:verbally\s+|formally\s+)?(?:coached|counseled|counselled|warned|written up|talked to|spoken to)\b/,
  /\b(?:had|has had|have had|got|received|was given)\s+(?:a\s+|an\s+)?(?:(?:verbal|written|formal)\s+)?(?:coaching|talk|conversation|sit[- ]?down|warning|write[- ]?up)\b/,
  /\b(?:previous|prior|earlier|last)\s+(?:(?:verbal|written)\s+)?(?:coaching|warning|write[- ]?up|talk|conversation|corrective action)s?\b/,
  /\b(?:after|since|following|despite)\s+(?:her|his|their|the|our|my)\s+(?:(?:last|previous|prior|recent|verbal|written)\s+)?(?:coaching|warning|write[- ]?up|talk|conversation|corrective action)\b/,
  /\b(?:discussed|went over|reviewed)\s+(?:[\w'’-]+\s+){1,4}?with\s+(?:her|him|them)\b/,
];
const RECURRENCE: readonly RegExp[] = [
  /\b(?:still|again|continu\w+|keeps?|repeated\w*|no change|did ?n[o']?t (?:change|improve|listen)|didn't (?:change|improve|listen))\b/,
];

/** What she keeps doing is ASKING for something, or the repeat is somebody else's (see `escalated`). */
const NOT_HER_CONDUCT: readonly RegExp[] = [
  /\b(?:still|keeps?|again|continues to)\s+(?:\w+\s+){0,2}?(?:wants?|wanting|asks?|asking|requests?|requesting|hopes?|hoping)\b/,
  /\b(?:wants?|asking for|asks for|requested|requesting)\s+(?:more\s+hours|fewer\s+hours|time off|(?:a\s+)?days?\s+off|(?:saturdays?|sundays?|weekends?)\s+off|a\s+raise|a\s+schedule\s+change)\b/,
  /\bwith\s+(?:the|our|a)\s+(?:vendor|landlord|contractor|supplier|maintenance|repair\w*|technician|corporate|customer|client|guest|delivery)\b/,
];

/** The manager says the coaching worked: no next rung. */
const COACHING_WORKED: readonly RegExp[] = [
  /\b(?:she|he|they|it)\s+(?:has\s+|have\s+)?(?:improved|got better|has gotten better|stopped|fixed it|turned it around)\b/,
];

/** The manager is already asking for management help, not for information. */
const MANAGEMENT_FRAME: readonly RegExp[] = [
  /\b(?:coach|coaching|address|addressing|sit down with|talk to (?:her|him|them)|coach (?:her|him|them))\b/,
  /\b(?:i need to|i have to|i should|we need to|what do i do|how do i handle)\b/,
  /\b(?:several (?:times|occasions)|again|keeps|keeps on|continues to|still|repeatedly|multiple times|this month|this week)\b/,
  ...FORMAL,
];

/**
 * A CASUAL MENTION, said out loud so it cannot be mistaken for a concern.
 *
 * These are the sentences that contain a person and a fact and are nobody's
 * performance plan. Checked FIRST and unconditionally: a rota note that also
 * happens to contain "late" — "Jessica is on the late shift" — is a rota note.
 */
const CASUAL: readonly RegExp[] = [
  /\blate shift\b/,
  /\b(?:is|are) (?:working|scheduled|on) (?:the )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|opening|closing|late|early)\b/,
  /\b(?:what|when|where|who|which|how) (?:is|are|does|do|did)\b.*\?$/,
];

/**
 * Whether this conversation is worth offering a form for.
 *
 * `employeeKnown` is passed in rather than read here, for the reason every
 * other module in this area passes it: the employee is resolved by
 * `resolveEmployee` from the manager's own turns, under rules this file has no
 * business restating.
 */
export function detectFormOpportunity(input: {
  readonly context: Pick<BoundedContext, "text">;
  readonly employeeKnown: boolean;
}): FormOpportunity | null {
  if (!input.employeeKnown) return null;

  const text = normalize(input.context.text);
  if (text.trim() === "") return null;

  const concern = any(text, CONCERN);
  const strength = any(text, STRENGTH);
  const formal = any(text, FORMAL);
  /*
   * A REPEAT THAT IS NOT HER CONDUCT, OR A COACHING THAT WORKED, IS NOT THE
   * NEXT RUNG. QA, 22 Oct 2026: "I already talked to her about the schedule
   * and she still wants more hours" and "I already addressed the broken bed
   * with the vendor again" read as a coaching that did not work, and put the
   * Corrective Action Form on the card. A request she keeps making, or
   * something taken up with a vendor or a customer, is not a behaviour that
   * repeated after coaching — unless a behaviour worth documenting is named
   * too. And "I coached her about dress code and she improved" is the
   * framework's success case, whatever else follows it.
   */
  const escalated =
    any(text, PRIOR_ACTION) &&
    any(text, RECURRENCE) &&
    !any(text, COACHING_WORKED) &&
    (concern || !any(text, NOT_HER_CONDUCT));
  const framed = any(text, MANAGEMENT_FRAME);

  /*
   * PRAISE ALONE IS NOT A FORM. "Jessica is great with customers" is a nice
   * thing to say about somebody and the start of no document. A development
   * conversation needs the other half.
   */
  if (!concern && !formal && !escalated) return null;

  /*
   * A CONCERN ON ITS OWN NEEDS A FRAME. One word off the concern list is not a
   * management situation — "she was late once, no big deal" is a manager
   * telling us it is fine. The frame is what says they are treating it as
   * something to handle.
   *
   * A CONCERN BESIDE A STRENGTH IS ALREADY THE FRAME, and this is the shape a
   * performance plan is literally made of: what somebody does well, and what
   * they are working on. "She's great with customers but she's been late
   * several times" and "doing really well with customers but needs to work on
   * productivity" are both a manager setting one against the other, which
   * nobody does in passing.
   */
  if (!formal && !escalated && !framed && !(strength && concern)) return null;

  /*
   * AND A ROTA NOTE IS A ROTA NOTE, whatever words it happens to contain.
   * "Jessica is on the late shift" has "late" in it and is nobody's
   * performance plan.
   *
   * CHECKED LAST, AND IT DOES NOT OVERRIDE THE MANAGER. "How do I handle
   * this?" reads as a question to the shape below and is a management frame
   * to the list above — the manager asking for help outranks a pattern
   * guessing from punctuation, so a stated frame or a named formal step wins.
   */
  if (any(text, CASUAL) && !formal && !framed) return null;

  const signals = [
    concern ? "concern" : null,
    strength ? "strength" : null,
    formal ? "formal step named" : null,
    escalated ? "prior coaching and recurrence" : null,
    framed ? "management frame" : null,
  ].filter((signal): signal is string => signal !== null);

  return {
    kind: formal || escalated ? "formal" : strength ? "development" : "concern",
    role: extractJobTitle(input.context.text),
    signals,
  };
}

/**
 * ============================================================================
 * WHICH FORMS TO OFFER, AND IN WHAT ORDER
 * ============================================================================
 *
 * A SHORT LIST, NOT THE LIBRARY. The picker already collapses everything past
 * the first card, but a manager who described one employee's punctuality
 * should not be shown the hiring forms at all.
 *
 * THE ROLE DECIDES WHETHER A PLAN LEADS. "Jessica is an SDIT" names the one
 * performance plan that fits her, so it goes first — the manager still clicks
 * it, and nothing is decided until they do. With no role stated there is no
 * plan to lead with, and coaching leads: it is the first documented rung and
 * the form most of these conversations end in.
 *
 * THE CORRECTIVE FORM IS LAST, and only where the manager raised a formal step
 * themselves. Offering it first to somebody describing lateness would be the
 * product suggesting a warning, which is exactly the substitution §7 of the
 * framework refuses.
 *
 * UNLESS THEY ASKED FOR IT. A manager who wrote "write a CA for Paisley" or
 * "I need it to be a corrective action form" has made the decision; leading
 * with the Coaching Form is the same substitution in the other direction.
 */
export function suggestedTemplateKeys(input: {
  readonly opportunity: FormOpportunity;
  /** The plan the stated role names, from `eppTemplateForRole`. */
  readonly rolePlanKey: string | null;
  /** The manager's own turns asked for a Corrective Action Form. */
  readonly correctiveActionRequested?: boolean;
}): string[] {
  const keys: string[] = [];
  if (input.correctiveActionRequested) keys.push("dpoa");
  if (input.rolePlanKey) keys.push(input.rolePlanKey);
  keys.push("coaching");
  if (input.opportunity.kind === "formal") keys.push("dpoa");
  return [...new Set(keys)];
}

/** The line that introduces the cards. Short, and it decides nothing. */
export function formOpportunityLead(): string {
  return "Based on what you've described, I can prepare:";
}
