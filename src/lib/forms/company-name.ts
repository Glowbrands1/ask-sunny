import { ACTIVE_BRAND } from "@/lib/brand";

/**
 * THE COMPANY'S OWN NAME IS NEVER A PERSON (QA, 7 Nov 2026; used under FORM_NAME_FROM_ROSTER_ENABLED)
 *
 * The brand config's (`lib/brand` ACTIVE_BRAND) brand and operator names, and their initials — a word written in
 * capitals counts whole ("JB & Associates" reads "JBA"), any other word by its first letter — are this company, never
 * an employee. No name is written here; every one is read from the brand config.
 */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((word) => /^\p{L}/u.test(word))
    .map((word) => (word.length > 1 && word === word.toUpperCase() ? word : word[0]!))
    .join("")
    .toUpperCase();
}

const normal = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

const COMPANY_NAMES: ReadonlySet<string> = new Set(
  [ACTIVE_BRAND.brandName, ACTIVE_BRAND.operatorName]
    .flatMap((name) => [name, initials(name)])
    .filter((name) => name.replace(/[^\p{L}]/gu, "").length >= 2)
    .map(normal),
);

/** The words are this company's own name or its initials, in any case. */
export function namesThisCompany(text: string): boolean {
  return COMPANY_NAMES.has(normal(text));
}
