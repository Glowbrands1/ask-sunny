/**
 * The card's line when Create reopened this chat's open draft instead of
 * filing a new one (DRAFT_REUSE_SAME_CHAT_ONLY_ENABLED). The route sends the
 * draft's date as `reusedFrom` only with the flag on, so off, nothing is said.
 */

/** "2026-10-20" as "10/20/2026". Anything else is shown as given. */
function usDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `${match[2]}/${match[3]}/${match[1]}` : iso;
}

export function reusedDraftNotice(formDate: string): string {
  return `Updated your open draft from ${usDate(formDate)}`;
}
