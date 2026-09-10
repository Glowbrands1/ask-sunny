import "server-only";

import { DEFAULT_PERMISSION_MATRIX, hasPermission } from "@/lib/permissions";
import type { AccessScope, Permission, Role } from "@/types";

import { FORM_CATEGORIES, formCategoryLabel } from "./catalog";
import { supportsInlineDraft } from "./inline-draft";
import type { TemplateSummary } from "./repository";

/**
 * ============================================================================
 * THE FORMS LIBRARY, AS A FACT THE ASSISTANT IS GIVEN
 * ============================================================================
 *
 * THE PROBLEM THIS EXISTS TO REMOVE. Asked "what forms do we use for corrective
 * action?", Sunny had nothing but retrieved policy text to answer from — the
 * Forms Library was not in the prompt at all. A language model asked to name
 * forms, with no list of forms, names plausible ones. The reference platform did
 * exactly that: it described a "Role-Play Evaluation" and a "Follow-Up Coaching
 * Note/Form" as documents the business had, with a table of their contents, and
 * neither was a template anybody could open.
 *
 * So the answer stops being something the model recalls and becomes something
 * the server hands it: every row of `form_templates`, its published state, and
 * whether THIS person may create it. The model's job shrinks to writing prose
 * around a list it did not choose.
 *
 * ============================================================================
 * THREE KINDS OF THING, AND THE DISTINCTION IS THE PRODUCT
 * ============================================================================
 *
 * A manager asking "what do we use for corrective action?" is asking about
 * three different registers at once, and the reference platform's answer blurred
 * all three into one table of "documents/forms":
 *
 *   THE FORMS LIBRARY      templates in `form_templates`. You open one, fill it,
 *                          it becomes a record in someone's file. This module.
 *
 *   THE KNOWLEDGE BASE     policies, guides, frameworks. You read them. They are
 *                          retrieved and cited by the ordinary grounded path.
 *
 *   WORKFLOW STEPS         Observation, Coaching, Role Play, Follow-Up Coaching,
 *                          EPP, Follow-Up Review, Corrective Action, Leadership
 *                          Review — the
 *                          approved progression. A step is NOT automatically a
 *                          form: Role Play is a rung with no template, and
 *                          Follow-Up Review is a section inside the EPP.
 *
 * Nothing here describes the second or the third. What it does is make the first
 * one exact, so the prompt can state the boundary and mean it.
 *
 * ============================================================================
 * WHAT IS DELIBERATELY NOT IN AN ENTRY
 * ============================================================================
 *
 * No field list, no option labels, no acknowledgement wording. The inventory
 * answers "which forms exist, what are they for, may I open one" — it is not a
 * second description of a form's contents that could drift from the stored
 * version. A manager who wants to see the fields opens the form.
 */

export interface InventoryEntry {
  /** The library key. The same string `POST /api/forms/instances` takes. */
  templateKey: string;
  name: string;
  shortName: string;
  description: string;
  categoryKey: string;
  categoryLabel: string;
  /** Active, with a published current version. Anything else cannot be started. */
  published: boolean;
  /** The template's own permission, as stored on the row. */
  requiredPermission: string;
  /** Whether THIS actor holds that permission. */
  canCreate: boolean;
  /** Whether Sunny can create and edit it inside the conversation. */
  inlineCreation: boolean;
}

export interface FormInventory {
  /** Every template row, in display order, with its flags. */
  entries: InventoryEntry[];
  /** Whether a role was verified at all. `false` collapses `canCreate`. */
  roleKnown: boolean;
}

/** The authenticated caller, as the inventory needs them. */
export interface InventoryActor {
  role: Role | null;
  scope: AccessScope | null;
}

/**
 * Builds the inventory from template summaries the caller already read.
 *
 * TAKES THE SUMMARIES RATHER THAN FETCHING THEM, so one chat turn does one
 * `listTemplateSummaries()` query and both the proposal path and the prompt read
 * the same snapshot. Two reads could disagree mid-publish, and then a card would
 * offer a form the block beside it did not list.
 */
export function buildFormInventory(
  summaries: readonly TemplateSummary[],
  actor: InventoryActor,
): FormInventory {
  const entries = [...summaries]
    .sort((left, right) => left.displayOrder - right.displayOrder)
    .map<InventoryEntry>((summary) => {
      const published = summary.active && summary.currentVersion?.status === "published";
      const variants = summary.currentVersion?.variants ?? [];
      return {
        templateKey: summary.key,
        name: summary.name,
        shortName: summary.shortName,
        description: summary.description,
        categoryKey: summary.category,
        categoryLabel: formCategoryLabel(summary.category),
        published,
        requiredPermission: summary.requiredPermission,
        /*
         * PERMISSION AND PUBLICATION TOGETHER. "Can create" has to mean the
         * thing a manager would take it to mean — that pressing the button
         * works — so an unpublished template is not creatable however
         * privileged the reader is.
         */
        canCreate:
          published &&
          actor.role !== null &&
          hasPermission(
            DEFAULT_PERMISSION_MATRIX,
            actor.role,
            summary.requiredPermission as Permission,
          ),
        inlineCreation: published && supportsInlineDraft(summary.key, variants),
      };
    });

  return { entries, roleKnown: actor.role !== null };
}

/** Published templates this actor may actually start, in display order. */
export function creatable(inventory: FormInventory): InventoryEntry[] {
  return inventory.entries.filter((entry) => entry.canCreate);
}

/** Published templates, whoever is asking. */
export function publishedEntries(inventory: FormInventory): InventoryEntry[] {
  return inventory.entries.filter((entry) => entry.published);
}

/** One entry by key, or null. Never a near match. */
export function entryFor(
  inventory: FormInventory,
  templateKey: string,
): InventoryEntry | null {
  return inventory.entries.find((entry) => entry.templateKey === templateKey) ?? null;
}

/**
 * Published, permitted entries grouped into the categories the Forms screens
 * group by, in the same order and under the same labels.
 *
 * The labels come from `FORM_CATEGORIES` rather than being written again here,
 * so "HR & Performance Forms" is one string: the heading a manager sees on the
 * page and the words Sunny uses for it in a sentence cannot drift apart, which
 * is the whole point of telling somebody where a form is.
 */
export function groupedForActor(
  inventory: FormInventory,
): { key: string; label: string; entries: InventoryEntry[] }[] {
  const mine = creatable(inventory);
  const known = new Set<string>(FORM_CATEGORIES.map((category) => category.key));

  return FORM_CATEGORIES.map((category, index) => ({
    key: category.key as string,
    label: category.label as string,
    entries: mine.filter(
      (entry) =>
        entry.categoryKey === category.key ||
        // A category a newer deployment wrote and this build does not know
        // lands in the last group rather than vanishing from the answer.
        (index === FORM_CATEGORIES.length - 1 && !known.has(entry.categoryKey)),
    ),
  })).filter((category) => category.entries.length > 0);
}

/**
 * ============================================================================
 * WHERE THE FORMS ACTUALLY ARE IN ASK SUNNY
 * ============================================================================
 *
 * Written once, here, because "where is that form?" is a question with a
 * ROLE-DEPENDENT answer and getting it wrong sends a manager to a page they
 * cannot open.
 *
 *   Forms → Create a Form      needs `view_forms_workspace`. Where a form is
 *                              started. The picker groups templates under the
 *                              category headings, so "under HR & Performance
 *                              Forms" is literally what is on screen.
 *
 *   Forms → Form Templates     needs `manage_form_templates`. The template
 *                              library itself — the blank documents and their
 *                              versions. A Salon Director does NOT have this,
 *                              and telling one to go there is the small wrong
 *                              answer that makes the whole reply untrustworthy.
 *
 *   Forms → Form Monitoring    needs `view_form_monitoring`. Forms already
 *                              created, and what is due for follow-up.
 */
export function formsLocationFor(role: Role | null): string {
  if (role === null) {
    return "Forms → Create a Form, grouped under the category headings.";
  }
  const may = (permission: Permission) =>
    hasPermission(DEFAULT_PERMISSION_MATRIX, role, permission);

  const places: string[] = [];
  if (may("view_forms_workspace")) {
    places.push("**Forms → Create a Form**, where the picker groups them under their category headings");
  }
  if (may("manage_form_templates")) {
    places.push("**Forms → Form Templates**, which is the blank templates and their version history");
  }
  if (may("view_form_monitoring")) {
    places.push("**Forms → Form Monitoring**, for forms already created and what is due for follow-up");
  }

  if (places.length === 0) {
    return "Your access level does not include the Forms workspace, so there is nowhere for you to open one — an Owner or Administrator adjusts that.";
  }
  return places.join("; ") + ".";
}
