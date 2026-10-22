/**
 * The sections of the 2025 JBA Policy Manual (Edited 5-2025) that a
 * Corrective Action Form for a salon is most often written
 * against, and the neighbouring sections a policy lookup must NOT land on
 * (Texting as General Work communications, Social Media Policy, Using Social Media at Work,
 * Seminar/Webinar Attendance, Payroll Deductions, Disciplinary Action …).
 *
 * The layout follows the manual as ingested (chunk index, locator, PDF sheet,
 * section, printed page and printed headings), but the WORDING IS INVENTED:
 * the repository never carries the manual's text. Each chunk keeps its
 * heading and the facts the tests read (the $25 Late Opening deduction,
 * phones and social media, meetings counting as scheduled shifts). The
 * provider maps rows to `ManualChunk` exactly as `fetchOfficialPolicyManual`
 * does.
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
    c: "Drug, Alcohol and Smoking Policy\nThe Company keeps a safe and productive workplace. Using, holding or selling alcohol or illegal\ndrugs at work or on company property is not allowed, and no one may come to work impaired.\nThe Company prohibits:\no Using or holding alcohol or illegal drugs at work or on a work assignment.\no Working while impaired by alcohol or drugs.",
  },
  {
    i: 33,
    l: "Page 12 — Prescribed Medications",
    p: 13,
    s: "Prescribed Medications",
    printedPage: 12,
    sections: [{ page: 12, heading: "Smoking/Vaping" }],
    c: "o An Employee taking a medicine that affects safe work tells Human Resources before the\nnext shift, so duties can be adjusted if needed.",
  },
  {
    i: 34,
    l: "Page 12 — Prescribed Medications",
    p: 13,
    s: "Prescribed Medications",
    printedPage: 12,
    sections: [{ page: 12, heading: "Smoking/Vaping" }],
    c: "Smoking/Vaping\no Tobacco and nicotine products, vapes included, are not used while working or anywhere on\nthe premises, parking lots included.\nThe Company may ask for random or for-cause drug and alcohol testing.",
  },
  {
    i: 36,
    l: "Page 12 — Standards of Conduct",
    p: 13,
    s: "Standards of Conduct",
    printedPage: 12,
    sections: [{ page: 12, heading: "Standards of Conduct" }],
    c: "Standards of Conduct\nThe Company asks every Employee to act in a way that keeps customers, coworkers and The\nCompany safe.\nExamples (not a complete list) of conduct that may lead to disciplinary action, up to and\nincluding termination:\no Not following The Company's policies and procedures",
  },
  {
    i: 37,
    l: "Page 13 — Standards of Conduct",
    p: 14,
    s: "Standards of Conduct",
    printedPage: 13,
    sections: [],
    c: "o Poor sales results\no Theft or misuse of property belonging to The Company, a coworker or a customer\no Unapproved discounts\no Register or bank shortages\no Changing time records\no Fighting or threats at work\no Insubordination - refusing a manager's direction.",
  },
  {
    i: 38,
    l: "Page 13 — Standards of Conduct",
    p: 14,
    s: "Standards of Conduct",
    printedPage: 13,
    sections: [],
    c: "o Fighting or threats at work\no Loud or disruptive behavior at work\no Insubordination - refusing a manager's direction.\no Disrespect toward a manager or coworker\no Breaking safety rules\no Excessive absences or any absence without notice\no Leaving the work area without approval during a shift\no Unapproved use of telephones, computers or other company equipment\no Sharing confidential business or customer information",
  },
  {
    i: 39,
    l: "Page 14 — Standards of Conduct",
    p: 15,
    s: "Standards of Conduct",
    printedPage: 14,
    sections: [],
    c: "o Recording customers or coworkers without their knowledge\no Breaking personnel policies\no Poor job performance or conduct\nEmployment is at will for both The Company and the employee.",
  },
  {
    i: 40,
    l: "Page 14 — Disciplinary Action",
    p: 15,
    s: "Disciplinary Action",
    printedPage: 14,
    sections: [{ page: 14, heading: "Disciplinary Action" }],
    c: "Disciplinary Action\nThe Company uses a fair process for disciplinary action, giving employees notice of concerns\nand a chance to correct them.\nThe usual steps are a verbal warning (documented in the employee file), a written warning, a\nfinal written warning, and termination. Management may skip steps, and serious offenses may\nlead to immediate termination.",
  },
  {
    i: 41,
    l: "Page 14 — Attendance",
    p: 15,
    s: "Attendance",
    printedPage: 14,
    sections: [{ page: 14, heading: "Attendance" }],
    c: "Attendance\nEach employee knows their schedule and arrives on time. Poor punctuality and absences hurt the\nteam and the client. An employee who cannot work a scheduled shift finds a coworker to cover it\n(See Shift Replacement). A no call or no show for a scheduled shift may lead to termination.\no An employee who will be tardy or absent calls their manager on duty at least 2 hours before\nthe shift, unless an emergency makes that impossible.\no A text message to a manager does not count as calling in.\no Seminars/Meetings/ Training sessions count as scheduled shifts. (See\nSeminar/Webinar Attendance section)",
  },
  {
    i: 42,
    l: "Page 15 — Late Opening",
    p: 16,
    s: "Late Opening",
    printedPage: 15,
    sections: [{ page: 15, heading: "Late Opening" }],
    c: "Late Opening\nAn employee scheduled to open who cannot open on time tells the manager right away. The\nmanager opens and stays until the scheduled opener or a replacement arrives. The employee who\ndid not open repays The Company $25.00 via payroll deduction (when applicable and allowed by\nstate and local law). Managers send the payroll deduct total to Payroll. *",
  },
  {
    i: 43,
    l: "Page 15 — Texting as General Work communications",
    p: 16,
    s: "Texting as General Work communications",
    printedPage: 15,
    sections: [{ page: 15, heading: "Texting as General Work communications" }],
    c: "Texting as General Work communications\nTexting is NOT used for official work matters such as schedule changes, calling off, shift\nchanges, request offs, notice, or disciplinary or corrective action conversations. These need a\nconversation in person or by phone call.",
  },
  {
    i: 61,
    l: "Page 19 — Cell Phone/Smart Watch Policy",
    p: 20,
    s: "Cell Phone/Smart Watch Policy",
    printedPage: 19,
    sections: [{ page: 19, heading: "Cell Phone/Smart Watch Policy" }],
    c: "Cell Phone/Smart Watch Policy\nPersonal cell phones may be brought to work but stay out of sight. Texting, phone calls or social\nmedia while working take attention away from customers. Phones stay on silent and off the\nEmployee's person (not in a pocket or on the counter). A cell phone is used while clocked in only\nfor an emergency.\nSmart Watches may be worn if they are not used for social media, texting or phone calls.",
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
    c: "Talking to the Media/Press\nEmployees do not speak with the media or press. Media questions go to the Corporate Office.\nSocial Media Policy\nSocial media means any way of posting or sharing content on the internet, such as blogs,\npersonal websites, social networking sites, message boards or chat rooms, whether or not it\nmentions The Company.",
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
    c: "Using Social Media at Work\nDo not use social media during work time or on company equipment unless a supervisor has\napproved it for work. Do not use a Company email address for personal social accounts.\nRetaliation is Prohibited\nNo Employee may be punished for reporting a possible policy concern or helping with an\ninvestigation. Retaliation leads to disciplinary action, up to and including termination.",
  },
  {
    i: 96,
    l: "Page 29 — Visitors in the Workplace",
    p: 30,
    s: "Visitors in the Workplace",
    printedPage: 29,
    sections: [{ page: 29, heading: "Visitors in the Workplace" }],
    c: "Visitors in the Workplace\nVisitors are anyone allowed onto Company premises, including friends and family. Employees get a\nSupervisor's approval before inviting a personal visitor, keep visits short, and stay with their\nvisitors. Safety concerns about a visitor go to Human Resources and the Supervisor.",
  },
  {
    i: 100,
    l: "Page 30 — Handling Theft",
    p: 31,
    s: "Handling Theft",
    printedPage: 30,
    sections: [{ page: 30, heading: "Handling Theft" }],
    c: "Handling Theft\nAn Employee who sees or suspects theft reports it to the manager on duty or a District Manager,\nand does not discuss it with anyone else or act alone. Reporting the right way keeps theft\nhandled lawfully.",
  },
  {
    i: 122,
    l: "Page 37 — Shift Replacement",
    p: 38,
    s: "Shift Replacement",
    printedPage: 37,
    sections: [{ page: 37, heading: "Shift Replacement" }],
    c: "Shift Replacement\nTrading shifts is discouraged, but may be allowed in an emergency with management's approval.\nThe employee finds their own replacement. An employee who cannot work calls their supervisor\ndirectly, with at least two hours' notice when possible. Texting is NOT accepted; a phone call\nis required.",
  },
  {
    i: 123,
    l: "Page 37 — Seminar/Webinar Attendance",
    p: 38,
    s: "Seminar/Webinar Attendance",
    printedPage: 37,
    sections: [{ page: 37, heading: "Seminar/Webinar Attendance" }],
    c: "Seminar/Webinar Attendance\nMissing a seminar/webinar you are enrolled in without telling your Supervisor counts as a no call\nno show to a scheduled shift. If you cannot attend, call your Supervisor personally at least two\n(2) hours before it starts; in an emergency, call as soon as you can.",
  },
  {
    i: 128,
    l: "Page 39 — Bonus Policy",
    p: 40,
    s: "Bonus Policy",
    printedPage: 39,
    sections: [{ page: 39, heading: "Payroll Deductions" }],
    c: "one day's notice. Ask your Supervisor which bonus programs apply to your position.\nPayroll Deductions\nThe Company withholds taxes as the law requires. Bonuses and prizes are taxable. Insurance\npremiums are collected via payroll deductions.",
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
