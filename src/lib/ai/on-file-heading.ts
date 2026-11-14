/*
 * ============================================================================
 * A POLICY NAMED ONLY IN THE APP'S "ON FILE" LISTING IS NOT THE REQUEST'S POLICY (ON_FILE_LINE_NOT_THE_POLICY_ENABLED)
 * ============================================================================
 *
 * Pau's morning scan (Ask Sunny production, 13 Nov 2026, 22:40-22:45Z), via QA: a dress-code chat. Every card listed the
 * employee's forms on file ("On file in Form Monitoring for <B>: Verbal corrective action (Tardiness/Leaving Early —
 * Late Opening) — finalized 10/26/2026; …"). The manager resent "Write me a CA form for <B> having a black crewneck on
 * during her shift, not a zip up jacket on 11/13 and 11/6" word for word, and the card said "Policy: Late Opening — read
 * from this request". The intent reader reads the whole chat, the app's own replies included; with no policy in the
 * manager's words it picked the heading the app's listing named, which was written back onto the turn as "Policy
 * reference: Late Opening …" and read as the request's policy.
 *
 * A heading the reader picks is dropped only when the manager's own messages carry no evidence for it (QA's ruling, 14 Nov
 * 2026): the readers the card uses, run on the manager's words alone (the policy reader, the Late Opening reader, the
 * manual's named and described sections, close spelling), read nothing of it; and an app reply's "On file" listing names it: that listing is history, never this request. The heading the request already had is kept, so a request
 * sent again keeps the policy it had.
 */

import type { ManualChunk } from "@/lib/forms/official-policy-manual";
import { CA_POLICY_LABEL, describesLateOpening, readCaPolicy } from "@/lib/forms/ca-policy";
import { closeHeadingReading, describedManualSection, namedManualSection } from "@/lib/forms/named-policy-section";

type Turn = { readonly role: string; readonly content: string };

const ON_FILE_LINE = /^\**On file in [^\n]*$/gim;

function words(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

/** The heading's words, without a trailing "policy" ("Late Opening Policy" → "late opening"). */
function headingWords(heading: string): string {
  return words(heading).replace(/\s+polic(?:y|ies)$/, "").trim();
}

/** The manager's words read as this heading, by the readers the card uses (QA's ruling, 14 Nov 2026). */
function managerReadsHeading(heading: string, managerText: string, chunks: readonly ManualChunk[]): boolean {
  const named = headingWords(heading);
  // The policy reader: a policy the manager named ("the late opening policy", "attendance").
  const reading = readCaPolicy(managerText);
  if (reading.stated && headingWords(CA_POLICY_LABEL[reading.stated]) === named) return true;
  // The Late Opening reader: a late opening described ("she opened the salon 25 minutes late").
  if (named === "late opening" && describesLateOpening(managerText)) return true;
  if (chunks.length === 0) return false;
  // The manual readers: the section named by its heading, or described by its own words.
  if (namedManualSection({ text: managerText, chunks })?.section.heading === heading) return true;
  if (describedManualSection({ text: managerText, chunks })?.section.heading === heading) return true;
  // Close spelling ("late openng"): a run of the manager's words as long as the heading names it.
  const said = words(managerText).split(" ").filter(Boolean);
  const size = named.split(" ").length;
  for (let at = 0; at + size <= said.length; at += 1) {
    if (closeHeadingReading(said.slice(at, at + size).join(" "), [heading]).confident === heading) return true;
  }
  return false;
}

/** True when `heading` is named in an app "On file" listing and the manager's own words neither name nor describe it. */
export function headingOnlyOnFile(heading: string, question: string, history: readonly Turn[], chunks: readonly ManualChunk[] = []): boolean {
  const named = headingWords(heading);
  if (!named) return false;
  const managerText = [...history.filter((turn) => turn.role === "user").map((turn) => turn.content), question].join("\n");
  const manager = words(managerText);
  if (` ${manager} `.includes(` ${named} `) || managerReadsHeading(heading, managerText, chunks)) return false;
  const listings = history
    .filter((turn) => turn.role === "assistant")
    .flatMap((turn) => turn.content.match(ON_FILE_LINE) ?? []);
  return listings.some((line) => ` ${words(line)} `.includes(` ${named} `));
}
