import "server-only";

import { randomUUID } from "node:crypto";

import {
  buildProposal,
  extractEmployeeNames,
  managerContext,
  resolveEmployee,
  type ManagerContext,
} from "@/lib/forms/proposal";
import {
  detectTemplateIntent,
  eppTemplateForRole,
  isFormVocabulary,
  type TemplateIntent,
} from "@/lib/forms/template-intent";
import {
  eppIntakePlan,
  eppIntakeRequest,
  readEppIntake,
  type EppIntakePlan,
  type EppIntakeReading,
} from "@/lib/forms/epp-intake";
import {
  asksToBeGuided,
  describesIncident,
  correctiveActionBasis,
  correctiveActionIntakeRequest,
  readCorrectiveActionIntake,
  type IntakeReading,
} from "@/lib/forms/corrective-action-intake";
import { offeredInChooser } from "@/lib/forms/chooser";
import { exitDetailsSupplied, readExitDetails } from "@/lib/forms/exit-details";
import {
  PAYROLL_DEDUCT_KEY,
  PAYROLL_DEDUCT_LABEL,
  payrollDeductFromConversation,
} from "@/lib/forms/payroll-deduct";
import { checkboxGroupsForVariant } from "@/lib/forms/document";
import { exitFactsSupplied, readExitFacts } from "@/lib/forms/exit-facts";
import {
  exitEmployeeQuestion,
  exitIntakeRequest,
  exitNothingSupplied,
  exitReady,
} from "@/lib/forms/exit-intake";
import {
  describeKnownFacts,
  employmentChangeKind,
  formDateFor,
  hasStatedFacts,
  isQuestion,
  joinList,
  missingDetails,
  readEmploymentChange,
  type EmploymentChangeFacts,
  type EmploymentChangeKind,
} from "@/lib/forms/employment-change";
import { businessToday } from "@/lib/business-date";
import { extractFormDate } from "@/lib/forms/form-date-answer";
import { endsIntake } from "@/lib/forms/proposal-continuation";
import {
  CLARIFIED_TEMPLATE_KEY,
  FORM_OR_GUIDANCE_QUESTION,
  answersFormClarification,
} from "@/lib/forms/form-clarification";
import { inlineDraftVariantKey, supportsInlineDraft } from "@/lib/forms/inline-draft";
import { buildFormInventory } from "@/lib/forms/inventory";
import {
  detectFormOpportunity,
  formOpportunityLead,
  suggestedTemplateKeys,
} from "@/lib/forms/form-opportunity";
import { type TemplateSummary } from "@/lib/forms/repository";
import { DEFAULT_PERMISSION_MATRIX, hasPermission } from "@/lib/permissions";
import type {
  AccessScope,
  ChatFormChoice,
  ChatFormProposal,
  ChatFormSelection,
  ChatMessage,
  Permission,
  Role,
} from "@/types";

import { answerCorrectiveAction } from "./form-answers";
import type { AskResponse } from "./types";

/*
 * WHICH TEMPLATES CAN BE CREATED WITHOUT LEAVING CHAT now lives in
 * `lib/forms/inline-draft.ts`, because the inventory that TELLS a manager
 * whether Sunny can build a form has to give the same answer as the card that
 * offers to. Two copies of that set is how a card comes to offer a form the
 * sentence beside it says is unavailable.
 */

/**
 * The form offered first when the manager has not named one.
 *
 * A PRESENTATION ORDER, NOT A DEFAULT, and the distinction is the whole rule
 * this module enforces. Nothing resolves to this key: an unnamed request still
 * produces a question, and this only decides which card the manager sees
 * without expanding the rest. It is honoured only if the published library and
 * this actor's permissions both allow it.
 */
const PRIMARY_TEMPLATE_KEY = "coaching";

/**
 * ============================================================================
 * THE PERMISSION IS WHAT IDENTIFIES THE CORRECTIVE ACTION FORM
 * ============================================================================
 *
 * Not the key, and deliberately not the key. `create_corrective_action` is
 * carried by exactly one template in the library — the Policy Review has
 * `create_policy_review`, the coaching forms `create_coaching_form`, the six
 * performance plans `create_epp` — and it is the property that says what the
 * document IS rather than what it was historically called.
 *
 * That matters here more than anywhere: the stored key is `dpoa`, kept for
 * every filed record that addresses it, and a module that recognised the form
 * by that key would spread the legacy name into the one place the rename is
 * supposed to be complete. A deployment that republishes this form under a new
 * key keeps working; one that publishes a second form under this permission is
 * a library problem, and `find` taking the first is the same rule the rest of
 * this file follows.
 */
function isCorrectiveActionForm(summary: TemplateSummary): boolean {
  return summary.requiredPermission === "create_corrective_action";
}

/**
 * THE RESIGNATION/EXIT FORM, by the same token: `create_exit_form` is carried
 * by that one template, and says what the document is.
 */
function isExitForm(summary: TemplateSummary): boolean {
  return summary.requiredPermission === "create_exit_form";
}

/**
 * Whether the PUBLISHED version asks "Is payroll deduct applicable?".
 *
 * Read off the version a created form would pin, not off the seed: a database
 * that has not published the revision carrying the question yet (an open
 * draft holds it back — see `publishSeedRevision`) must not be asked for an
 * answer its form has nowhere to put.
 */
function asksPayrollDeduct(summary: TemplateSummary): boolean {
  const version = summary.currentVersion;
  if (!version?.document) return false;
  return checkboxGroupsForVariant(version.document, inlineDraftVariantKey(version.variants ?? [])).some(
    (group) => group.key === PAYROLL_DEDUCT_KEY,
  );
}

/**
 * ============================================================================
 * A PERFORMANCE PLAN ASK SUNNY CAN ACTUALLY BUILD IN THIS CONVERSATION
 * ============================================================================
 *
 * TWO CONDITIONS, AND BOTH ARE LOAD-BEARING.
 *
 * `create_epp` says the document IS a performance plan. It is carried by six
 * templates, which is why it cannot be the whole test — the intake below ends
 * by promising to draft the form, and promising that for a document the chat
 * flow refuses to create would be a lie told in the first sentence.
 *
 * `supportsInlineDraft` says the workflow EXISTS for this one, read off the
 * published version. Today that intersection is the SDIT EPP; the day another
 * plan's workflow ships it is that one too, with no edit here.
 *
 * NOT KEYED ON A TEMPLATE KEY, deliberately, and for the reason
 * `isCorrectiveActionForm` gives above: a permission and a published version
 * say what a document IS and what this build can do with it. A key says what it
 * was historically called.
 */
function isPerformancePlan(summary: TemplateSummary): boolean {
  return (
    summary.requiredPermission === "create_epp" &&
    supportsInlineDraft(summary.key, summary.currentVersion?.variants ?? [])
  );
}

/**
 * ============================================================================
 * A FORM PROPOSAL, ASSEMBLED SERVER-SIDE
 * ============================================================================
 *
 * `proposal.ts` reads a conversation; this file decides whether the thing it
 * read corresponds to a form this person may actually create. Three checks, in
 * this order, and a failure at any of them produces a QUESTION rather than a
 * proposal:
 *
 *   1. IS IT A REAL TEMPLATE?      resolved against `form_templates`, not
 *                                  against a keyword map. A key the sentence
 *                                  suggested is an intent; a published, active
 *                                  template with a published current version is
 *                                  a fact.
 *
 *   2. MAY THIS PERSON CREATE IT?  the TEMPLATE's own `required_permission`,
 *                                  applied through the server's matrix. No role
 *                                  list is written here, and nothing is
 *                                  broadened: a Salon Director who cannot
 *                                  create a Corrective Action Form in Forms
 *                                  cannot obtain one by
 *                                  asking Sunny for it.
 *
 *   3. WHAT IS ACTUALLY KNOWN?     employee from the manager's own turns, salon
 *                                  from the authenticated scope. Whatever is
 *                                  missing is named as missing.
 *
 * ============================================================================
 * THE PROPOSAL IS NOT THE HR RECORD
 * ============================================================================
 *
 * Nothing in this file writes. There is no `form_instances` insert, no template
 * version pinned, no field value, no follow-up date, no PDF. A proposal is a
 * statement of what Sunny WOULD create and what it still needs — and it stays
 * that way until a manager confirms it, which is not built yet and is not
 * pretended to be.
 */

/**
 * The authenticated caller, as chat needs it.
 *
 * A SEPARATE ARGUMENT FROM `AskRequest`, DELIBERATELY. `AskRequest` is parsed
 * from the request body; anything on it is something the browser could send. A
 * role and a scope are exactly the two values a caller must never be able to
 * assert about itself, so they travel on their own parameter, filled by the
 * route from the authorized context.
 */
export interface ChatActor {
  role: Role | null;
  /** `null` when no identity provider vouched for a scope. Never enforced against. */
  scope: AccessScope | null;
}

export interface ProposalTurn {
  history: Pick<ChatMessage, "id" | "role" | "content" | "error">[];
  question: string;
  /**
   * Browser-local id of the manager's turn being answered. Provenance only —
   * see `ManagerContext`. Absent when the client did not send one.
   */
  questionMessageId?: string;
  actor: ChatActor;
  /**
   * The template of the proposal on the previous assistant turn, when one is
   * still open. Browser-supplied and revalidated like everything else — see
   * `lib/forms/proposal-continuation.ts`.
   */
  continueTemplateKey?: string;
  /**
   * The published library, read ONCE per turn by the caller.
   *
   * Passed in rather than fetched here so that the proposal, the inventory the
   * prompt is given, and any inventory answer all describe the SAME snapshot. A
   * second read could land either side of a publish, and then a card would
   * offer a form the block beside it did not list.
   */
  summaries: readonly TemplateSummary[];
  /**
   * Whether the Performance Management Framework is available for this turn.
   *
   * A THUNK, so the retrieval happens only on the one branch that needs it.
   * "Create a corrective action for Sarah" is the sole request whose answer
   * asserts the approved progression, and every other request through this
   * module would otherwise pay for a knowledge query it never reads.
   *
   * Absent means "not established", which is treated as unavailable: a caller
   * that cannot say the framework is healthy has not said it is.
   */
  progressionAvailable?: () => Promise<boolean>;
  /**
   * The server's business day (`YYYY-MM-DD`), which supplies the year for a
   * form date typed as month and day. See `lib/forms/form-date-answer.ts`.
   */
  today?: string;
}

/** A template a real person may actually start today. */
function isCreatable(summary: TemplateSummary): boolean {
  return summary.active && summary.currentVersion?.status === "published";
}

function permits(actor: ChatActor, summary: TemplateSummary): boolean {
  if (!actor.role) return false;
  return hasPermission(
    DEFAULT_PERMISSION_MATRIX,
    actor.role,
    summary.requiredPermission as Permission,
  );
}

function bulletList(names: string[]): string {
  return names.map((name) => `- ${name}`).join("\n");
}

/** Every response from this module is a proposal turn, not a knowledge answer. */
function turn(
  content: string,
  formProposal?: ChatFormProposal,
  formSelection?: ChatFormSelection,
): AskResponse {
  return {
    content,
    // A proposal is not an answer drawn from the knowledge base, so it carries
    // no citations and coverage is not a meaningful question about it.
    // "The knowledge base does not cover this" would be a misleading thing to
    // show under a question Sunny answered correctly.
    citations: [],
    coverage: "not_applicable",
    recommendedVideoIds: [],
    formProposal,
    formSelection,
  };
}

/**
 * Reads a form request and returns either a proposal or the question that has
 * to be answered before one exists.
 *
 * @returns `null` when the turn is not a form request, so the caller falls
 *          through to the ordinary grounded-answer path.
 */
export async function proposeFormForTurn(input: ProposalTurn): Promise<AskResponse | null> {
  const intent = intentForTurn(input);
  if (intent.kind === "none") return null;

  const summaries = input.summaries;
  const available = summaries.filter(isCreatable).filter((summary) => permits(input.actor, summary));

  /*
   * ==========================================================================
   * WHAT MAY BE PUT IN FRONT OF SOMEBODY WHO HAS NOT NAMED A FORM
   * ==========================================================================
   *
   * `available` is the authorization answer — published, active, and permitted
   * for this actor — and it stays exactly that, because every check in this
   * module still runs against it. `offered` is the narrower SUGGESTION answer:
   * the forms Sunny volunteers when the manager has not chosen one. See
   * `lib/forms/chooser.ts` for which are withheld and why.
   *
   * THE ORDER MATTERS. Withholding is applied AFTER permission, never instead
   * of it, so a form nobody may create is still absent from both lists.
   *
   * NOTHING BELOW RESOLVES A NAMED FORM THROUGH THIS. A manager who names one
   * of the withheld templates is matched against `summaries` and checked
   * against `permits` as before — a suggestion list is not an allow-list.
   */
  const offered = available.filter((summary) => offeredInChooser(summary.key));

  /*
   * ==========================================================================
   * "CORRECTIVE ACTION" NAMES THE PROGRESSION, NOT A DOCUMENT
   * ==========================================================================
   *
   * The phrase used to be a matcher for the form itself, so a manager
   * who typed "I need to do a corrective action for Sarah" was handed a formal
   * warning selected for them by a keyword. §2 of the approved Performance
   * Management Framework is explicit that corrective action is the whole ladder
   * and the Corrective Action Form records its seventh rung.
   *
   * TWO DIFFERENT SENTENCES, TWO DIFFERENT ANSWERS. Asking for one to be
   * STARTED needs the document settled first, and that is a question — answered
   * with the ladder and the forms that record its rungs, all named from the
   * library. Asking what corrective action IS is a knowledge question, so it
   * returns null and goes to the grounded path, which pins the framework and
   * cites it. Neither branch proposes anything.
   */
  if (intent.kind === "corrective_action") {
    /*
     * ========================================================================
     * "WHAT IS CORRECTIVE ACTION?" IS STILL A KNOWLEDGE QUESTION
     * ========================================================================
     *
     * No creation verb, no document. It returns null and goes to the grounded
     * path, which pins the Performance Management Framework and cites it.
     */
    if (!intent.requestedCreation) return null;

    /*
     * ========================================================================
     * "CREATE A CORRECTIVE ACTION" IS A REQUEST FOR THE FORM — WITH ONE
     * EXCEPTION, AND THE EXCEPTION IS THE FRAMEWORK'S OWN
     * ========================================================================
     *
     * This branch used to answer every creation request with the ladder and a
     * question about which document. That was right while the seventh rung was
     * called something else: "corrective action" named the progression and
     * nothing else, so a manager typing it had not yet named a document.
     *
     * The rename settled it. The document a manager means when they ask to
     * create a corrective action is the Corrective Action Form, and answering
     * with a paragraph about the ladder — to somebody who has just named the
     * form — is the friction this work exists to remove. The intake is the
     * answer: ask for what the form needs, then build it.
     *
     * WHAT SURVIVES IS §7, WHICH IS A DIFFERENT RULE. Underperformance enters
     * the ladder at coaching. "Their Club Close is low, create a corrective
     * action" is a metric being used as grounds for formal accountability, and
     * the framework's answer to it is the progression rather than the form. So
     * the manager's stated BASIS is read — see `correctiveActionBasis`, which
     * diverts only when a metric is named, judged, and unaccompanied by
     * anything about anybody's behaviour — and everything else goes to the
     * form.
     */
    const correctiveActionForm = available.find(isCorrectiveActionForm);
    const basis = correctiveActionBasis(
      managerContext(input.history, {
        id: input.questionMessageId,
        content: input.question,
      }).text,
    );

    if (correctiveActionForm && basis !== "metric_only") {
      return proposeTemplate(input, correctiveActionForm);
    }

    return answerCorrectiveAction({
      inventory: buildFormInventory(summaries, input.actor),
      role: input.actor.role,
      /*
       * THE LADDER IS SHOWN ONLY IF THE DOCUMENT THAT DEFINES IT ANSWERED.
       * `CORRECTIVE_ACTION_LADDER` maps §2's rungs onto template keys, and a
       * map in a source file cannot know §2 was re-issued. See the note on
       * `answerCorrectiveAction`.
       */
      progressionAvailable: (await input.progressionAvailable?.()) ?? false,
      /*
       * WHY THE LADDER IS BEING SHOWN, when the manager asked for a document.
       * A metric-only request gets the progression instead of the form, and an
       * answer that does not say so reads as Ask Sunny failing to understand a
       * plain sentence rather than as the rule it is.
       */
      metricOnly: basis === "metric_only",
    });
  }

  if (intent.kind === "ambiguous") {
    return turn(ambiguousContent(offered), undefined, formSelection(offered));
  }

  if (intent.kind === "clarify") {
    // Only a form this manager can actually start is offered as the other half.
    const clarified = available.find((summary) => summary.key === intent.templateKey);
    return clarified ? clarifyFormOrGuidance(input, clarified) : null;
  }

  const match = summaries.find((summary) => summary.key === intent.templateKey);

  /*
   * NAMED SOMETHING THE LIBRARY DOES NOT PUBLISH.
   *
   * Not an error and not a silent substitution. The prototype's answer to this
   * situation was the Coaching Form; the answer here is to say so and list what
   * this deployment actually has.
   */
  if (!match || !isCreatable(match)) {
    return turn(
      [
        "That form is not published in Ask Sunny yet, so I will not stand in for it with a different one.",
        "",
        offered.length > 0
          ? `Here is what you can start today:\n\n${bulletList(offered.map((summary) => summary.name))}`
          : "There are no published forms available to you right now — an administrator publishes them under Form Templates.",
      ].join("\n"),
    );
  }

  /*
   * THE TEMPLATE'S OWN PERMISSION, NOT A ROLE LIST WRITTEN IN CHAT.
   *
   * `required_permission` is data on the template row, which is why a Salon
   * Director may be offered a Coaching Form and refused a Corrective Action
   * Form without either rule appearing here.
   */
  if (!permits(input.actor, match)) {
    return turn(
      [
        `Your role cannot create a **${match.name}**, so I will not propose one.`,
        "",
        offered.length > 0
          ? `You can start these:\n\n${bulletList(offered.map((summary) => summary.name))}`
          : "Ask your district manager which forms your role should cover.",
      ].join("\n"),
    );
  }

  /*
   * ==========================================================================
   * §7 APPLIES TO THE NAMED FORM TOO
   * ==========================================================================
   *
   * A manager who names the Corrective Action Form and gives a low metric as
   * the reason is making the same request as one who says "create a corrective
   * action" — the framework's answer is the ladder either way, and a rule that
   * could be stepped over by naming the document is not a rule.
   *
   * It costs nothing in the ordinary case: `correctiveActionBasis` diverts only
   * when a metric is named, judged, and unaccompanied by anything about
   * anybody's behaviour. Say what happened and the form is proposed.
   */
  if (isCorrectiveActionForm(match)) {
    const basis = correctiveActionBasis(
      managerContext(input.history, {
        id: input.questionMessageId,
        content: input.question,
      }).text,
    );
    if (basis === "metric_only") {
      return answerCorrectiveAction({
        inventory: buildFormInventory(summaries, input.actor),
        role: input.actor.role,
        progressionAvailable: (await input.progressionAvailable?.()) ?? false,
        metricOnly: true,
      });
    }
  }

  return proposeTemplate(input, match);
}

/**
 * Builds the proposal for a template that has already passed both checks.
 *
 * SEPARATE SO THE CORRECTIVE-ACTION BRANCH CAN REACH IT. That branch resolves
 * its template from the library rather than from a matcher, and a second copy
 * of this assembly is how the two paths would come to pin different things.
 */
function proposeTemplate(input: ProposalTurn, match: TemplateSummary): AskResponse {
  const context = managerContext(input.history, {
    id: input.questionMessageId,
    content: input.question,
  });

  const proposal = buildProposal({
    /*
     * SERVER-GENERATED, never taken from the request. A proposal id is how a
     * later confirmation step will name the thing being confirmed; a
     * caller-chosen one would let a caller name somebody else's.
     */
    proposalId: randomUUID(),
    templateKey: match.key,
    templateName: match.name,
    context,
    scope: input.actor.scope,
    /*
     * READ OFF THE PUBLISHED VERSION, not off the key alone. `supportsInlineDraft`
     * also refuses a template that declares variants: the chat flow sends no
     * variant, so an EPP created here would pin `null` and print "In what areas
     * is the the employee currently succeeding?" on a performance plan.
     */
    inlineDraftSupported: supportsInlineDraft(
      match.key,
      match.currentVersion?.variants ?? [],
    ),
    /*
     * THE READING TO PIN, taken off the published version rather than the seed
     * — the same source `supportsInlineDraft` reads, so the two can never
     * disagree about a template. Null where the document prints one way, which
     * is what the column has always held for those.
     */
    variantKey: inlineDraftVariantKey(match.currentVersion?.variants ?? []),
    today: input.today,
    /*
     * The exit form is dated the day it is completed. Its conversation is
     * made of other dates — the last day worked, the notice — and the first of
     * them is not the form's.
     */
    formDateFromConversation: !isExitForm(match),
  });

  /*
   * ==========================================================================
   * A DEMOTION'S JOB TITLE IS THE ONE THEY ARE MOVING FROM
   * ==========================================================================
   *
   * `extractJobTitle` reads the most specific title anywhere in the
   * conversation, which on "from salon director to tanning consultant" is the
   * NEW one — so the form's Job Title line would have printed the title the
   * employee is leaving for. On these forms Job Title is the current title,
   * and it is read with the direction the manager gave it; where they gave
   * only the new one, the line is left for them.
   *
   * The same holds for the date: "effective october 5" is when the change
   * takes effect, not the date the form is written.
   */
  /*
   * THE PAYROLL-DEDUCT ANSWER, FROM THE WHOLE CONVERSATION. Read over both
   * sides because a bare "no" answers only the question Ask Sunny asked just
   * before it — the assistant turns say WHICH question, never the answer.
   */
  if (isCorrectiveActionForm(match) && asksPayrollDeduct(match)) {
    proposal.payrollDeduct = payrollDeductFromConversation([
      ...input.history,
      { role: "user", content: input.question },
    ]);
  }

  const changeKind = employmentChangeKind(match.key);
  /*
   * ONLY THE TURNS ABOUT THIS FORM AND THIS PERSON. Found in hands-on QA: a
   * transfer for one employee, asked for right after a demotion for another in
   * the same conversation, picked up the other employee's new pay rate —
   * because the facts, and the notes the draft is written from, were read from
   * every recent manager turn. See `turnsAboutThisForm`.
   */
  const scoped = changeKind
    ? turnsAboutThisForm(context, match.key, proposal.employeeName)
    : context;
  const facts = changeKind
    ? readEmploymentChange(
        scoped.messages.map((message) => message.content),
        input.today ?? businessToday(),
      )
    : null;
  if (changeKind && facts) {
    proposal.employeeRole = facts.current.title ?? null;
    proposal.formDate = formDateFor(scoped.text, input.today ?? businessToday());
    proposal.sourceMessageIds = scoped.ids;
  }

  return turn(
    changeKind && facts
      ? employmentChangeContent(changeKind, facts, proposal, context)
      : proposalContent(proposal, context, match, input.today ?? businessToday()),
    proposal,
  );
}

/* ----------------------------------------------------------- proactive -- */

export interface SuggestedForms {
  /** The sentence above the cards. */
  readonly lead: string;
  readonly selection: ChatFormSelection;
}

/**
 * ============================================================================
 * OFFERING THE FORM THE CONVERSATION IS ALREADY ABOUT
 * ============================================================================
 *
 * A manager who writes "Jessica is an SDIT at Lincoln South, great with
 * customers but late several times" has written a performance-plan brief.
 * Before this, they got a coaching answer and then had to find "Create a form
 * from this conversation", press it, and choose from a picker for a decision
 * their own sentence had already made.
 *
 * ============================================================================
 * IT OFFERS. IT DOES NOT DECIDE, AND IT DOES NOT CREATE.
 * ============================================================================
 *
 * What comes back is a `ChatFormSelection` — the SAME cards an ambiguous
 * request already produces. A card sends `formRequestPhrase(name)` through the
 * composer, so a suggested form and a typed form arrive at
 * `proposeFormForTurn` as one request, resolved against the published library
 * with the template's own permission applied. There is no second engine and no
 * card that skips a check.
 *
 * EVERY FILTER THE PICKER ALREADY HAS STILL APPLIES: published, active, and
 * permitted to this actor. A form this manager may not create is never named.
 *
 * RETURNS NULL FOR ANYTHING THIS TURN ALREADY ANSWERED. A turn that produced a
 * proposal or a picker of its own does not get a second set of cards under it;
 * `answerQuestion` only calls this on the plain grounded path.
 */
export function suggestFormsForTurn(input: ProposalTurn): SuggestedForms | null {
  const context = managerContext(input.history, {
    id: input.questionMessageId,
    content: input.question,
  });

  const employee = resolveEmployee(context);
  const opportunity = detectFormOpportunity({
    context,
    /*
     * AMBIGUOUS COUNTS AS KNOWN. Two names is two candidates for the PROPOSAL
     * to sort out; for deciding whether a form is worth offering, the manager
     * has plainly been talking about people.
     */
    employeeKnown: employee.kind !== "missing",
  });
  if (!opportunity) return null;

  const available = input.summaries
    .filter(isCreatable)
    .filter((summary) => permits(input.actor, summary))
    /*
     * THE SAME WITHHOLDING THE PICKER APPLIES, because this is the picker —
     * the cards are a `ChatFormSelection` like any other, and a rule about
     * what Sunny may put in front of somebody cannot hold at one producer of
     * them and not the other.
     *
     * IT CHANGES NOTHING TODAY, and that is the point of putting it here
     * rather than leaving it to `suggestedTemplateKeys`: that function asks
     * for `coaching`, `dpoa` and the role's plan, none of which is withheld,
     * so every form this feature suggests it still suggests. What the filter
     * buys is that the day a withheld key is added there, it is dropped here
     * instead of reappearing in a card.
     */
    .filter((summary) => offeredInChooser(summary.key));
  if (available.length === 0) return null;

  const wanted = suggestedTemplateKeys({
    opportunity,
    /*
     * The plan the manager's own words name, through the same reader the
     * explicit path uses — so "make an EPP" and a suggested card resolve the
     * same role to the same template.
     */
    rolePlanKey: eppTemplateForRole(context.text),
  });

  /*
   * ORDERED BY THE SUGGESTION, NOT BY `display_order`. The whole point is that
   * the role-specific plan leads; falling back to the library's order would
   * put the Coaching Form in front of it again.
   */
  const offered = wanted
    .map((key) => available.find((summary) => summary.key === key))
    .filter((summary): summary is TemplateSummary => summary !== undefined);
  if (offered.length === 0) return null;

  return {
    lead: formOpportunityLead(),
    selection: {
      primary: choice(offered[0]!),
      additional: offered.slice(1).map(choice),
    },
  };
}

/* --------------------------------------------------------- continuation -- */

/**
 * ============================================================================
 * WHAT THIS TURN IS ASKING FOR, INCLUDING "IT ANSWERS THE LAST QUESTION"
 * ============================================================================
 *
 * A turn naming a form is read as it always was. A turn naming none is a form
 * request only when BOTH hold:
 *
 *   1. the previous assistant turn left a proposal open, and
 *   2. this turn reads as an ANSWER to what that proposal was missing —
 *      concretely, it yields an employee name.
 *
 * THE SECOND CONDITION IS WHY THIS DOES NOT SWALLOW THE CONVERSATION. Without
 * it, every turn after a proposal would be routed into the form flow, so
 * "what is the tardiness policy?" asked while a proposal was open would come
 * back as a form card instead of an answer. `extractEmployeeNames` is
 * deliberately conservative — it refuses a capitalised leading word — so an
 * instruction or a question yields nothing and falls through to retrieval.
 *
 * The hint itself confers nothing: `proposeFormForTurn` revalidates the key
 * against the published library and applies the template's own permission,
 * exactly as it does for a typed request.
 */
function intentForTurn(input: ProposalTurn): TemplateIntent {
  const spoken = detectTemplateIntent(input.question);
  const continued = input.continueTemplateKey?.trim();

  /*
   * AN OPEN PROPOSAL ANSWERS "WHICH FORM?" ALREADY.
   *
   * A manager who is mid-proposal and asks for "a form" — by typing it, or by
   * pressing "Create a form from this conversation" in the rail — means the one
   * on screen. Asking them to choose again would be the assistant forgetting
   * what it just offered, one turn later.
   *
   * This is NOT the forbidden default. Nothing is guessed: the template comes
   * from a proposal this conversation already produced, and the key is
   * revalidated against the published library and the actor's permission like
   * any other. With no open proposal, an ambiguous request stays ambiguous and
   * the manager is asked.
   */
  if (spoken.kind === "ambiguous") {
    if (continued) return { kind: "explicit", templateKey: continued };

    /*
     * ======================================================================
     * "EMPLOYEE PERFORMANCE PLAN" PLUS A ROLE THEY ALREADY GAVE US
     * ======================================================================
     *
     * "Jessica is an SDIT at Lincoln South. She's great with clients but she's
     * been late several times." — then "make an EPP from this conversation".
     * The family is named in this turn and the role was named in an earlier
     * one, and between them they name a document as precisely as typing "SDIT
     * EPP" would.
     *
     * STILL NOT A DEFAULT, and the test is the same one this whole module
     * applies: is anything being GUESSED? No — the role is the manager's own
     * word, it maps to exactly one published plan, and a conversation naming
     * no role or two roles resolves to nothing and falls through to the
     * picker. The key is revalidated against the published library and this
     * actor's permission like every other.
     *
     * READ THROUGH `managerContext`, so an assistant turn can never be what
     * names the role and the look-back is the same bounded window the proposal
     * itself uses.
     */
    if (spoken.family === "epp") {
      const context = managerContext(input.history, {
        id: input.questionMessageId,
        content: input.question,
      });
      const byRole = eppTemplateForRole(context.text);
      if (byRole) return { kind: "explicit", templateKey: byRole };
    }

    /*
     * AND SO DOES HAVING ALREADY SAID IT.
     *
     * A manager who typed "Coaching Form for Sarah Test, she was late today"
     * and then pressed the rail button has named the form once already.
     * Answering with the full library is the assistant forgetting a sentence
     * the manager can still see on screen, and it is the redundancy that made
     * the rail button feel broken.
     *
     * STILL NOT A DEFAULT. Nothing is guessed and nothing is inferred from the
     * assistant's own words: this reads THE MANAGER'S OWN TURNS, through the
     * same bounded window everything else uses, and takes the most recent form
     * they named. Where they never named one, the request stays ambiguous and
     * they are asked. The key is revalidated against the published library and
     * their permission like any other.
     */
    const named = namedInManagerTurns(input);
    if (named.kind === "explicit") return named;
    return spoken;
  }

  /*
   * "COACH AVERY" WHILE A COACHING INTAKE IS OPEN names the person for the
   * form already on screen; with none open it is the question advice-or-form.
   */
  if (spoken.kind === "clarify") {
    return continued === spoken.templateKey ? { kind: "explicit", templateKey: continued } : spoken;
  }

  if (spoken.kind !== "none") return spoken;

  /* "The form", in reply to "coaching guidance, or a Coaching Form?". */
  if (answersFormClarification(input.history, input.question)) {
    return { kind: "explicit", templateKey: CLARIFIED_TEMPLATE_KEY };
  }

  if (!continued) return { kind: "none" };

  /*
   * AN OPEN EXIT FORM IS ALSO ANSWERED BY ITS FACTS. Sunny asks "what was
   * their last day worked?" and "how did they leave?" — and "her last day was
   * 9/15" or "she quit on the spot" names nobody, so the name test below would
   * send the answer to retrieval. The same deliberately narrow reader the
   * proposal uses decides: a turn that establishes a departure fact continues
   * the proposal; a question about the tardiness policy establishes none and
   * still goes to retrieval. The key is revalidated like any other.
   */
  const open = input.summaries.find((summary) => summary.key === continued);
  if (
    open &&
    isExitForm(open) &&
    // An answer, not a question: "how many no call no shows do we allow?"
    // mentions a departure fact and is still a question for retrieval.
    !/\?\s*$/.test(input.question) &&
    exitAnswers(input.question, input.today ?? businessToday())
  ) {
    return { kind: "explicit", templateKey: continued };
  }

  /*
   * AN OPEN CORRECTIVE ACTION FORM IS ALSO ANSWERED BY ITS PAYROLL QUESTION.
   * Sunny asks "Is payroll deduct applicable?" and "no" names nobody, so the
   * name test below would send it to retrieval. Read against the question it
   * replies to — the last assistant turn — and never when it is a question.
   */
  if (open && isCorrectiveActionForm(open) && asksPayrollDeduct(open) && !/\?\s*$/.test(input.question)) {
    const lastAssistant = [...input.history].reverse().find((message) => message.role === "assistant");
    const replied = payrollDeductFromConversation([
      ...(lastAssistant ? [lastAssistant] : []),
      { role: "user", content: input.question },
    ]);
    if (replied) return { kind: "explicit", templateKey: continued };
  }

  // Does this turn read as part of the intake, or as a new subject?
  if (!continuesIntake(continued, input)) return { kind: "none" };

  return { kind: "explicit", templateKey: continued };
}

/**
 * ============================================================================
 * WHAT COUNTS AS THE NEXT TURN OF AN INTAKE
 * ============================================================================
 *
 * This used to be "the turn yields an employee name", and nothing else. VERIFIED
 * IN PRODUCTION QA, 30 September 2026: with a Coaching intake open,
 *
 *     "she missed the opening checklist today"
 *
 * names nobody, so it went to retrieval, came back as coaching advice, and the
 * intake was over — the manager had to start again and restate the form and
 * the employee. Each of employee, topic, date and facts is part of the same
 * intake and arrives in its own turn, so each continues it:
 *
 *   a name              "employee: avery testperson", "I already said Avery"
 *   what happened       "she missed the opening checklist" (`describesIncident`,
 *                       or a sentence about her, him or them)
 *   when                "today", "9/28"
 *   what it is about    "topic is store tours", "the reason is attendance"
 *   carrying on         "keep this as coaching", "same form", "go ahead"
 *   a change's details  the employment change forms' own reader
 *
 * WHAT STILL LEAVES IT, so the conversation is not swallowed: a question, a
 * request for advice ("how should I…", "coach me…", "tips"), and the manager
 * ending the intake ("never mind", "no form"). Those go to retrieval exactly
 * as before, and a later intake turn can still pick the form back up — see
 * `continuationFor`.
 */
const ASKS_FOR_ADVICE =
  /^(?:so\s+|and\s+|ok\s+|okay\s+)?(?:what|what's|whats|how|why|when|where|which|who)\b|\b(?:coach\s+(?:me|us)|how\s+(?:do|should|can|could|would)\s+(?:i|we)|what\s+should\s+(?:i|we)|tips?|advice|guidance)\b/i;

const TOPIC_STATEMENT =
  /\b(?:topic|subject|reason|issue|concern|details?|behaviou?r|observed|observation)\s*(?:is|was|are|were|:|-|=)/i;

const CARRIES_ON =
  /\b(?:keep\s+(?:this|it)\s+as|still\s+(?:a\s+)?coaching|same\s+form|this\s+form|continue|go\s+ahead|that'?s\s+(?:it|all|everything|right)|yes|yep|yeah|correct)\b/i;

const ABOUT_THE_EMPLOYEE = /^(?:and\s+|also\s+|then\s+)?(?:she|he|they)(?:['’](?:s|d|ve|re|ll))?\b/i;

function continuesIntake(continued: string, input: ProposalTurn): boolean {
  const question = input.question.trim();
  if (endsIntake(question) || ASKS_FOR_ADVICE.test(question)) return false;
  if (extractEmployeeNames(question).length > 0) return true;
  if (answersEmploymentChange(continued, input)) return true;
  if (isQuestion(question)) return false;
  return (
    describesIncident(question) ||
    extractFormDate(question, input.today ?? businessToday()) !== null ||
    TOPIC_STATEMENT.test(question) ||
    CARRIES_ON.test(question) ||
    ABOUT_THE_EMPLOYEE.test(question)
  );
}

/* ------------------------------------------------------ clarification -- */

/**
 * ============================================================================
 * "COACH AVERY": ADVICE, OR THE FORM? ASKED, NOT GUESSED
 * ============================================================================
 *
 * Production QA, 30 September 2026: "coach Avery Testperson", "I need to
 * coach Avery" and "Avery Testperson needs coaching" all came back as advice
 * ending "ask me to create a coaching form for Avery Testperson" — an exact
 * command the manager was expected to retype. The verb means the conversation
 * as often as the record, so neither is chosen for them: one short question,
 * and two chips that are each an ordinary turn through the ordinary path.
 */
function clarifyFormOrGuidance(input: ProposalTurn, match: TemplateSummary): AskResponse {
  const employee = resolveEmployee(
    managerContext(input.history, { id: input.questionMessageId, content: input.question }),
  );
  const who = employee.kind === "resolved" ? employee.employeeName : null;
  return {
    ...turn(`${FORM_OR_GUIDANCE_QUESTION} ${match.name}${who ? ` for **${who}**` : ""}?`),
    followUpSuggestions: who
      ? [`Start a ${match.name} for ${who}`, `Give me coaching guidance for ${who}`]
      : [`Start a ${match.name}`, "Give me coaching guidance"],
  };
}

/**
 * Whether a turn answers something on the open exit form: a date or how they
 * left (`exit-facts.ts`), or one of HR's Details lines (`exit-details.ts`) —
 * "she texted me", "returned her key", "not eligible for rehire".
 */
function exitAnswers(question: string, today: string): boolean {
  const facts = readExitFacts(question, today);
  return exitFactsSupplied(facts) || exitDetailsSupplied(readExitDetails(question, today, facts));
}

/**
 * The most recent form the MANAGER named, in their own turns.
 *
 * Read through `managerContext` rather than over raw history, so the look-back
 * is the same bounded window the proposal itself reads — and so an assistant
 * turn can never be the thing that names a form.
 */
function namedInManagerTurns(input: ProposalTurn): TemplateIntent {
  const context = managerContext(input.history, {
    id: input.questionMessageId,
    content: input.question,
  });

  for (const message of [...context.messages].reverse()) {
    const intent = detectTemplateIntent(message.content);
    if (intent.kind === "explicit") return intent;
  }

  return { kind: "none" };
}

/**
 * The manager's turns that belong to THIS form: everything after the last turn
 * that asked for a different form or named somebody other than this employee.
 * Earlier turns about the same person stay in ("Jane is a PT TC." then "she's
 * transferring to salon 18"); a demotion for somebody else earlier in the
 * conversation does not.
 */
function turnsAboutThisForm(
  context: ManagerContext,
  templateKey: string,
  employeeName: string | null,
): ManagerContext {
  const same = (name: string) => {
    if (!employeeName) return true;
    const a = name.toLowerCase().split(/\s+/);
    const b = employeeName.toLowerCase().split(/\s+/);
    /*
     * "Beta Test" is Transfer Beta Test: a bare "Transfer Beta Test." reads
     * "Transfer" as the verb, and `resolveEmployee` completes it to the full
     * name. Found in QA: this check did not, so the turn that named her in
     * full was dropped and the draft lost every fact in it.
     */
    const trimmedLead =
      a.length < b.length &&
      b.slice(b.length - a.length).join(" ") === a.join(" ") &&
      b.slice(0, b.length - a.length).every((word) => isFormVocabulary(word));
    return a.join(" ") === b.join(" ") || a[0] === b[0] || trimmedLead;
  };
  let start = 0;
  context.messages.forEach((message, index) => {
    const intent = detectTemplateIntent(message.content);
    const otherForm =
      (intent.kind === "explicit" && intent.templateKey !== templateKey) ||
      intent.kind === "corrective_action";
    const names = extractEmployeeNames(message.content);
    const otherPerson = names.length > 0 && !names.some(same);
    if (otherForm || otherPerson) start = index + 1;
  });
  // The current turn is always the last one, so there is always at least it.
  const messages = context.messages.slice(Math.min(start, context.messages.length - 1));
  return {
    ...context,
    messages,
    ids: messages.map((message) => message.id).filter((id): id is string => Boolean(id)),
    text: messages.map((message) => message.content).join("\n\n"),
  };
}

/**
 * ============================================================================
 * "CURRENT TITLE SD, NEW PAY $12, EFFECTIVE 10/5" ANSWERS THE OPEN FORM
 * ============================================================================
 *
 * The employment change forms ask for their details in one grouped question,
 * and the reply names no employee — it is the details. Read by the employee
 * rule alone it would be a new subject and go to retrieval, dropping the form
 * the manager is halfway through. So for these forms a turn that STATES a
 * detail of the change is an answer too.
 *
 * The same guard as the name rule: a question is never an answer, and a turn
 * the reader finds nothing in is a new subject.
 */
function answersEmploymentChange(templateKey: string, input: ProposalTurn): boolean {
  if (!employmentChangeKind(templateKey)) return false;
  if (isQuestion(input.question)) return false;
  return hasStatedFacts(readEmploymentChange([input.question], input.today ?? businessToday()));
}

const CHANGE_NOUN: Record<EmploymentChangeKind, string> = {
  demotion: "demotion",
  transfer: "transfer",
};

const CHANGE_INTAKE: Record<EmploymentChangeKind, { items: string[]; example: string }> = {
  demotion: {
    items: [
      "The employee's name",
      "Their current title, status (FT/PT) and pay rate",
      "The new title, status and pay rate — and the new location, if it changes",
      "The effective date, and whether it's voluntary or involuntary",
      "A short reason",
    ],
    example:
      "Jane Doe, Salon Director FT at $18/hr → Tanning Consultant PT at $12/hr, effective 10/5, voluntary — she asked to step down.",
  },
  transfer: {
    items: [
      "The employee's name",
      "Their current title, status (FT/PT) and pay rate",
      "The new location — and the new title, status and pay if they change",
      "Whether it's voluntary or involuntary",
      "A short reason",
    ],
    example:
      "Jane Doe is a PT TC at $12/hr, transferring from salon 12 to salon 18, same title and pay, voluntary — she moved closer to home.",
  },
};

function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

/**
 * ============================================================================
 * THE PROSE BESIDE A DEMOTION OR TRANSFER PROPOSAL
 * ============================================================================
 *
 * Three situations, and each gets ONE message:
 *
 *   NOTHING SAID YET — the card was clicked or the form named bare. The
 *   details go in one numbered list with an example, because asking them one
 *   at a time is the questionnaire nobody wants.
 *
 *   NO EMPLOYEE — the one fact that blocks the form. Asked once, naming the
 *   candidates when there were two, and saying what was already understood so
 *   the manager can see nothing is being asked twice.
 *
 *   READY — says back what was read ("FT Salon Director → PT Tanning
 *   Consultant, effective October 5, 2026") and names what is still open in
 *   one sentence. The form is offered anyway: nothing here is blocking, every
 *   open item is a control on the form, and the answers can come in chat too.
 */
function employmentChangeContent(
  kind: EmploymentChangeKind,
  facts: EmploymentChangeFacts,
  proposal: ChatFormProposal,
  context: ManagerContext,
): string {
  const known = describeKnownFacts(facts);

  if ((proposal.employeeName === null && !hasStatedFacts(facts)) || asksToBeGuided(context.text)) {
    const intake = CHANGE_INTAKE[kind];
    return [
      `Let's fill out the **${proposal.templateName}**. Send me what you have in one message and I'll put each detail in the right place:`,
      "",
      ...intake.items.map((item, index) => `${index + 1}. ${item}`),
      "",
      `For example: *${intake.example}*`,
    ].join("\n");
  }

  if (proposal.status === "needs_employee") {
    const employee = resolveEmployee(context);
    const lead = known ? `I have the ${CHANGE_NOUN[kind]} details so far (${known}). ` : "";
    if (employee.kind === "ambiguous") {
      const names = employee.candidates.map((name) => `**${name}**`);
      return `${lead}Which of them is this **${proposal.templateName}** for — ${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}?`;
    }
    return `${lead}Who is this **${proposal.templateName}** for?`;
  }

  const lines = [
    `I have **${possessive(proposal.employeeName ?? "the employee")}** ${CHANGE_NOUN[kind]} started${known ? ` — ${known}` : ""}.`,
  ];

  if (proposal.status === "needs_location") {
    lines.push("", locationQuestion(proposal));
    return lines.join("\n");
  }

  const missing = missingDetails(kind, facts, {
    currentTitleKnown: proposal.employeeRole !== null,
  });
  lines.push(
    "",
    missing.length > 0
      ? `To finish it I still need ${joinList(missing.map((item) => item.phrase))}. Send them here in one message, or fill them in on the form — I won't guess at any of them.`
      : "That covers every detail the form asks for.",
  );

  lines.push("");
  lines.push(
    proposal.supportsInlineDraft
      ? proposal.locationResolution === "not_applicable"
        ? "Your account covers every salon, so the form won't name one unless you did. Create the draft here when you're ready and edit it below — nothing is saved to anyone's file until you do."
        : "Create the draft here when you're ready, and edit it below — nothing is saved to anyone's file until you do."
      : "**Nothing has been created.** This is a proposal, not a form. To file one today, use Create a Form.",
  );
  return lines.join("\n");
}

/* -------------------------------------------------------------- wording -- */

function ambiguousContent(offered: TemplateSummary[]): string {
  if (offered.length === 0) {
    return "I can't tell which form you need, and there are no published forms available to you right now. An administrator publishes them under Form Templates.";
  }
  /*
   * THE FORMS ARE NO LONGER IN THE PROSE.
   *
   * This wrote every permitted template and its description into the message as
   * a bullet list — thirteen of them in a full library, which is a wall of text
   * where a question should be. They travel as `formSelection` now and render as
   * cards, one visible and the rest behind a disclosure.
   *
   * The first sentence is unchanged, and it is the one that matters: the reason
   * Sunny is asking rather than choosing.
   */
  return "Which form do you need?";
}

/**
 * ============================================================================
 * THE CHOICES, FROM THE ONLY LIST THERE IS
 * ============================================================================
 *
 * `offered` has already been through all three filters — published-and-active,
 * this actor's permission for the TEMPLATE'S OWN `required_permission`, and the
 * chooser withholding in `lib/forms/chooser.ts` — so this function narrows
 * nothing further and widens nothing at all. It orders and splits, and the
 * order is the library's `display_order`.
 *
 * WHY THE COACHING FORM IS FIRST. It is the form most conversations end in, and
 * putting it in front of a manager saves the click that nine requests in ten
 * would make. It is FIRST, not CHOSEN: `primary` renders as a card that has to
 * be clicked, and until it is, no template is decided. Where it is not
 * available — a role without `create_coaching_form`, or a deployment that has
 * not published it — the first form this person CAN create leads instead. A
 * form they cannot create is never named, not even collapsed.
 */
function formSelection(offered: TemplateSummary[]): ChatFormSelection | undefined {
  if (offered.length === 0) return undefined;

  const primary =
    offered.find((summary) => summary.key === PRIMARY_TEMPLATE_KEY) ?? offered[0]!;

  return {
    primary: choice(primary),
    additional: offered
      .filter((summary) => summary.key !== primary.key)
      .map(choice),
  };
}

function choice(summary: TemplateSummary): ChatFormChoice {
  return {
    templateKey: summary.key,
    templateName: summary.name,
    description: summary.description,
  };
}

/**
 * The prose beside the proposal card.
 *
 * NO DRAFTED CONTENT, and no invitation to a control that does not exist. It
 * states which form, what is established, what is missing, and that nothing has
 * been created — because at this phase nothing has.
 */
function proposalContent(
  proposal: ChatFormProposal,
  context: ManagerContext,
  match: TemplateSummary,
  today: string,
): string {
  /*
   * ==========================================================================
   * THE RESIGNATION/EXIT FORM — WHAT WAS FILLED, WHAT WAS LEFT, WHAT IS ASKED
   * ==========================================================================
   *
   * The same three openings the other intakes have, read with the exit form's
   * own reader. The facts are the ones the drafting route will derive from the
   * same manager turns, so the list a manager reads here is the list the form
   * comes back with. See `lib/forms/exit-intake.ts`.
   */
  if (isExitForm(match)) {
    const facts = readExitFacts(context.text, today);
    const details = readExitDetails(context.text, today, facts);
    if (proposal.status === "needs_employee") {
      if (
        asksToBeGuided(context.text) ||
        exitNothingSupplied({
          facts,
          details,
          employeeKnown: false,
          jobTitleKnown: proposal.employeeRole !== null,
        })
      ) {
        return exitIntakeRequest(proposal.templateName);
      }
      const employee = resolveEmployee(context);
      return exitEmployeeQuestion(
        proposal.templateName,
        employee.kind === "ambiguous" ? employee.candidates : [],
      );
    }
    const ready = exitReady({ proposal, facts, details });
    return proposal.status === "needs_location"
      ? `${locationQuestion(proposal)}\n\n${ready}`
      : ready;
  }

  /*
   * ==========================================================================
   * WHICH OPENING A MANAGER GETS DEPENDS ON WHETHER THEY HAVE SAID ANYTHING
   * ==========================================================================
   *
   * There are two ways to arrive here and they want opposite answers.
   *
   * THEY DESCRIBED SOMETHING. "Create a corrective action for Sarah. She wore
   * a mini skirt today." has already given who, what and when, and answering
   * that with a numbered list of seven is slower than the paperwork this
   * feature replaced. It also asks for things the FORM collects better than a
   * chat does: the warning level is a pair of tick boxes, the prior action is a
   * field, the job title is not on the document at all. So: draft it, name what
   * is still open, ask for none of it.
   *
   * THEY CLICKED THE CARD. The picker sends `formRequestPhrase(name)` — "Create
   * a Corrective Action Form from this conversation." — and that is a manager
   * who has said nothing at all. Drafting from nothing is not possible and
   * asking one question at a time is the interrogation nobody wants, so this is
   * where the intake belongs: the seven details, in the order the business
   * already asks them, and then the form.
   *
   * `nothingSupplied` IS THE TEST, and it is deliberately about what the
   * MANAGER SAID rather than about what is known: the salon comes from the
   * authenticated account, so counting it would mean the intake never appeared
   * for the people who actually use this product.
   */
  /*
   * ==========================================================================
   * THE EPP INTAKE — THE SAME TWO OPENINGS, FOR A DIFFERENT DOCUMENT
   * ==========================================================================
   *
   * Identical shape to the corrective-action branch below, because the two
   * situations are identical: a manager who has DESCRIBED something wants it
   * drafted, and a manager who has clicked the card has said nothing and needs
   * the questions. What differs is which questions, and that lives in
   * `epp-intake.ts`.
   *
   * WHAT IS NOT ASKED FOR IS THE POINT. The reading runs over the manager's own
   * turns, so "Jessica is an SDIT at Lincoln South, great with clients, late
   * several times this month" arrives having answered five of the eleven — and
   * only the rest are chased.
   */
  if (isPerformancePlan(match)) {
    /*
     * WHICH PLAN'S QUESTIONS, off the key the library already resolved. The
     * TSD Management Performance Plan asks eight and names five metrics; the
     * SDIT plan asks eleven and names three. Neither list is chosen here —
     * this passes the template's own key and `epp-intake.ts` answers.
     */
    const plan = eppIntakePlan(match.key);
    const intake = readEppIntake({
      text: context.text,
      employeeKnown: proposal.employeeName !== null,
      salonSettled:
        proposal.locationResolution === "resolved" ||
        proposal.locationResolution === "not_applicable",
      plan,
    });

    if (intake.nothingSupplied || asksToBeGuided(context.text)) {
      return eppIntakeRequest({
        formName: proposal.templateName,
        /*
         * ONLY WHAT IS STILL OPEN. The salon the account settles, and anything
         * the manager's words already answer, are not asked again.
         */
        items: intake.missing,
        opening: true,
        today: todayInWords(),
        plan,
      });
    }

    if (proposal.status === "needs_employee") {
      return eppEmployeeQuestion(proposal.templateName, context);
    }

    if (proposal.status !== "needs_location") {
      return eppReady(proposal, intake, plan);
    }
  }

  if (isCorrectiveActionForm(match)) {
    const intake = readCorrectiveActionIntake({
      text: context.text,
      employeeKnown: proposal.employeeName !== null,
      salonSettled:
        proposal.locationResolution === "resolved" ||
        proposal.locationResolution === "not_applicable",
      payrollDeduct: proposal.payrollDeduct ?? null,
      asksPayrollDeduct: asksPayrollDeduct(match),
    });

    /*
     * THE SEVEN. A manager who has told us nothing beyond naming the form, and
     * a manager who explicitly asked to be walked through it, get the same
     * opening — there is nothing to draft from in the first case and nothing
     * they want drafted in the second.
     */
    if (intake.nothingSupplied || asksToBeGuided(context.text)) {
      return correctiveActionIntakeRequest({
        formName: proposal.templateName,
        /*
         * ONLY WHAT IS STILL OPEN, in the business's order and wording. The
         * salon is not asked for when the account or a salon the manager named
         * inside their assignment already settles it — see `proposeLocation`.
         */
        items: intake.missing,
        opening: true,
        today: todayInWords(),
      });
    }

    /*
     * THE ONE GENUINELY BLOCKING FACT. Everything else on this form can be
     * left unresolved for the manager to set; the employee cannot, because
     * the wrong name on somebody's file is the failure nothing downstream can
     * undo. `resolveEmployee` is re-read rather than carried on the proposal
     * so the CANDIDATES survive: where the manager named two people, naming
     * them back is one short question, and "tell me their name" to somebody
     * who just gave two names is the assistant not listening.
     */
    if (proposal.status === "needs_employee") {
      return correctiveActionEmployeeQuestion(proposal.templateName, context);
    }

    /*
     * OTHERWISE, DRAFT IT. What is still unknown is NAMED, never asked for:
     * the manager should see that the warning level is theirs to tick without
     * being stopped for it.
     */
    if (proposal.status !== "needs_location") {
      return correctiveActionReady(proposal, intake, asksPayrollDeduct(match));
    }
  }

  /*
   * SHORT AND OPERATIONAL. The card below is the artifact; a long prose preamble
   * above it competes with the thing the manager is meant to read, and the
   * version that wrote out a whole pseudo-form is what this phase removed.
   */
  const lines: string[] = [`Here is what I would put on a **${proposal.templateName}**.`, ""];

  if (proposal.status === "needs_employee") {
    lines.push(openingQuestions(proposal, context));
  } else if (proposal.status === "needs_location") {
    lines.push(locationQuestion(proposal));
  } else {
    lines.push(
      `Everything I need is here, drawn from ${context.messages.length === 1 ? "your message" : "your messages"} above.`,
    );
  }

  /*
   * ==========================================================================
   * THE ESCAPE COPY IS GONE FOR THE PATH THAT NO LONGER NEEDS IT
   * ==========================================================================
   *
   * Phase 2 ended every proposal with "To file a form today, use Create a
   * Form." That was honest then, because nothing in chat could create one.
   *
   * It is the opposite of the requirement now. Marissa's whole ask is that the
   * manager never leaves the conversation: sending them to the standalone
   * builder from the one card that can create the form inline would be the
   * feature arguing against itself.
   *
   * IT STAYS EVERYWHERE ELSE, because everywhere else it is still true. A
   * proposal that is missing the employee, cannot verify a salon, or names a
   * template the inline editor does not support yet has no create action — and
   * a manager who needs that form today still needs somewhere to go.
   */
  if (proposal.status !== "needs_employee") {
    lines.push("");
    if (proposal.supportsInlineDraft) {
      /*
       * ACCURATE ABOUT THE SALON, because for a global actor there is not one and
       * saying "I have the salon" would be a small lie on the one card a manager
       * checks before filing an HR record.
       */
      lines.push(
        proposal.locationResolution === "not_applicable"
          ? "I have the employee. Your account covers every salon, so this form won't name one. Create the draft here when you're ready and edit it below — nothing is saved to anyone's file until you do."
          : "I have the employee and the salon. Create the draft here when you're ready, and edit it below — nothing is saved to anyone's file until you do.",
      );
    } else {
      /*
       * THE SENTENCE THAT SAYS NO HR RECORD EXISTS YET.
       *
       * This branch briefly carried a second copy of the needs_employee
       * question. The effect on a Disciplinary Plan of Action — a template
       * refused inline because it has variants — was that the card said
       * "Everything I need is here", then immediately asked for the five
       * details it had just established, and never once said that nothing had
       * been filed. Both halves were wrong, and the missing half was the one
       * that matters: a manager reading a confident DPOA summary with no
       * disclaimer can reasonably conclude the form now exists on somebody's
       * record. It does not, and this is the only sentence that says so.
       */
      lines.push(
        "**Nothing has been created.** This is a proposal, not a form — I can't create this one in chat yet.",
      );
    }
  }

  return lines.join("\n");
}

/**
 * Today, as a manager reads a date.
 *
 * ONE FORMATTER FOR BOTH INTAKES, because the two numbered lists sit one
 * template apart and a manager who sees them on consecutive turns should not be
 * shown the same day written two ways.
 */
function todayInWords(): string {
  return new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * The one question worth stopping for, and it is one question.
 *
 * NAMES THE CANDIDATES WHERE THERE ARE SOME. A manager who wrote two names has
 * given the assistant everything except which of them; answering "tell me
 * their name" is the assistant not having read the sentence. Where they named
 * nobody, it asks once and says nothing else.
 *
 * There is no employee directory in this product — `resolveEmployee` reads the
 * manager's OWN turns — so "three employees called Sarah" cannot arise here.
 * What can, and does, is two people named in one message.
 */
function correctiveActionEmployeeQuestion(
  templateName: string,
  context: ManagerContext,
): string {
  const employee = resolveEmployee(context);

  if (employee.kind === "ambiguous") {
    const names = employee.candidates.map((name) => `**${name}**`);
    return `Which of them is this **${templateName}** for — ${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}? Tell me and I'll draft it from what you've already described.`;
  }

  return `Who is this **${templateName}** for? Give me their name and I'll draft it from what you've told me — you can set the warning level and anything else on the form itself.`;
}

/**
 * The prose beside a Corrective Action Form that is ready to be created.
 *
 * IT NAMES WHAT IS UNRESOLVED AND ASKS FOR NONE OF IT. That distinction is the
 * whole change: a manager who has not said whether this is verbal or written
 * should see that the tick boxes are theirs, not be stopped and asked. The
 * form has controls for every one of these; the chat does not.
 *
 * The job title is never mentioned, because the document has no field for it.
 */
function correctiveActionReady(
  proposal: ChatFormProposal,
  intake: IntakeReading,
  asksPayroll: boolean,
): string {
  const outstanding = intake.missingRequired
    .filter((item) => item.key === "warning_level" || item.key === "previous_action")
    .map((item) =>
      item.key === "warning_level" ? "the verbal/written warning level" : "any prior corrective action",
    );

  const lines = [
    `I'll draft a **${proposal.templateName}** for **${proposal.employeeName}** from what you've described, and check the applicable company policy before anything policy-related goes on it.`,
  ];

  if (outstanding.length > 0) {
    lines.push(
      "",
      `You'll set ${outstanding.join(" and ")} on the form — I won't guess at ${outstanding.length === 1 ? "it" : "them"}.`,
    );
  }

  /*
   * ==========================================================================
   * "IS PAYROLL DEDUCT APPLICABLE?" IS ASKED, NOT NAMED
   * ==========================================================================
   *
   * Unlike the warning level, this one is put to the manager as a question,
   * because Operations asked for it to be collected with the form's details.
   * It still holds nothing up — the card can be created and the boxes ticked
   * on the form — and it is never answered for them. Once answered it is
   * read back, so a wrong answer is caught here rather than on the PDF.
   */
  // A published version that predates the question has nothing to ask or read back.
  if (asksPayroll && (proposal.payrollDeduct === "yes" || proposal.payrollDeduct === "no")) {
    lines.push(
      "",
      `${PAYROLL_DEDUCT_LABEL} **${proposal.payrollDeduct === "yes" ? "Yes" : "No"}** — tell me if that should change.`,
    );
  } else if (asksPayroll) {
    lines.push(
      "",
      `One more question: **${PAYROLL_DEDUCT_LABEL}** Yes or No? Tell me here, or tick it on the form — I won't answer it for you.`,
    );
  }

  lines.push("");
  lines.push(
    proposal.supportsInlineDraft
      ? proposal.locationResolution === "not_applicable"
        ? "Your account covers every salon, so this form won't name one. Create the draft here when you're ready and edit it below — nothing is saved to anyone's file until you do."
        : "Create the draft here when you're ready, and edit it below — nothing is saved to anyone's file until you do."
      : "**Nothing has been created.** This is a proposal, not a form — I can't create this one in chat yet.",
  );

  return lines.join("\n");
}

/**
 * Who the plan is for — one question, and it names the candidates if there are
 * some. Same rule as the corrective-action question above: a manager who wrote
 * two names has told us everything except which of them.
 */
function eppEmployeeQuestion(templateName: string, context: ManagerContext): string {
  const employee = resolveEmployee(context);

  if (employee.kind === "ambiguous") {
    const names = employee.candidates.map((name) => `**${name}**`);
    return `Which of them is this **${templateName}** for — ${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}? Tell me and I'll draft it from what you've already described.`;
  }

  return `Who is this **${templateName}** for? Give me their name and I'll draft it from what you've told me.`;
}

/**
 * The prose beside a performance plan that is ready to be created.
 *
 * IT NAMES WHAT IS STILL OPEN AND ASKS FOR NONE OF IT — the same rule the
 * corrective-action card follows, and it matters more here. The productivity
 * figures and the seven expectation marks are things a manager may not have to
 * hand, and stopping the EPP for them is exactly the friction this workflow
 * exists to remove: they are controls ON THE FORM, blank until somebody fills
 * them, and the review conversation is when that happens.
 */
function eppReady(
  proposal: ChatFormProposal,
  intake: EppIntakeReading,
  plan: EppIntakePlan,
): string {
  const outstanding = intake.missing
    .filter((item) =>
      ["employee_productivity", "salon_productivity", "expectations_success", "expectations_improvement"].includes(
        item.key,
      ),
    )
    .map((item) =>
      item.key === "employee_productivity"
        ? /*
           * WHOSE NUMBERS. "The employee's" on the SDIT plan and "the
           * manager's" on the TSD one, because the TSD plan's own pages call
           * its subject the manager and a card that called them the employee
           * would be the role drift this work was told to keep out.
           */
          `the ${plan.subject}'s productivity numbers`
        : item.key === "salon_productivity"
          ? "the salon's productivity numbers"
          : "the seven expectation marks",
    );
  const named = [...new Set(outstanding)];

  const lines = [
    `I'll draft a **${proposal.templateName}** for **${proposal.employeeName}** from what you've described, and check the applicable JB & Associates policy before anything policy-related goes on it.`,
  ];

  if (named.length > 0) {
    lines.push(
      "",
      `You'll set ${named.join(" and ")} on the form — I won't guess at ${named.length === 1 ? "it" : "them"}, and they don't hold the plan up.`,
    );
  }

  lines.push("");
  lines.push(
    proposal.supportsInlineDraft
      ? proposal.locationResolution === "not_applicable"
        ? "Your account covers every salon, so this form won't name one. Create the draft here when you're ready and edit it below — nothing is saved to anyone's file until you do."
        : "Create the draft here when you're ready, and edit it below — nothing is saved to anyone's file until you do."
      : "**Nothing has been created.** This is a proposal, not a form — I can't create this one in chat yet.",
  );

  return lines.join("\n");
}

/**
 * The opening ask for the forms without an intake of their own, listing only
 * what is actually missing.
 *
 * The employee is always on it — this is reached only when nobody has been
 * named. The salon is on it only while the manager has a real choice to make;
 * a salon the account settles, or one they cannot file against at all, is not
 * a question they can usefully answer. The date, the account of what happened
 * and the job title drop off as soon as their words supply them.
 */
function openingQuestions(proposal: ChatFormProposal, context: ManagerContext): string {
  /*
   * TWO PEOPLE NAMED IS ONE SHORT QUESTION. Found in production QA:
   * "coaching form for Avery Testperson and Jordan Testperson" got the generic
   * "the employee's full name" list, to a manager who had just given two.
   */
  const employee = resolveEmployee(context);
  if (employee.kind === "ambiguous") {
    const names = employee.candidates.map((name) => `**${name}**`);
    return `Which of them is this **${proposal.templateName}** for — ${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}?`;
  }
  const asks = ["The employee's full name."];
  if (proposal.locationResolution === "needs_selection") {
    asks.push("Which of your salons this is about.");
  }
  if (!proposal.formDate) {
    asks.push(`The date for the form (if you say "today," I'll use ${todayInWords()}).`);
  }
  if (!describesIncident(context.text)) {
    asks.push("A description of the performance concern or observed behavior.");
  }
  if (!proposal.employeeRole) {
    asks.push("The employee's job title (optional but helpful).");
  }

  if (asks.length === 1) return "Who is this form for? Tell me the employee's full name.";
  const numbered = asks.map((ask, index) => `${index + 1}. ${ask}`).join("\n");
  return `To draft a form, I'll need a few details first:\n\n${numbered}\n\nCould you please provide these?`;
}

function locationQuestion(proposal: ChatFormProposal): string {
  if (proposal.locationResolution === "needs_selection" && proposal.namedLocationOutOfScope) {
    /*
     * THEY NAMED A SALON THAT IS NOT THEIRS. Neither it nor their own salon is
     * filled in: one would file outside their assignment, the other would
     * quietly overrule what they said.
     */
    return `**${proposal.namedLocationOutOfScope}** isn't a salon on your assignment, so I can't file a form against it. Which of your salons is this about?`;
  }
  if (proposal.locationResolution === "needs_selection") {
    // Deliberately says nothing about HOW MANY salons the actor covers: this
    // branch is reached both by a manager assigned to several and by a global
    // actor whose salons cannot be enumerated at all.
    return "I won't choose which salon this belongs to. Which salon is this about?";
  }
  return "I can't confirm which salon this would be filed against, so the proposal has none. A form can only name a salon Ask Sunny can verify you're assigned to.";
}
