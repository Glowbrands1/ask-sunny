import { revisionReplyShowsFieldsEnabled } from "@/lib/config/chat-quality-flags";

/**
 * REVISION_REPLY_SHOWS_FIELDS_ENABLED (QA, the Sunny sanitation report, 10 Nov 2026 18:49Z; default off). After Create,
 * "the 10 minute sanitaion in the morning" got "Updated the **Corrective Action Form** for <name>: Observation of Offense.
 * Everything else on the form is as it was." and no card: the change shows only in the open draft below, which the
 * manager may not be looking at. On: the reply shows each changed text field as it now reads. Off: no lines.
 */
const LONGEST = 600;

export function shownFieldLines(
  keys: readonly string[],
  values: Readonly<Record<string, string | undefined>>,
  labelOf: (key: string) => string,
): string[] {
  if (!revisionReplyShowsFieldsEnabled()) return [];
  const lines = keys.flatMap((key) => {
    const value = (values[key] ?? "").trim();
    const label = labelOf(key).trim();
    if (!value || !label) return [];
    const shown = value.length > LONGEST ? `${value.slice(0, LONGEST).trimEnd()}…` : value;
    return [`**${label}:** ${shown}`];
  });
  return lines.length > 0 ? ["", ...lines] : [];
}

/** The keys this turn wrote and did not clear. */
export function updatedKeysShown(written: readonly string[], cleared: readonly string[]): string[] {
  return written.filter((key) => !cleared.includes(key));
}
