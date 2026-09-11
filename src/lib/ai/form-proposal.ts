import "server-only";

import { randomUUID } from "node:crypto";

import {
  buildProposal,
  extractEmployeeNames,
  managerContext,
  resolveEmployee,
  type ManagerContext,
} from "@/lib/forms/proposal";
import { detectTemplateIntent, type TemplateIntent } from "@/lib/forms/template-intent";
import {
  CORRECTIVE_ACTION_INTAKE,
  asksToBeGuided,
  correctiveActionBasis,
  correctiveActionIntakeRequest,
  readCorrectiveActionIntake,
  type IntakeReading,
} from "@/lib/forms/corrective-action-intake";
import { supportsInlineDraft } from "@/lib/forms/inline-draft";
import { buildFormInventory } from "@/lib/forms/inventory";
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
    return turn(ambiguousContent(available), undefined, formSelection(available));
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
        available.length > 0
          ? `Here is what you can start today:\n\n${bulletList(available.map((summary) => summary.name))}`
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
        available.length > 0
          ? `You can start these:\n\n${bulletList(available.map((summary) => summary.name))}`
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
  });

  return turn(proposalContent(proposal, context, match), proposal);
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

  if (spoken.kind !== "none") return spoken;
  if (!continued) return { kind: "none" };

  // Does this turn read as an answer, or as a new subject?
  if (extractEmployeeNames(input.question).length === 0) return { kind: "none" };

  return { kind: "explicit", templateKey: continued };
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

/* -------------------------------------------------------------- wording -- */

function ambiguousContent(available: TemplateSummary[]): string {
  if (available.length === 0) {
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
 * `available` has already been through both filters — published-and-active, and
 * this actor's permission for the TEMPLATE'S OWN `required_permission` — so
 * this function narrows nothing further and widens nothing at all. It orders
 * and splits, and the order is the library's `display_order`.
 *
 * WHY THE COACHING FORM IS FIRST. It is the form most conversations end in, and
 * putting it in front of a manager saves the click that nine requests in ten
 * would make. It is FIRST, not CHOSEN: `primary` renders as a card that has to
 * be clicked, and until it is, no template is decided. Where it is not
 * available — a role without `create_coaching_form`, or a deployment that has
 * not published it — the first form this person CAN create leads instead. A
 * form they cannot create is never named, not even collapsed.
 */
function formSelection(available: TemplateSummary[]): ChatFormSelection | undefined {
  if (available.length === 0) return undefined;

  const primary =
    available.find((summary) => summary.key === PRIMARY_TEMPLATE_KEY) ?? available[0]!;

  return {
    primary: choice(primary),
    additional: available
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
): string {
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
  if (isCorrectiveActionForm(match)) {
    const intake = readCorrectiveActionIntake({
      text: context.text,
      employeeKnown: proposal.employeeName !== null,
      salonSettled:
        proposal.locationResolution === "resolved" ||
        proposal.locationResolution === "not_applicable",
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
        items: CORRECTIVE_ACTION_INTAKE,
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
      return correctiveActionReady(proposal, intake);
    }
  }

  /*
   * SHORT AND OPERATIONAL. The card below is the artifact; a long prose preamble
   * above it competes with the thing the manager is meant to read, and the
   * version that wrote out a whole pseudo-form is what this phase removed.
   */
  const lines: string[] = [`Here is what I would put on a **${proposal.templateName}**.`, ""];

  if (proposal.status === "needs_employee") {
    const today = todayInWords();
    lines.push(
      `To draft a form, I'll need a few details first:\n\n1. The employee's full name.\n2. The salon location where they work.\n3. The date for the coaching form (if you say "today," I'll use ${today}).\n4. A description of the performance concern or observed behavior that needs coaching.\n5. The employee's job title (optional but helpful).\n\nCould you please provide these?`,
    );
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
        "**Nothing has been created.** This is a proposal, not a form. To file one today, use Create a Form.",
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

  lines.push("");
  lines.push(
    proposal.supportsInlineDraft
      ? proposal.locationResolution === "not_applicable"
        ? "Your account covers every salon, so this form won't name one. Create the draft here when you're ready and edit it below — nothing is saved to anyone's file until you do."
        : "Create the draft here when you're ready, and edit it below — nothing is saved to anyone's file until you do."
      : "**Nothing has been created.** This is a proposal, not a form. To file one today, use Create a Form.",
  );

  return lines.join("\n");
}

function locationQuestion(proposal: ChatFormProposal): string {
  if (proposal.locationResolution === "needs_selection") {
    // Deliberately says nothing about HOW MANY salons the actor covers: this
    // branch is reached both by a manager assigned to several and by a global
    // actor whose salons cannot be enumerated at all.
    return "I won't choose which salon this belongs to. Which salon is this about?";
  }
  return "I can't confirm which salon this would be filed against, so the proposal has none. A form can only name a salon Ask Sunny can verify you're assigned to.";
}
