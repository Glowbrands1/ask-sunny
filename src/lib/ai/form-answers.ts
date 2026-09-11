import "server-only";

import {
  creatable,
  entryFor,
  formsLocationFor,
  groupedForActor,
  publishedEntries,
  type FormInventory,
  type InventoryEntry,
} from "@/lib/forms/inventory";
import type { InventoryQuestion } from "@/lib/forms/inventory-question";
import type { Role } from "@/types";

import type { AskResponse } from "./types";

/**
 * ============================================================================
 * ANSWERS ABOUT THE LIBRARY, WRITTEN BY THE SERVER
 * ============================================================================
 *
 * "Which forms do we have?" is a question about DATA, and the data is two tables
 * away. Handing it to the model with a retrieved policy excerpt is how the
 * reference platform came to describe a Role-Play Evaluation and a Follow-Up
 * Coaching Note as documents the business had — with a table of their contents —
 * when neither was a template anybody could open.
 *
 * So these answers are assembled here from `form_templates`, not generated. The
 * model is not asked to name a form and then checked; it is not asked at all.
 *
 * ============================================================================
 * EVERY NAME IN EVERY SENTENCE BELOW COMES OUT OF THE INVENTORY
 * ============================================================================
 *
 * There is no template name written as a string literal in this file, and that
 * is a rule rather than a coincidence. A prose list is exactly the thing that
 * drifts: it survives a template being renamed, retired, unpublished or added,
 * and goes on describing a library that no longer exists. Where a sentence needs
 * a form's name it looks it up by KEY, and a key that resolves to nothing
 * published produces a sentence saying so.
 */

/* ------------------------------------------------------------- the ladder -- */

/**
 * ============================================================================
 * THE APPROVED CORRECTIVE-ACTION PROGRESSION, AND WHICH RUNGS ARE FORMS
 * ============================================================================
 *
 * Read off §2 of the Performance Management Framework — §2.1 Observation
 * through §2.8 Further Leadership Review — and specifically off each rung's own
 * "Appropriate documentation" list, which is what settles the question the
 * reference platform got wrong: a step in the progression is NOT automatically a
 * form.
 *
 * Three rungs have no template of their own, and each is a different reason:
 *
 *   ROLE PLAY (§2.3) names a "role-play evaluation form" in its documentation
 *   list, and no source document anywhere gives that form's fields — no paper
 *   form, and no output template in §9. Building one would mean inventing every
 *   label and option, so Ask Sunny does not carry it and says so. §2.3 also
 *   lists "Coaching Form notes" and "EPP task completion notes", which is where
 *   role-play is recorded today.
 *
 *   FOLLOW-UP REVIEW (§2.6) is documented by "EPP re-evaluation section" — a
 *   section INSIDE the performance plan, not a document beside it. The DMIT EPP
 *   carries Follow-up, Acknowledgement, Re-evaluation and a second
 *   acknowledgement in one form, which is the same fact in the template.
 *
 *   OBSERVATION (§2.1) and FURTHER LEADERSHIP REVIEW (§2.8) are a manager
 *   noticing something and a manager escalating. Neither is paperwork Ask Sunny
 *   issues; §2.8's documentation list is copies of what already exists.
 *
 * `templateKeys` and `selector` are two ways of naming the same thing. A key is
 * used where one form records a rung; the selector is used for the EPPs, where
 * naming six keys in this file would mean editing it every time the library
 * gains or loses a performance plan. Both resolve through the inventory.
 */
interface LadderRung {
  /** The rung's name, as §2 names it. */
  step: string;
  /** Forms that record it, by library key. */
  templateKeys?: string[];
  /** Or, forms chosen from the library by a property rather than by name. */
  selector?: (entry: InventoryEntry) => boolean;
  /** What records it when no template does. Taken from the rung's own §2 list. */
  documentedBy?: string;
}

const CORRECTIVE_ACTION_LADDER: LadderRung[] = [
  {
    step: "Observation",
    documentedBy: "a manager's own note. Nothing is filed yet.",
  },
  { step: "Coaching", templateKeys: ["coaching"] },
  {
    step: "Role Play",
    documentedBy:
      "the Coaching Form, or EPP task-completion notes. Ask Sunny has no separate role-play template.",
  },
  { step: "Follow-Up Coaching", templateKeys: ["follow-up-coaching"] },
  {
    step: "Employee Performance Plan (EPP)",
    selector: (entry) => entry.requiredPermission === "create_epp",
  },
  {
    step: "Follow-Up Review",
    documentedBy: "the re-evaluation section of the EPP itself, not a separate form.",
  },
  {
    /*
     * THE RUNG THE BUSINESS NOW CALLS CORRECTIVE ACTION. The template key it
     * maps to is still `dpoa`, which is the stored identity of the form and
     * not a name anybody reads — the form's own name is looked up from the
     * library row, so this line never restates it.
     */
    step: "Corrective Action",
    templateKeys: ["dpoa"],
  },
  {
    step: "Further Leadership Review",
    documentedBy:
      "a summary of the history for District or Regional leadership. Not a form Ask Sunny issues.",
  },
];

/** The Policy Review sits beside the ladder rather than on a rung of it. */
const RELATED_TEMPLATE_KEYS = ["policy-review"];

/* -------------------------------------------------------------- rendering -- */

function creationNote(entry: InventoryEntry): string {
  if (!entry.canCreate) return "your role cannot create this one";
  if (entry.inlineCreation) return "Sunny can create this one here in the conversation";
  return "start it in Create a Form — Sunny cannot build this one inside chat yet";
}

/** One form, as a bullet: real name, stored description, honest availability. */
function bullet(entry: InventoryEntry): string {
  return `- **${entry.name}** — ${entry.description} (${creationNote(entry)})`;
}

function bulletList(entries: InventoryEntry[]): string {
  return entries.map(bullet).join("\n");
}

/** Every response from this module is about the library, not from the corpus. */
function turn(content: string): AskResponse {
  return {
    content,
    /*
     * NO CITATIONS AND `not_applicable`. The Forms Library is not the knowledge
     * corpus, so there is no document to cite — and showing "the knowledge base
     * does not cover this" under a correct, complete answer about the library
     * would be the banner contradicting the reply.
     */
    citations: [],
    coverage: "not_applicable",
    recommendedVideoIds: [],
  };
}

/** The sentence that keeps the two registers apart, in one place. */
const REGISTER_NOTE =
  "The **templates** are in Forms. The **guidance** — how to coach, when to escalate, what the progression is — is Knowledge Base material, and I cite it when I answer from it.";

const NOTHING_PUBLISHED =
  "There are no forms published in Ask Sunny that your role can start. An Owner or Administrator publishes templates and sets which roles may use them.";

/* ------------------------------------------------------ inventory answers -- */

/**
 * Answers a question about the library.
 *
 * @param namedTemplateKey The template the sentence named, if it named one, as
 *   read by `detectTemplateIntent`. Used only by the availability branch, and
 *   only after it has been checked against the inventory — a key the reader
 *   suggested is not proof a template answers to it.
 */
export function answerInventoryQuestion(input: {
  question: InventoryQuestion;
  inventory: FormInventory;
  role: Role | null;
  namedTemplateKey: string | null;
}): AskResponse | null {
  const { question, inventory, role, namedTemplateKey } = input;

  if (question.kind === "none") return null;
  if (question.kind === "list") return listAnswer(inventory, role);
  if (question.kind === "location") return locationAnswer(inventory, role);
  return availabilityAnswer(inventory, role, namedTemplateKey);
}

function listAnswer(inventory: FormInventory, role: Role | null): AskResponse {
  const groups = groupedForActor(inventory);
  if (groups.length === 0) return turn(NOTHING_PUBLISHED);

  const sections = groups
    .map((group) => `**${group.label}**\n\n${bulletList(group.entries)}`)
    .join("\n\n");

  return turn(
    [
      "These are the forms published in Ask Sunny that you can use:",
      "",
      sections,
      "",
      `You will find them in ${formsLocationFor(role)}`,
      "",
      REGISTER_NOTE,
    ].join("\n"),
  );
}

function locationAnswer(inventory: FormInventory, role: Role | null): AskResponse {
  const groups = groupedForActor(inventory);
  const where = `The templates are in ${formsLocationFor(role)}`;

  if (groups.length === 0) return turn([where, "", NOTHING_PUBLISHED].join("\n"));

  return turn(
    [
      where,
      "",
      `They are grouped as ${groups.map((group) => `**${group.label}**`).join(" and ")}.`,
      "",
      REGISTER_NOTE,
    ].join("\n"),
  );
}

function availabilityAnswer(
  inventory: FormInventory,
  role: Role | null,
  namedTemplateKey: string | null,
): AskResponse {
  const entry = namedTemplateKey ? entryFor(inventory, namedTemplateKey) : null;

  /*
   * NAMED SOMETHING THE LIBRARY DOES NOT PUBLISH.
   *
   * The whole point of the branch. "Do we have a role-play evaluation?" reads as
   * a template nobody can name, so the answer is no — followed by what there
   * actually is, because a bare no is not useful and a substituted form is worse
   * than either.
   */
  if (!entry || !entry.published) {
    const mine = creatable(inventory);
    return turn(
      [
        "Not as a form in Ask Sunny — there is no published template for that, and I won't stand in for it with a different one.",
        "",
        mine.length > 0
          ? `Here is the whole list of what you can start:\n\n${bulletList(mine)}`
          : NOTHING_PUBLISHED,
        "",
        REGISTER_NOTE,
      ].join("\n"),
    );
  }

  if (!entry.canCreate) {
    return turn(
      [
        `Yes — **${entry.name}** is published, but your role cannot create it.`,
        "",
        `${entry.description}`,
        "",
        "Ask your district manager which forms your role should cover.",
      ].join("\n"),
    );
  }

  return turn(
    [
      `Yes. **${entry.name}** — ${entry.description}`,
      "",
      entry.inlineCreation
        ? "I can create it here in the conversation. Tell me who it is for and what happened."
        : "You start it in Create a Form — I cannot build this one inside chat yet.",
      "",
      `It sits under **${entry.categoryLabel}** in ${formsLocationFor(role)}`,
    ].join("\n"),
  );
}

/* ------------------------------------------------ register clarification -- */

/**
 * ============================================================================
 * ONE QUESTION, WHERE THE ANTECEDENT NAMED BOTH REGISTERS
 * ============================================================================
 *
 * `resolveRegisterAnchor` reports `ambiguous` when the nearest turn named a
 * template AND a knowledge document and neither dominated. "I need to find
 * those documents" then has two equally good readings, and the two answers are
 * different pages of the product.
 *
 * SO IT ASKS, ONCE, AND SHORT. The alternative is a coin toss dressed as an
 * answer: half the time a manager looking for the escalation framework is
 * handed a menu of blank paperwork, and there is nothing in the reply to tell
 * them that is what happened.
 *
 * The question names what it saw, so the manager can correct the reading rather
 * than only choose from it.
 */
export function answerRegisterClarification(input: {
  named: readonly string[];
  role: Role | null;
}): AskResponse {
  const seen = input.named.filter((name) => name.trim() !== "").slice(0, 4);
  const context =
    seen.length > 0
      ? ` We were just talking about ${seen.map((name) => `**${name}**`).join(", ")}, which spans both.`
      : "";

  return turn(
    [
      `Which do you mean - the **forms**, or the **guidance**?${context}`,
      "",
      `- The **templates** you fill in and file are in ${formsLocationFor(input.role)}`,
      "- The **guidance** that explains the process is Knowledge Base material, and I quote it with its source when I answer from it.",
      "",
      "Say which one and I will take you straight to it.",
    ].join("\n"),
  );
}

/* ----------------------------------------------- corrective action answer -- */

/**
 * The reply to "I need to do a corrective action for Sarah".
 *
 * WHEN THIS IS REACHED, AND WHEN IT IS NOT. Since the rename, a manager asking
 * to create a corrective action is asking for the Corrective Action Form and
 * gets its intake — `form-proposal.ts` routes there. This answer is what is
 * left, and it is two situations rather than one:
 *
 *   THE BASIS IS A METRIC ALONE. "Their Club Close is low, create a corrective
 *   action." §7 of the framework puts underperformance on the ladder at
 *   coaching, so the honest answer is the progression and where this sits on
 *   it — not a formal warning issued off a scorecard.
 *
 *   THE FORM IS NOT AVAILABLE to this role or this deployment. Then the ladder
 *   and the forms that DO exist is the most useful thing there is to say.
 *
 * Nothing is created and nothing is proposed in either. Once the manager says
 * which document they want, the ordinary explicit path takes over and
 * re-derives every fact from their turns.
 */
export function answerCorrectiveAction(input: {
  inventory: FormInventory;
  role: Role | null;
  /**
   * Whether the Performance Management Framework resolved healthy for this
   * turn. The ladder below is a MAP from the framework's rungs to template
   * keys, and a map is only as authoritative as the thing it maps.
   */
  progressionAvailable: boolean;
  /**
   * Whether the manager's stated grounds were a metric and nothing else.
   *
   * It changes the OPENING SENTENCE and nothing else, because it is a different
   * reason for the same answer. A manager who asked for a document and got the
   * ladder is owed the reason: not "I can't tell which form you mean" — they
   * were perfectly clear — but that a number on its own is not what the
   * approved progression escalates on.
   */
  metricOnly?: boolean;
}): AskResponse {
  const { inventory, role, progressionAvailable } = input;
  const metricOnly = input.metricOnly ?? false;

  /*
   * The opening line, which is the only part these two situations disagree
   * about. Everything below — the ladder, the library, where to find it — is
   * the same answer to both.
   */
  const opening = metricOnly
    ? "A low number on its own isn't what our progression escalates on, so I won't open formal corrective action off a metric. Underperformance enters the ladder at coaching, and it reaches formal accountability through what happens after that."
    : "\"Corrective action\" covers the whole progression rather than one document, so I won't pick a form for you — the wrong one in someone's file is harder to undo than asking.";
  const published = publishedEntries(inventory);
  const mine = creatable(inventory);

  if (mine.length === 0) return turn(NOTHING_PUBLISHED);

  /*
   * ==========================================================================
   * THE FORMS ARE OURS TO STATE. THE ORDER IS THE FRAMEWORK'S.
   * ==========================================================================
   *
   * Three different kinds of fact reach a manager through this one answer, and
   * they have three different authorities:
   *
   *   WHICH FORMS EXIST is `form_templates`, read for this user. Deterministic,
   *   current, and ours to assert.
   *
   *   WHAT THE PROGRESSION IS, and what order its rungs come in, is the
   *   Performance Management Framework. `CORRECTIVE_ACTION_LADDER` is a map
   *   onto it, written from §2 and checked against §2 — but a map in a source
   *   file is a COPY, and a copy cannot know that §2 was re-issued last week.
   *
   *   WHAT A POLICY SAYS is retrieval, and is not asserted here at all.
   *
   * SO WHEN THE FRAMEWORK IS UNAVAILABLE, the ladder is not shown. Not shown
   * with a caveat, not shown unnumbered — not shown. "The approved sequence" is
   * a claim about a document nobody could read on this turn, and the forms
   * list answers the manager's actual question ("which one do I need?") without
   * it.
   *
   * The alternative was a hedge — the same eight rungs under "this may be out
   * of date" — and a manager reads that as the sequence anyway. A copy
   * presented as a copy is still the thing being trusted.
   */

  const rungs = CORRECTIVE_ACTION_LADDER.map((rung) => {
    const forms = rung.selector
      ? published.filter(rung.selector)
      : (rung.templateKeys ?? [])
          .map((key) => entryFor(inventory, key))
          .filter((entry): entry is InventoryEntry => Boolean(entry) && entry!.published);

    if (forms.length === 0) {
      /*
       * A rung with no template. Either it never had one — Observation, Role
       * Play, Follow-Up Review, Leadership Review — or the template that records
       * it is not published in this deployment. Both are said plainly; neither
       * borrows another form's name.
       */
      return `${rung.step} — ${rung.documentedBy ?? "no template for this step is published in Ask Sunny."}`;
    }
    return `${rung.step} — ${forms.map((entry) => `**${entry.name}**`).join(", ")}`;
  })
    .map((line, index) => `${index + 1}. ${line}`)
    .join("\n");

  const related = RELATED_TEMPLATE_KEYS.map((key) => entryFor(inventory, key)).filter(
    (entry): entry is InventoryEntry => Boolean(entry) && entry!.published,
  );

  if (!progressionAvailable) {
    return turn(
      [
        opening,
        "",
        "I can't set out the approved progression right now: the Performance Management Framework isn't available to me on this turn, and I won't recite a sequence from memory when the document that defines it is the thing that settles it. Check the Knowledge Base for the framework itself.",
        "",
        `What I can tell you is which forms exist, which is read from the library. These are the ones you can start:\n\n${bulletList(mine)}`,
        "",
        `You will find them in ${formsLocationFor(role)}`,
      ].join("\n"),
    );
  }

  return turn(
    [
      opening,
      "",
      "The approved sequence, and what records each step:",
      "",
      rungs,
      related.length > 0
        ? `\nAlso available, when the issue is a policy someone misunderstood or breached: ${related
            .map((entry) => `**${entry.name}**`)
            .join(", ")}.`
        : "",
      "",
      `Which one do you need? These are the ones you can start:\n\n${bulletList(mine)}`,
      "",
      /*
       * WHERE, as well as WHICH. A manager who has just been asked to choose a
       * document is about to go looking for it, and the answer is
       * role-dependent — a Salon Director cannot open Form Templates.
       */
      `You will find them in ${formsLocationFor(role)}`,
      "",
      "The progression itself is Knowledge Base guidance — ask me about it and I will answer from the documents and cite them.",
    ]
      .filter((line) => line !== "")
      .join("\n"),
  );
}

/* --------------------------------------------------------- prompt context -- */

/**
 * ============================================================================
 * THE FORMS LIBRARY, AS A BLOCK IN THE PROMPT
 * ============================================================================
 *
 * For every turn this module did NOT answer. A manager whose question wanders
 * into forms mid-conversation — "where is this information stored", "is this
 * under operations" — reaches the grounded path, and a model asked about forms
 * with no list of forms invents them. This is the list, so the prompt's rule
 * against naming a form that is not in it has something to point at.
 *
 * SENT ON EVERY TURN rather than only on turns that look form-shaped. It is a
 * dozen short lines, and the alternative is a keyword gate deciding when Sunny
 * is allowed to be accurate about the library.
 *
 * PUBLISHED ROWS ONLY. An unpublished template is not a form anybody can be
 * told about, and listing it would produce the exact claim this removes: that a
 * document exists when it cannot be opened.
 */
export function buildFormInventoryBlock(inventory: FormInventory): string {
  const published = publishedEntries(inventory);

  if (published.length === 0) {
    return "FORMS LIBRARY\n\nNo forms are published in this deployment. There are no form templates to name.";
  }

  const rows = published
    .map((entry) => {
      const availability = !entry.canCreate
        ? "this user's role may NOT create it"
        : entry.inlineCreation
          ? "this user may create it, and it can be created inside the conversation"
          : "this user may create it, but only in Create a Form — NOT inside the conversation";
      return `- ${entry.name} (short name: ${entry.shortName}; category: ${entry.categoryLabel}; ${availability})\n  ${entry.description}`;
    })
    .join("\n");

  return `FORMS LIBRARY

This is the COMPLETE list of form templates published in Ask Sunny. It is read from the database for this user, and it is the only list of forms that exists.

${rows}`;
}
