/// <reference types="vite/client" />
import type { ReplayCase } from "./cases";

/*
 * EVERY CASE FILE REGISTERS ITSELF (QA, 3 Nov 2026). The pack used to list
 * each case file here by hand, so every pull request that added a case
 * edited this one list and conflicted with every other such pull request.
 * Now any `<date>-…-cases.ts` file in this folder is read: a new case file is
 * the whole change. Each exported array of cases is taken, files in report
 * order (oct30 before nov2 before nov3), then the file name.
 */
const FILES = import.meta.glob("./*-cases.ts", { eager: true }) as Record<string, Record<string, unknown>>;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "./nov2-person-cases.ts" → 1102 (month × 100 + day); a file without a date sorts last. */
function reportDate(path: string): number {
  const match = /^\.\/([a-z]{3})(\d{1,2})-/.exec(path);
  const month = match ? MONTHS.indexOf(match[1]!) : -1;
  return month < 0 ? 9999 : (month + 1) * 100 + Number(match![2]);
}

function isCase(value: unknown): value is ReplayCase {
  return typeof value === "object" && value !== null && typeof (value as ReplayCase).id === "string" && typeof (value as ReplayCase).run === "function";
}

/** Every case in the pack, in report order. */
export const CASES: readonly ReplayCase[] = Object.keys(FILES)
  .sort((a, b) => reportDate(a) - reportDate(b) || a.localeCompare(b))
  .flatMap((path) =>
    Object.values(FILES[path]!)
      .filter(Array.isArray)
      .flatMap((list) => (list as unknown[]).filter(isCase)),
  );
