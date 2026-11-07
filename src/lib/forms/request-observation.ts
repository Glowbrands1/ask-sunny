import { caSalesPolicyEnabled } from "@/lib/config/chat-quality-flags";

import { asksForTheForm, requestIssueClause } from "./draft-never-blank";

/**
 * ============================================================================
 * THE REQUEST IS NOT THE OBSERVATION (CA_SALES_POLICY_ENABLED; QA, live,
 * 4 Nov 2026)
 * ============================================================================
 *
 * "CA for <name> due to under performance in salon metrics" came back with
 * that whole sentence as the draft's Observation of Offense: the drafting
 * model copied the manager's request. With the flag on, an Observation whose
 * first sentence asks for the form (`asksForTheForm`, the reader the draft's
 * never-blank fallback uses) has that sentence replaced by the request's own
 * reason (`requestIssueClause`: "under performance in salon metrics"). With no
 * reason to read, or the flag off, the Observation is left as written.
 */

const LABEL = /^(\s*Observed:\s*\n?)/i;

/** The drafted values with the request sentence in `fieldKey` replaced by its reason, or null when nothing changes. */
export function withoutRequestInObservation(
  values: Readonly<Record<string, string>>,
  fieldKey: string | null | undefined,
  employeeName: string | null,
): Record<string, string> | null {
  if (!caSalesPolicyEnabled() || !fieldKey) return null;
  const value = values[fieldKey];
  if (!value?.trim()) return null;
  const label = LABEL.exec(value)?.[1] ?? "";
  const body = value.slice(label.length);
  const first = /^[^\n]*?(?:[.!?](?=\s|$)|$)/m.exec(body)?.[0] ?? "";
  if (!first.trim() || !asksForTheForm(first)) return null;
  const issue = requestIssueClause(first, employeeName);
  if (!issue) return null;
  const sentence = `${issue.charAt(0).toUpperCase()}${issue.slice(1)}${/[.!?]$/.test(issue) ? "" : "."}`;
  return { ...values, [fieldKey]: `${label}${sentence}${body.slice(first.length)}` };
}
