import { describe, expect, it } from "vitest";

import { countFormsOnFile, type CountedRow } from "./forms-on-file-counts";

/* QA's f081 (20 Nov 2026): 11/19 had 5 of one person's CAs (2 archived) and 1 of a different person's ("<A> Te"). */
const CA = "Corrective Action Form";
const row = (employeeName: string, formDate: string, status: string, archived = false): CountedRow => ({ employeeName, templateName: CA, formDate, status, archivedAt: archived ? `${formDate}T23:00:00Z` : null });

describe("countFormsOnFile", () => {
  it("counts per person, form and date, and never folds a different name into another person", () => {
    const rows = [
      ...Array.from({ length: 3 }, () => row("Avery Avebury", "2026-11-19", "draft")),
      ...Array.from({ length: 2 }, () => row("Avery Avebury", "2026-11-19", "draft", true)),
      row("Avery Av", "2026-11-19", "draft", true),
      row("avery  avebury", "2026-11-18", "finalized"),
    ];
    const counts = countFormsOnFile(rows);
    expect(counts.total).toBe(7);
    expect(counts.by_person.map((person) => [person.employee, person.total])).toEqual([["Avery Av", 1], ["Avery Avebury", 6]]);
    const avery = counts.by_person.find((person) => person.employee === "Avery Avebury")!;
    expect(avery.by_form[0]!.by_date).toEqual([
      { date: "2026-11-18", count: 1, statuses: { finalized: 1 } },
      { date: "2026-11-19", count: 5, statuses: { draft: 3, "draft (archived)": 2 } },
    ]);
  });
  it("adds up: every person's total is the sum of its dates, and the total the sum of the people", () => {
    const rows = [row("A B", "2026-11-01", "draft"), row("A B", "2026-11-01", "draft"), row("C D", "2026-11-02", "finalized")];
    const counts = countFormsOnFile(rows);
    expect(counts.by_person.reduce((sum, person) => sum + person.total, 0)).toBe(counts.total);
    for (const person of counts.by_person) expect(person.by_form.flatMap((form) => form.by_date).reduce((sum, entry) => sum + entry.count, 0)).toBe(person.total);
  });
});
