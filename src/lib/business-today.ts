import { formDateBusinessTodayEnabled } from "@/lib/config/chat-quality-flags";

import { businessToday } from "./business-date";

/**
 * FORM_DATE_BUSINESS_TODAY_ENABLED (live bug, QA via Pau's audit, 13 Nov 2026): "today" as a business date — a new
 * form's date, a preview's date, the day Woven's termination and new-hire dates are read against — was the UTC
 * date (`toISOString().slice(0, 10)`), which is already tomorrow from about 6–7 PM Central. 27 of 29 evening forms
 * in 30 days carried the next day's date. With the flag on it is the business date (`business-date.ts`
 * businessToday, in BUSINESS_TIMEZONE), as the chat already uses. Off, the UTC date, exactly as before.
 */
export function recordToday(now: Date = new Date()): string {
  return formDateBusinessTodayEnabled() ? businessToday(now) : now.toISOString().slice(0, 10);
}
