import { describedAttendanceKeys, readCaPolicy } from "./ca-policy";
import {
  findManualSection,
  headingKey,
  manualSectionsFor,
  type ManualChunk,
  type ManualSection,
} from "./official-policy-manual";

/**
 * What a form cites, once Pau's two citation rules are on.
 *
 * Tardiness cites Attendance by name and page, not the ticked
 * "Tardiness/Leaving Early" box. A resolved section is cited with its name
 * and page. A late opening still cites Late Opening. Nothing here invents a
 * page the manual did not print.
 */

const TARDINESS_BOX = /tardiness(?:\s*\/\s*leaving early)?/i;

export function formatPolicyCitation(heading: string, page: number): string {
  const name = /policy/i.test(heading) ? heading.trim() : `${heading.trim()} Policy`;
  return `${name}, JBA Policy Manual p.${page}`;
}

export function citeAttendanceForTardiness(input: {
  readonly enabled: boolean;
  readonly notes: string;
  readonly chunks: readonly ManualChunk[];
  readonly sections: readonly ManualSection[];
}): ManualSection[] {
  if (!input.enabled) return [...input.sections];
  if (readCaPolicy(input.notes).stated === "late_opening") return [...input.sections];
  if (input.sections.some((section) => /late opening/i.test(section.heading))) return [...input.sections];
  const keys = describedAttendanceKeys(input.notes);
  if (!keys?.includes("tardiness")) return [...input.sections];
  const attendance = findManualSection(input.chunks, ["Attendance"]);
  if (!attendance || attendance.page <= 0) return [...input.sections];
  const rest = input.sections.filter(
    (section) => headingKey(section.heading) !== "attendance" && !TARDINESS_BOX.test(section.heading),
  );
  return [attendance, ...rest];
}

export function sectionsWithNameAndPage(input: {
  readonly enabled: boolean;
  readonly notes: string;
  readonly chunks: readonly ManualChunk[];
  readonly offenseKeys: readonly string[];
  readonly jobTitle?: string | null;
}): ManualSection[] {
  if (!input.enabled) return [];
  return manualSectionsFor({
    chunks: input.chunks,
    offenseKeys: input.offenseKeys,
    jobTitle: input.jobTitle,
    notes: input.notes,
  }).filter((section) => section.page > 0 && !TARDINESS_BOX.test(section.heading));
}

/** Drop a bare box label once Attendance is the citation. */
export function withoutTardinessBoxLabel(content: string, citingAttendance: boolean): string {
  if (!citingAttendance) return content;
  return content
    .split("\n")
    .filter((line) => !TARDINESS_BOX.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function policyFieldsWithCitation(input: {
  readonly attendance: boolean;
  readonly pageRequired: boolean;
  readonly values: Record<string, string>;
  readonly sections: readonly ManualSection[];
}): Record<string, string> {
  if (!input.attendance && !input.pageRequired) return input.values;
  const paged = input.sections.filter((section) => section.page > 0);
  if (paged.length === 0) return input.values;
  const line = paged.map((section) => formatPolicyCitation(section.heading, section.page)).join("; ");
  const values = { ...input.values };
  const violated = values.policy_violated ?? "";
  if (input.attendance && TARDINESS_BOX.test(violated) && paged.some((section) => /^attendance$/i.test(section.heading))) {
    values.policy_violated = line;
  }
  if (input.pageRequired) {
    for (const key of ["policy_language", "coaching_details", "follow_up_observation"] as const) {
      if (!Object.prototype.hasOwnProperty.call(values, key)) continue;
      const current = (values[key] ?? "").trim();
      if (/p\.\s*\d+|page\s+\d+/i.test(current) || current.includes(line)) continue;
      values[key] = current ? `${current}\n\n${line}` : line;
    }
  }
  return values;
}
