import { incidentDateOnceEnabled } from "@/lib/config/chat-quality-flags";
import { datesInText } from "@/lib/forms/form-date-answer";

/**
 * ============================================================================
 * THE INCIDENT DATE IS WRITTEN ONCE (INCIDENT_DATE_ONCE_ENABLED)
 * ============================================================================
 *
 * HR, 21 Oct 2026 (replay `nov3-stepb-date-as-given`): "create verbal ca for <A>, she was late to salon 15 minutes on
 * 10-1-26 …" — the form "repeated the date of the offense": the Date field held 10/1/2026 and the Observation said it
 * again ("… on 10-1-26").
 *
 * With the flag on, a narrative field (Observation, Details, Issue, Description) whose only date is the form's own Date
 * loses that date phrase ("on 10-1-26", "10-1-26,"): the Date field says it. A field that names any other date — a
 * pattern of absences, an earlier warning — is left as it is. Pure.
 */

const NARRATIVE_KEY = /observation|details|issue|description|incident|account/i;

export function withIncidentDateOnce(values: Record<string, unknown>, formDate: string | null | undefined, today: string): Record<string, unknown> {
  if (!incidentDateOnceEnabled() || !formDate || !/^\d{4}-\d{2}-\d{2}$/.test(formDate)) return values;
  const out: Record<string, unknown> = { ...values };
  for (const [key, value] of Object.entries(values)) {
    if (typeof value !== "string" || !NARRATIVE_KEY.test(key)) continue;
    const dates = datesInText(value, today);
    if (dates.length === 0 || dates.some((date) => date.iso !== formDate)) continue;
    let text = value;
    for (const date of [...dates].sort((a, b) => b.index - a.index)) {
      const before = text.slice(0, date.index).replace(/(?:,?\s+(?:on|dated)|,)?\s*$/i, "");
      const after = text.slice(date.end).replace(/^\s*,?/, "");
      const joined = `${before}${/^[.!?;:]/.test(after.trim()) || after.trim() === "" ? "" : " "}${after.trimStart()}`;
      text = joined;
    }
    out[key] = text.replace(/\s+([.,;:!?])/g, "$1").replace(/[ \t]{2,}/g, " ").trim();
  }
  return out;
}
