/**
 * The sections of the JBA Policy Manual that a Corrective Action Form is most
 * often written against, and the neighbouring sections a policy lookup must
 * NOT land on (Texting as General Work communications, Social Media Policy,
 * Using Social Media at Work, Seminar/Webinar Attendance, Payroll Deductions,
 * Disciplinary Action …).
 *
 * SYNTHETIC WORDING, the manual's LAYOUT (security cleanup, 22 Oct 2026, as in
 * `src/lib/ai/__fixtures__/jba-policy-manual.ts`): chunk index, locator, PDF
 * sheet, section, printed page and printed headings are the manual's; every
 * line of text is invented. Where the readers key on a short phrase — meetings
 * counted as scheduled shifts, "failing to follow the policies and
 * procedures", insubordination, register / bank shortages, a dollar amount —
 * one invented sentence carries that phrase, so the same behaviour is
 * exercised. Production quotes the manual from the knowledge base, never this
 * file.
 */

type Row = {
  i: number;
  l: string;
  p: number;
  s: string | null;
  printedPage: number | null;
  sections: { heading: string; page: number }[];
  c: string;
};

const ROWS: Row[] = [
  {
    i: 30,
    l: "Page 11 — Drug, Alcohol and Smoking Policy",
    p: 12,
    s: "Drug, Alcohol and Smoking Policy",
    printedPage: 11,
    sections: [{ page: 11, heading: "Drug, Alcohol and Smoking Policy" }],
    c: "Drug, Alcohol and Smoking Policy\nSynthetic policy wording, line 1.\nSynthetic policy wording, line 2.\nSynthetic policy wording, line 3.\nSynthetic policy wording, line 4.\nSynthetic policy wording, line 5.\nSynthetic policy wording, line 6.\nSynthetic policy wording, line 7.\nSynthetic policy wording, line 8.\nSynthetic policy wording, line 9.\nSynthetic policy wording, line 10.\nSynthetic policy wording, line 11.\nSynthetic policy wording, line 12.\nSynthetic policy wording, line 13.\nSynthetic policy wording, line 14.\nSynthetic policy wording, line 15.",
  },
  {
    i: 33,
    l: "Page 12 — Prescribed Medications",
    p: 13,
    s: "Prescribed Medications",
    printedPage: 12,
    sections: [{ page: 12, heading: "Smoking/Vaping" }],
    c: "Synthetic policy wording, line 1.\nSynthetic policy wording, line 2.\nSynthetic policy wording, line 3.",
  },
  {
    i: 34,
    l: "Page 12 — Prescribed Medications",
    p: 13,
    s: "Prescribed Medications",
    printedPage: 12,
    sections: [{ page: 12, heading: "Smoking/Vaping" }],
    c: "Smoking/Vaping\nSynthetic policy wording, line 1.\nSynthetic policy wording, line 2.\nSynthetic policy wording, line 3.\nSynthetic policy wording, line 4.\nSynthetic policy wording, line 5.\nSynthetic policy wording, line 6.\nSynthetic policy wording, line 7.\nSynthetic policy wording, line 8.\nSynthetic policy wording, line 9.\nSynthetic policy wording, line 10.\nSynthetic policy wording, line 11.\nSynthetic policy wording, line 12.\nSynthetic policy wording, line 13.\nSynthetic policy wording, line 14.\nSynthetic policy wording, line 15.",
  },
  {
    i: 36,
    l: "Page 12 — Standards of Conduct",
    p: 13,
    s: "Standards of Conduct",
    printedPage: 12,
    sections: [{ page: 12, heading: "Standards of Conduct" }],
    c: "Standards of Conduct\nSynthetic policy wording, line 1.\nSynthetic policy wording, line 2.\nSynthetic policy wording, line 3.\nSynthetic policy wording, line 4.\nSynthetic policy wording, line 5.\nSynthetic policy wording, line 6.\nSynthetic policy wording, line 7.\nSynthetic: failing to follow the policies and procedures of The Company.",
  },
  {
    i: 37,
    l: "Page 13 — Standards of Conduct",
    p: 14,
    s: "Standards of Conduct",
    printedPage: 13,
    sections: [],
    c: "Synthetic policy wording, line 1.\nSynthetic policy wording, line 2.\nSynthetic policy wording, line 3.\nSynthetic policy wording, line 4.\nSynthetic policy wording, line 5.\nSynthetic policy wording, line 6.\nSynthetic policy wording, line 7.\nSynthetic policy wording, line 8.\nSynthetic policy wording, line 9.\nSynthetic policy wording, line 10.\nSynthetic policy wording, line 11.\nSynthetic policy wording, line 12.\nSynthetic policy wording, line 13.\nSynthetic policy wording, line 14.\nSynthetic policy wording, line 15.\nSynthetic policy wording, line 16.\nSynthetic policy wording, line 17.\nSynthetic policy wording, line 18.\nSynthetic policy wording, line 19.\nSynthetic: insubordination.\nSynthetic: refusal to follow the directions of a supervisor.\nSynthetic: Register / Bank shortages.",
  },
  {
    i: 38,
    l: "Page 13 — Standards of Conduct",
    p: 14,
    s: "Standards of Conduct",
    printedPage: 13,
    sections: [],
    c: "Synthetic policy wording, line 1.\nSynthetic policy wording, line 2.\nSynthetic policy wording, line 3.\nSynthetic policy wording, line 4.\nSynthetic policy wording, line 5.\nSynthetic policy wording, line 6.\nSynthetic policy wording, line 7.\nSynthetic policy wording, line 8.\nSynthetic policy wording, line 9.\nSynthetic policy wording, line 10.\nSynthetic policy wording, line 11.\nSynthetic policy wording, line 12.\nSynthetic policy wording, line 13.\nSynthetic policy wording, line 14.\nSynthetic policy wording, line 15.\nSynthetic policy wording, line 16.\nSynthetic policy wording, line 17.\nSynthetic policy wording, line 18.\nSynthetic policy wording, line 19.\nSynthetic policy wording, line 20.\nSynthetic policy wording, line 21.\nSynthetic policy wording, line 22.\nSynthetic policy wording, line 23.\nSynthetic policy wording, line 24.\nSynthetic policy wording, line 25.\nSynthetic: insubordination.\nSynthetic: refusal to follow the directions of a supervisor.",
  },
  {
    i: 39,
    l: "Page 14 — Standards of Conduct",
    p: 15,
    s: "Standards of Conduct",
    printedPage: 14,
    sections: [],
    c: "Synthetic policy wording, line 1.\nSynthetic policy wording, line 2.\nSynthetic policy wording, line 3.\nSynthetic policy wording, line 4.\nSynthetic policy wording, line 5.\nSynthetic policy wording, line 6.\nSynthetic policy wording, line 7.",
  },
  {
    i: 40,
    l: "Page 14 — Disciplinary Action",
    p: 15,
    s: "Disciplinary Action",
    printedPage: 14,
    sections: [{ page: 14, heading: "Disciplinary Action" }],
    c: "Disciplinary Action\nSynthetic policy wording, line 1.\nSynthetic policy wording, line 2.\nSynthetic policy wording, line 3.\nSynthetic policy wording, line 4.\nSynthetic policy wording, line 5.\nSynthetic policy wording, line 6.\nSynthetic policy wording, line 7.\nSynthetic policy wording, line 8.\nSynthetic policy wording, line 9.\nSynthetic policy wording, line 10.\nSynthetic policy wording, line 11.\nSynthetic policy wording, line 12.\nSynthetic policy wording, line 13.\nSynthetic policy wording, line 14.",
  },
  {
    i: 41,
    l: "Page 14 — Attendance",
    p: 15,
    s: "Attendance",
    printedPage: 14,
    sections: [{ page: 14, heading: "Attendance" }],
    c: "Attendance\nSynthetic policy wording, line 1.\nSynthetic policy wording, line 2.\nSynthetic policy wording, line 3.\nSynthetic policy wording, line 4.\nSynthetic policy wording, line 5.\nSynthetic policy wording, line 6.\nSynthetic policy wording, line 7.\nSynthetic policy wording, line 8.\nSynthetic policy wording, line 9.\nSynthetic policy wording, line 10.\nSynthetic policy wording, line 11.\nSynthetic policy wording, line 12.\nSynthetic policy wording, line 13.\nSynthetic policy wording, line 14.\nSynthetic policy wording, line 15.\nSynthetic policy wording, line 16.\nSynthetic policy wording, line 17.\nSynthetic: required meetings are considered scheduled shifts.",
  },
  {
    i: 42,
    l: "Page 15 — Late Opening",
    p: 16,
    s: "Late Opening",
    printedPage: 15,
    sections: [{ page: 15, heading: "Late Opening" }],
    c: "Late Opening\nSynthetic policy wording, line 1.\nSynthetic policy wording, line 2.\nSynthetic policy wording, line 3.\nSynthetic policy wording, line 4.\nSynthetic policy wording, line 5.\nSynthetic policy wording, line 6.\nSynthetic policy wording, line 7.\nSynthetic: a $25.00 payroll deduction applies.",
  },
  {
    i: 43,
    l: "Page 15 — Texting as General Work communications",
    p: 16,
    s: "Texting as General Work communications",
    printedPage: 15,
    sections: [{ page: 15, heading: "Texting as General Work communications" }],
    c: "Texting as General Work communications\nSynthetic policy wording, line 1.\nSynthetic policy wording, line 2.\nSynthetic policy wording, line 3.\nSynthetic policy wording, line 4.\nSynthetic policy wording, line 5.\nSynthetic policy wording, line 6.",
  },
  {
    i: 61,
    l: "Page 19 — Cell Phone/Smart Watch Policy",
    p: 20,
    s: "Cell Phone/Smart Watch Policy",
    printedPage: 19,
    sections: [{ page: 19, heading: "Cell Phone/Smart Watch Policy" }],
    c: "Cell Phone/Smart Watch Policy\nSynthetic policy wording, line 1.\nSynthetic policy wording, line 2.\nSynthetic policy wording, line 3.\nSynthetic policy wording, line 4.\nSynthetic policy wording, line 5.\nSynthetic policy wording, line 6.\nSynthetic policy wording, line 7.\nSynthetic policy wording, line 8.\nSynthetic policy wording, line 9.",
  },
  {
    i: 73,
    l: "Page 22 — Talking to the Media/Press",
    p: 23,
    s: "Talking to the Media/Press",
    printedPage: 22,
    sections: [
      { page: 22, heading: "Talking to the Media/Press" },
      { page: 22, heading: "Social Media Policy" },
    ],
    c: "Synthetic policy wording, line 1.\nSynthetic policy wording, line 2.\nSynthetic policy wording, line 3.\nSynthetic policy wording, line 4.\nSynthetic policy wording, line 5.\nSocial Media Policy\nSynthetic policy wording, line 6.\nSynthetic policy wording, line 7.\nSynthetic policy wording, line 8.\nSynthetic policy wording, line 9.\nSynthetic policy wording, line 10.\nSynthetic policy wording, line 11.\nSynthetic policy wording, line 12.",
  },
  {
    i: 76,
    l: "Page 23 — Using Social Media at Work",
    p: 24,
    s: "Using Social Media at Work",
    printedPage: 23,
    sections: [
      { page: 23, heading: "Using Social Media at Work" },
      { page: 23, heading: "Retaliation is Prohibited" },
    ],
    c: "Synthetic policy wording, line 1.\nSynthetic policy wording, line 2.\nSynthetic policy wording, line 3.\nSynthetic policy wording, line 4.\nSynthetic policy wording, line 5.\nSynthetic policy wording, line 6.\nRetaliation is Prohibited\nSynthetic policy wording, line 7.\nSynthetic policy wording, line 8.\nSynthetic policy wording, line 9.\nSynthetic policy wording, line 10.\nSynthetic policy wording, line 11.",
  },
  {
    i: 96,
    l: "Page 29 — Visitors in the Workplace",
    p: 30,
    s: "Visitors in the Workplace",
    printedPage: 29,
    sections: [{ page: 29, heading: "Visitors in the Workplace" }],
    c: "Visitors in the Workplace\nSynthetic policy wording, line 1.\nSynthetic policy wording, line 2.\nSynthetic policy wording, line 3.\nSynthetic policy wording, line 4.\nSynthetic policy wording, line 5.\nSynthetic policy wording, line 6.\nSynthetic policy wording, line 7.\nSynthetic policy wording, line 8.\nSynthetic policy wording, line 9.\nSynthetic policy wording, line 10.\nSynthetic policy wording, line 11.\nSynthetic policy wording, line 12.\nSynthetic policy wording, line 13.\nSynthetic policy wording, line 14.\nSynthetic policy wording, line 15.\nSynthetic policy wording, line 16.",
  },
  {
    i: 100,
    l: "Page 30 — Handling Theft",
    p: 31,
    s: "Handling Theft",
    printedPage: 30,
    sections: [{ page: 30, heading: "Handling Theft" }],
    c: "Handling Theft\nSynthetic policy wording, line 1.\nSynthetic policy wording, line 2.\nSynthetic policy wording, line 3.\nSynthetic policy wording, line 4.\nSynthetic policy wording, line 5.\nSynthetic policy wording, line 6.\nSynthetic policy wording, line 7.\nSynthetic policy wording, line 8.",
  },
  {
    i: 122,
    l: "Page 37 — Shift Replacement",
    p: 38,
    s: "Shift Replacement",
    printedPage: 37,
    sections: [{ page: 37, heading: "Shift Replacement" }],
    c: "Shift Replacement\nSynthetic policy wording, line 1.\nSynthetic policy wording, line 2.\nSynthetic policy wording, line 3.\nSynthetic policy wording, line 4.\nSynthetic policy wording, line 5.\nSynthetic policy wording, line 6.\nSynthetic policy wording, line 7.\nSynthetic policy wording, line 8.\nSynthetic policy wording, line 9.",
  },
  {
    i: 123,
    l: "Page 37 — Seminar/Webinar Attendance",
    p: 38,
    s: "Seminar/Webinar Attendance",
    printedPage: 37,
    sections: [{ page: 37, heading: "Seminar/Webinar Attendance" }],
    c: "Seminar/Webinar Attendance\nSynthetic policy wording, line 1.\nSynthetic policy wording, line 2.\nSynthetic policy wording, line 3.\nSynthetic policy wording, line 4.\nSynthetic policy wording, line 5.\nSynthetic policy wording, line 6.\nSynthetic policy wording, line 7.",
  },
  {
    i: 128,
    l: "Page 39 — Bonus Policy",
    p: 40,
    s: "Bonus Policy",
    printedPage: 39,
    sections: [{ page: 39, heading: "Payroll Deductions" }],
    c: "Synthetic policy wording, line 1.\nSynthetic policy wording, line 2.\nSynthetic policy wording, line 3.\nPayroll Deductions\nSynthetic policy wording, line 4.\nSynthetic policy wording, line 5.\nSynthetic policy wording, line 6.\nSynthetic policy wording, line 7.\nSynthetic policy wording, line 8.",
  },
];

/** As `SupabaseKnowledgeProvider.fetchOfficialPolicyManual` returns them. */
export const JBA_MANUAL_CA_CHUNKS = ROWS.map((row) => ({
  chunkIndex: row.i,
  chunkId: `jba-${row.i}`,
  locator: row.l,
  page: row.p,
  content: row.c,
  section: row.s,
  printedPage: row.printedPage,
  sections: row.sections,
}));
