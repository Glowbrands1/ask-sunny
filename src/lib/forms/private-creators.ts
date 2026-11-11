import { envFlag } from "@/lib/config/chat-quality-flags";
import { ADMIN_CONSOLE_ROLES } from "@/lib/permissions";
import { assistantManagerCreateEnabled, hiddenFromAssistantManager } from "@/lib/permissions/assistant-manager-create";
import type { Role } from "@/types";

/**
 * ============================================================================
 * FORMS SOME ACCOUNTS CREATE ARE PRIVATE TO THEM AND TO ADMIN
 * ============================================================================
 *
 * Requested 26 Oct 2026 (both apps): forms created by a short list of
 * accounts are seen only by the account that created them and by
 * admin/owner/developer. Every other reader (other districts and regions,
 * salon directors, assistants, other salons) does not see them anywhere:
 * lists, counts, follow-ups, chat look-ups, the record itself, its history
 * and its PDF, nor may they write to it by id.
 *
 * The accounts are user ids in PRIVATE_FORM_CREATOR_IDS (comma separated,
 * set per app in Vercel; never in the repository). The rule is on only with
 * PRIVATE_CREATOR_FORMS_ENABLED and a non-empty list; otherwise nothing
 * changes. It only ever hides: it never grants a reader a form their scope
 * does not already reach.
 */

export function privateCreatorFormsEnabled(): boolean {
  return envFlag("PRIVATE_CREATOR_FORMS_ENABLED");
}

function privateCreatorIds(): ReadonlySet<string> {
  return new Set(
    (process.env.PRIVATE_FORM_CREATOR_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

/** On, with at least one account listed; or the Assistant Salon Director's own-forms rule on. */
export function privateCreatorsActive(): boolean {
  return (privateCreatorFormsEnabled() && privateCreatorIds().size > 0) || assistantManagerCreateEnabled();
}

/** Whether this form is private to somebody other than this reader. */
export function hiddenAsPrivate(
  reader: { id: string; role: Role | null },
  instance: { createdBy: string },
  /** AM_PRIOR_WARNINGS_ENABLED: false only for the Corrective Action's count of earlier warnings. */
  options: { assistantOwnFormsRule?: boolean } = {},
): boolean {
  // NEXT_PUBLIC_ASSISTANT_MANAGER_CREATE_ENABLED: an Assistant Salon Director sees only the forms they created.
  if (options.assistantOwnFormsRule !== false && hiddenFromAssistantManager(reader, instance)) return true;
  if (!(privateCreatorFormsEnabled() && privateCreatorIds().size > 0)) return false;
  if (!privateCreatorIds().has(instance.createdBy)) return false;
  if (instance.createdBy === reader.id) return false;
  return !(reader.role !== null && ADMIN_CONSOLE_ROLES.includes(reader.role));
}

/**
 * How many rows a bounded read asks for. Private rows are dropped after the
 * query (the query lives in the protected `instances.ts`), so while the rule
 * is active a read asks for four times its page and the caller trims back to
 * the page, so a page of private rows cannot leave the visible page short.
 * Off, the page itself.
 */
export function privateAwareLimit(limit: number): number {
  return privateCreatorsActive() ? limit * 4 : limit;
}
