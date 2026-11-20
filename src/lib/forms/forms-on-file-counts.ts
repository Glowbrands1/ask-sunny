/**
 * ============================================================================
 * FORMS ON FILE ARE COUNTED BY CODE, NEVER BY THE MODEL (QA's f081, 20 Nov 2026; production main 121c67ab)
 * ============================================================================
 *
 * "show me CA and coaching forms for <A> this month" listed "11/19/2026 — draft (6)", folding a different person's form
 * ("<A> Te" is not "<A> Testy") into <A>'s, and its total (19) did not match its own lines (20). "list ca for the month"
 * said "11/18 — <A> (×2)" where there were 3. The model was adding up rows. Here the rows are counted once, by code: per
 * person (the employee name exactly as filed, never merged with a different name), per form, per date, with each status,
 * and a total. The reply copies these numbers.
 */

export interface CountedRow {
  readonly employeeName: string;
  readonly templateName: string;
  readonly formDate: string | null;
  readonly status: string;
  readonly archivedAt?: string | null;
}

export interface DateCount {
  readonly date: string | null;
  readonly count: number;
  /** "draft: 2, finalized: 1"; archived forms (when read at all) are counted under "archived". */
  readonly statuses: Readonly<Record<string, number>>;
}

export interface FormCount {
  readonly form: string;
  readonly total: number;
  readonly by_date: readonly DateCount[];
}

export interface PersonCount {
  readonly employee: string;
  readonly total: number;
  readonly by_form: readonly FormCount[];
}

export interface FormCounts {
  readonly total: number;
  readonly by_person: readonly PersonCount[];
}

/** The employee name as one person: case, spacing and accents set aside, every word kept ("Test Te" ≠ "Test Testy"). */
export function personKeyOf(name: string): string {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function statusOf(row: CountedRow): string {
  return row.archivedAt ? "archived" : row.status;
}

/** Counts per person, per form, per date (oldest first), with statuses and a total. */
export function countFormsOnFile(rows: readonly CountedRow[]): FormCounts {
  const people = new Map<string, { employee: string; forms: Map<string, Map<string, Map<string, number>>> }>();
  for (const row of rows) {
    const key = personKeyOf(row.employeeName);
    const person = people.get(key) ?? { employee: row.employeeName.trim(), forms: new Map() };
    people.set(key, person);
    const dates = person.forms.get(row.templateName) ?? new Map<string, Map<string, number>>();
    person.forms.set(row.templateName, dates);
    const day = row.formDate ?? "";
    const statuses = dates.get(day) ?? new Map<string, number>();
    dates.set(day, statuses);
    const status = statusOf(row);
    statuses.set(status, (statuses.get(status) ?? 0) + 1);
  }
  const sum = (values: Iterable<number>) => [...values].reduce((total, value) => total + value, 0);
  const by_person = [...people.values()]
    .map((person) => {
      const by_form = [...person.forms.entries()]
        .map(([form, dates]) => {
          const by_date = [...dates.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, statuses]) => ({ date: date || null, count: sum(statuses.values()), statuses: Object.fromEntries(statuses) }));
          return { form, total: sum(by_date.map((entry) => entry.count)), by_date };
        })
        .sort((a, b) => a.form.localeCompare(b.form));
      return { employee: person.employee, total: sum(by_form.map((form) => form.total)), by_form };
    })
    .sort((a, b) => a.employee.localeCompare(b.employee));
  return { total: rows.length, by_person };
}
