/**
 * The pure half of a follow-up's owner (`follow-up-owner.ts`; the owner, 27 Nov 2026): no reads, so the calendar, the
 * bells and the pages can all ask it. `followUpOwner` null or absent means the creator owns it, as before.
 */
type OwnerFacts = { readonly createdBy: string; readonly followUpOwner?: string | null };

/** The account that does the follow-up: the named owner, else the creator. */
export function followUpOwnerOf(form: OwnerFacts): string {
  return form.followUpOwner || form.createdBy;
}

/** Whether this account owns the follow-up, by name or as the creator with nobody else named. */
export function ownsFollowUp(subject: string | null | undefined, form: OwnerFacts): boolean {
  return Boolean(subject) && followUpOwnerOf(form) === subject;
}

/** Whether this account is the follow-up's NAMED owner (someone the creator handed it to). */
export function namedFollowUpOwner(subject: string | null | undefined, form: Pick<OwnerFacts, "followUpOwner">): boolean {
  return Boolean(subject) && Boolean(form.followUpOwner) && form.followUpOwner === subject;
}

/** Who gets a follow-up's bells: its owner first, then the creator when someone else owns it. Never twice. */
export function followUpRecipients(form: OwnerFacts): string[] {
  return [...new Set([followUpOwnerOf(form), form.createdBy].filter((id) => id.length > 0))];
}

