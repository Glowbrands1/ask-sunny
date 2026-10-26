import { policyHeadingStatedOnlyEnabled } from "@/lib/config/chat-quality-flags";
import {
  STANDARDS_OF_CONDUCT,
  describedAttendanceKeys,
  readCaPolicy,
  statedOffenseKeys,
} from "@/lib/forms/ca-policy";
import { namedPolicies, namesHeading } from "@/lib/forms/named-policy-section";
import { headingKey, sectionHeadingsFor } from "@/lib/forms/official-policy-manual";
import { headingsNamedIn } from "@/lib/forms/policy-change";

/**
 * ============================================================================
 * THE POLICY ON A CARD IS ONE THE MANAGER'S OWN WORDS SUPPORT
 * (POLICY_HEADING_STATED_ONLY_ENABLED)
 * ============================================================================
 *
 * QA, 25-26 Oct 2026 (conv_mvoiqhqf2zhcmij, conv_mvok4e392bdwu5t): "Create a
 * verbal corrective action for <name> for missing the 10-15-26 woven
 * deadline" cited "**Policy:** Attendance, as you said" on some runs and
 * Standards of Conduct p.12 on others, in every casing. The code reads that
 * account as the Standards of Conduct every time (`readCaPolicy`); the
 * Attendance came from the slot model's `policyHeading`, which was accepted
 * whenever it was a real manual heading, saved into the conversation's form
 * state and written back as "Policy reference: Attendance, …", where it read
 * as the manager naming Attendance.
 *
 * A heading the model, the saved state or the incident type offers is kept
 * only when the manager's own turns support it: they name it, name a policy
 * that is it, or describe an account the code's own reading maps to it.
 * Otherwise the slot is left empty and the code's own reading of the account
 * decides on the proposal and the card (for that account, Standards of
 * Conduct p.12), so the same words give the same policy on every run.
 */

/** The headings the manager's own words support, the code's reading first. */
export function managerPolicyHeadings(managerText: string, headings: readonly string[]): string[] {
  const text = managerText ?? "";
  const wanted: string[] = [];
  const add = (heading: string | null | undefined) => {
    if (!heading) return;
    const found = headings.find((item) => headingKey(item) === headingKey(heading));
    if (found && !wanted.some((seen) => headingKey(seen) === headingKey(found))) wanted.push(found);
  };
  const reading = readCaPolicy(text);
  if (reading.stated === "late_opening") add("Late Opening");
  const keys =
    statedOffenseKeys(reading, text) ??
    describedAttendanceKeys(text) ??
    (reading.suggestion === STANDARDS_OF_CONDUCT ? [STANDARDS_OF_CONDUCT] : []);
  for (const heading of sectionHeadingsFor({ offenseKeys: keys, notes: text }).flat()) add(heading);
  for (const heading of headingsNamedIn(text, headings)) add(heading);
  for (const named of namedPolicies(text)) {
    for (const heading of headings) if (namesHeading(named.phrase, heading)) add(heading);
  }
  return wanted;
}

/**
 * The heading to keep: the first offered one the manager's words support;
 * else the model's catch-all Standards of Conduct when the code reads no
 * policy at all; else null. Off, the first offered one, exactly as before.
 */
export function statedPolicyHeading(input: {
  readonly offered: readonly (string | null | undefined)[];
  readonly managerText: string;
  readonly headings: readonly string[];
}): string | null {
  if (!policyHeadingStatedOnlyEnabled()) {
    // Exactly `model ?? saved ?? incident`: only null and undefined are passed over.
    return input.offered.find((heading): heading is string => heading !== null && heading !== undefined) ?? null;
  }
  const supported = managerPolicyHeadings(input.managerText, input.headings);
  for (const heading of input.offered) {
    if (heading && supported.some((seen) => headingKey(seen) === headingKey(heading))) return heading;
  }
  /*
   * The code's own reading is NOT written into the slot: a "Policy reference"
   * line in the form state reads as the manager's words ("…, as you said").
   * The proposal and the card read the account themselves ("this reads as
   * **Standards of Conduct**").
   */
  if (supported.length > 0) return null;
  /*
   * The code reads no policy at all ("she was rude to <name>"): the catch-all
   * Standards of Conduct the model offered may stand, as before. A specific
   * section ("Attendance") still needs the manager's words.
   */
  const catchAll = input.offered.find((heading) => heading && headingKey(heading) === headingKey("Standards of Conduct"));
  return catchAll ?? null;
}
