import { headingKey } from "./official-policy-manual";

/**
 * Printed pages in the JBA Policy Manual (May 2025).
 *
 * Used when a retrieved chunk does not carry the printed page. Standards of
 * Conduct is printed across 12–14; the citation uses 12, the first of those
 * pages. A chunk that already has the printed page is left alone.
 */
const PAGES: readonly { readonly heading: string; readonly page: number; readonly aliases: readonly string[] }[] = [
  { heading: "Attendance", page: 14, aliases: ["attendance", "tardiness", "tardy"] },
  { heading: "Late Opening", page: 15, aliases: ["late opening", "opened late", "opening late"] },
  { heading: "Dress Code", page: 15, aliases: ["dress code", "dress for success", "out of dress code"] },
  { heading: "Cell Phone/Smart Watch Policy", page: 19, aliases: ["cell phone", "smart watch"] },
  { heading: "Standards of Conduct", page: 12, aliases: ["standards of conduct", "code of conduct"] },
  { heading: "Animals in the Workplace", page: 30, aliases: ["animals in the workplace", "pets in", "puppy"] },
];

export function printedPageForPolicy(heading: string | null | undefined): number | null {
  const raw = heading?.trim() ?? "";
  if (!raw) return null;
  const key = headingKey(raw);
  for (const row of PAGES) {
    if (headingKey(row.heading) === key) return row.page;
    if (row.aliases.some((alias) => raw.toLowerCase().includes(alias))) return row.page;
  }
  return null;
}
