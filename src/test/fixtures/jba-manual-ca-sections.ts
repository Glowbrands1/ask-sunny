/**
 * The sections of the 2025 JBA Policy Manual (Edited 5-2025) that a
 * Corrective Action Form for a Buff City Soap store is most often written
 * against, and the neighbouring sections a policy lookup must NOT land on
 * (Texting as General Work communications, Social Media Policy, Using Social Media at Work,
 * Seminar/Webinar Attendance, Payroll Deductions, Disciplinary Action …).
 *
 * Read-only export of Ask Bubbles' knowledge base, 22 Oct 2026: chunk index,
 * locator, PDF sheet, the section ingestion recorded, the printed page and
 * printed headings from `metadata`, and the chunk text VERBATIM. Policy text
 * only; no employee data. The provider maps rows to `ManualChunk` exactly as
 * `fetchOfficialPolicyManual` does.
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
    c: "Drug, Alcohol and Smoking Policy\nIn compliance with the Drug-Free Workplace Act of 1988, The Company has a longstanding\ncommitment to provide a safe, quality-oriented, and productive work environment. Alcohol and\ndrug abuse pose a threat to the health and safety of Company Employees and to the security of\nThe Company's equipment and facilities. For these reasons, The Company is committed to the\nelimination of drug and alcohol use and abuse in the workplace. The possession, use, sale, manufacture or distribution of alcohol, illegal drugs or controlled\nsubstances on company time or on company premises is strictly prohibited. Reporting to work at\nany time under the influence of alcohol, illegal drugs or controlled substances is strictly\nprohibited. With this goal in mind, we are establishing the following policy for all Employees of The\nCompany. The Company explicitly prohibits:\no The use, possession, solicitation for, or sale of narcotics or other illegal drugs, alcohol, or\nprescription medication without a prescription on Company premises or while performing a\nwork-related assignment. o Being impaired or under the influence of illegal drugs or alcohol on Company premises or on\na work-related assignment. o Possession, use, manufacture, solicitation for, or sale of illegal drugs or alcohol on Company\npremises or on a work-related assignment. o The presence of any detectable number of prohibited substances in the Employee's system\nwhile at work or while on Company premises.",
  },
  {
    i: 33,
    l: "Page 12 — Prescribed Medications",
    p: 13,
    s: "Prescribed Medications",
    printedPage: 12,
    sections: [{ page: 12, heading: "Smoking/Vaping" }],
    c: "o Any medications that inhibit an Employee’s ability to perform their job duties safely and\neffectively must be reported to the Human Resource Department prior to their next working\nday for further review and possible job duty modifications (if applicable).",
  },
  {
    i: 34,
    l: "Page 12 — Prescribed Medications",
    p: 13,
    s: "Prescribed Medications",
    printedPage: 12,
    sections: [{ page: 12, heading: "Smoking/Vaping" }],
    c: "Smoking/Vaping\no Our business is focused on health, and we have several policies affecting the possession and\nuse of all tobacco products and nicotine products, including but not limited to cigarettes,\nvapor cigarettes, and chewing tobacco while working, or while on the premises. o The Company adheres to all federal, state, local rules regarding smoking in the workplace. Smoking or use of “vapor” products are not permitted in any of the locations. All locations,\nincluding but not limited to all facilities and parking areas and company owned or leased\nvehicles are smoke and vapor free. Employees who smoke or use “vapor” products shall do\nso off the premises, including the parking lots. The Company reserves the right to undertake monitored drug and/or alcohol testing as follows:\no RANDOM TESTING: Employees may be selected at random for drug and/or alcohol testing at\nany interval determined by The Company. This test may be monitored/observed when\nadministered. o FOR-CAUSE TESTING: The Company may ask an Employee to submit to a drug and/or alcohol\ntest at any time it has reason to believe that the Employee may be under the influence of\ndrugs or alcohol, including, but not limited to, the following circumstances: evidence of\ndrugs or alcohol on or about the Employee's person or in the Employee's vicinity; unusual\nconduct on the Employee's part that suggests impairment or influence of drugs or alcohol;\nnegative performance patterns; or excessive and unexplained absenteeism or tardiness. This\ntest may be monitored/observed when administered.",
  },
  {
    i: 36,
    l: "Page 12 — Standards of Conduct",
    p: 13,
    s: "Standards of Conduct",
    printedPage: 12,
    sections: [{ page: 12, heading: "Standards of Conduct" }],
    c: "Standards of Conduct\nThe Company expects Employees to follow rules of conduct that will protect the interests and\nsafety of all customers, Employees, and The Company.\nThe following are examples (non-inclusive list) of infractions that may result in disciplinary\naction, up to and including transfer, suspension with or without pay, demotion, or immediate\ntermination of employment, as well as potential civil or criminal prosecution depending on the\nseverity and circumstances involved:\no Failing to follow the policies and procedures of The Company",
  },
  {
    i: 37,
    l: "Page 13 — Standards of Conduct",
    p: 14,
    s: "Standards of Conduct",
    printedPage: 13,
    sections: [],
    c: "o Lack of sales performance\no Indecent or immoral behavior\no Conduct that requires investigation due to its negative impact on The Company’s public\nreputation or perception, regardless of whether it occurred on or off company premises, on\nor off the clock, and regardless of whether the conduct resulted in criminal charges of any\nkind. o Theft, inappropriate removal, destruction, vandalism, unauthorized possession, or\nfraudulent use of The Company’s, another Employee’s, or a customer’s property. o Giving unauthorized discounts\no Register / Bank shortages\no Falsification of timekeeping records\no Misrepresentation of facts during the hiring & training process or at any other time during\nany other process. o Falsification or unauthorized destruction of any Company document or record. o Working under the influence of alcohol or illegal drugs\no Possession, manufacture, distribution, sale, transfer, or use of alcohol, illegal drugs, or\ncontrolled substances for which the person has no prescription in the workplace, while on\nduty, or while operating employer-owned vehicles or equipment. o Fighting or threatening violence in the workplace\no Boisterous or disruptive activity in the workplace\no Threatened or actual injury of another Employee or customer\no Negligence or improper conduct leading to damage of employer-owned, Employee-owned,\nor customer-owned property\no Insubordination -the refusal to follow the directions of the manager.",
  },
  {
    i: 38,
    l: "Page 13 — Standards of Conduct",
    p: 14,
    s: "Standards of Conduct",
    printedPage: 13,
    sections: [],
    c: "o Fighting or threatening violence in the workplace\no Boisterous or disruptive activity in the workplace\no Threatened or actual injury of another Employee or customer\no Negligence or improper conduct leading to damage of employer-owned, Employee-owned,\nor customer-owned property\no Insubordination -the refusal to follow the directions of the manager.\n\no Behavior that demonstrates disrespect for a manager or other Employees, or indifference to\nThe Company’s interests (i.e., any written or verbal statement that may call into question\nthe employee’s credibility, integrity, judgment, or commitment to The Company’s\nemployment or business policies or mission. Statements include, but not limited to, postings\non web logs, chat rooms, message boards, and discussion groups or speeches, lectures,\ninterviews with the media, etc....)\no Violation of safety or health rules\no Smoking in prohibited areas\no Violation of The Company’s Sexual and Other forms of Harassment policy\no Retaliation in any form and at any level\no Possession of illegal, improper, dangerous, or unauthorized materials in the workplace\no Excessive absenteeism or any absence without notice\no Unauthorized absence from the work area during the workday\no Unauthorized use of telephones, computer systems, mail system, or other employer- owned\nequipment\no Misuse of computer resources or other Company property\no Unauthorized disclosure of business strategies or confidential Company, Employee, or\ncustomer information",
  },
  {
    i: 39,
    l: "Page 14 — Standards of Conduct",
    p: 15,
    s: "Standards of Conduct",
    printedPage: 14,
    sections: [],
    c: "o Undisclosed and/or unauthorized photography, video recording, or sound recording of oral,\nor telephone communication, in which a customer, Employee, agent or other person doing\nbusiness with The Company is a participant.\no Violation of personnel policies\no Unsatisfactory job performance or conduct\nEmployment with The Company is at the mutual consent of The Company and the employee,\nand either party may terminate that relationship at any time, with or without cause.",
  },
  {
    i: 40,
    l: "Page 14 — Disciplinary Action",
    p: 15,
    s: "Disciplinary Action",
    printedPage: 14,
    sections: [{ page: 14, heading: "Disciplinary Action" }],
    c: "Disciplinary Action\nThe Company maintains a procedure to ensure a fair method of appropriate disciplinary action.\nDisciplinary Action is a system intended to give employees advance notice, whenever possible,\nor concerns with employee conduct or performance. This provides employees an opportunity to\ncorrect any problems that may arise.\nThe Company typically operates under the system of three write-ups equal termination,\nconsisting of verbal warning (documented and put in employee file), written warning, final\nwritten warning, and termination. Management has the authority to suspend employee\ndiscounts or privileges as an alternative form of disciplinary action, or in conjunction with any\npreviously mentioned step of disciplinary action. Management may also forego the\naforementioned steps and skip to written warning or final written warning. Serious offenses\nmay result in immediate termination. Employment with The Company is based on mutual\nconsent and both the employee, and The Company have the right to terminate employment as\nwill, with or without cause or advance notice. The Company may use progressive discipline at its\ndiscretion.",
  },
  {
    i: 41,
    l: "Page 14 — Attendance",
    p: 15,
    s: "Attendance",
    printedPage: 14,
    sections: [{ page: 14, heading: "Attendance" }],
    c: "Attendance\nIt is the responsibility of each employee to know his or her work schedule and to always be on\ntime. Lack of punctuality or absenteeism has a negative impact on everyone’s schedule and\ncreates a lack of service for the client. It is the employee’s responsibility to find a co-worker as a\nreplacement for a scheduled shift if the employee is not able to work that shift (See Shift\nReplacement). If an employee is absent from work for more than two days, a doctor’s note is\nrequired upon return to work. Excessive absenteeism will result in termination. No call or no\nshow for a scheduled shift may result in immediate termination.\no If an employee is going to be tardy or absent, it is mandatory that the employee call and\nspeak to their direct manager on duty and notify them of the occurrence at least 2 hours\nbefore their scheduled shift unless it is an instance that it is not possible for them to do so.\n(Accident, etc.), Employees must contact their Supervisor via direct phone call immediately.\nIf an employee is unable to reach their Supervisor, the employee should keep calling up the\nchain of command until someone answers.\no Texting a manager is not allowed when calling in. Employees must speak with their\nmanager directly.\no Seminars/Meetings/ Training sessions are considered scheduled shifts. (See\nSeminar/Webinar Attendance section)",
  },
  {
    i: 42,
    l: "Page 15 — Late Opening",
    p: 16,
    s: "Late Opening",
    printedPage: 15,
    sections: [{ page: 15, heading: "Late Opening" }],
    c: "Late Opening\nWhen an employee assigned to open a location is unable to open the location at the proper\ntime, the employee must notify the manager as soon as possible. The manager of the salon will\nbe required to open the salon and work until the person originally assigned arrives, or a\nreplacement is found. The employee who failed to open will then be required to reimburse The\nCompany $25.00 via payroll deduction (when applicable and following all state and local\nguidelines), for all expenses incurred. Managers or District Managers will be responsible for\noffering restitution to affected clients, as well as giving the payroll deduct total to Payroll. *",
  },
  {
    i: 43,
    l: "Page 15 — Texting as General Work communications",
    p: 16,
    s: "Texting as General Work communications",
    printedPage: 15,
    sections: [{ page: 15, heading: "Texting as General Work communications" }],
    c: "Texting as General Work communications\nTexting is NOT an acceptable form of communication for official work communications such as;\nschedule changes, calling off, shift changes, request offs, availability changes, giving two weeks'\nnotice, complaints, conversations regarding disciplinary or corrective actions, or for any other\ntopics that may cause a hardship to the business, etc.. These instances require direct\ncommunication either in person or via phone call(s). Texting may be acceptable for other\nreasons but check with direct Supervisor(s) regarding when texting may be acceptable.",
  },
  {
    i: 61,
    l: "Page 19 — Cell Phone/Smart Watch Policy",
    p: 20,
    s: "Cell Phone/Smart Watch Policy",
    printedPage: 19,
    sections: [{ page: 19, heading: "Cell Phone/Smart Watch Policy" }],
    c: "Cell Phone/Smart Watch Policy\nPersonal Employee cell phones are permitted in the workplace but must be kept out of sight. It\nis the Employee’s personal responsibility to protect the customer’s experience and doing things\nsuch as texting, making phone calls or using social media jeopardizes the customer’s experience.\nEmployees should keep cell phones on silent and not on their person (this means not in back\npockets, charging in the break room, or sitting on top of a drawer till). The only time that a cell\nphone should be accessed while clocked in is in emergency situations.\nSmart Watches are allowed as long as they are not being used for social media or texting/phone\ncalls. We reserve the right to ask Employees to remove any smart watch if it starts to interfere\nwith the customer's experience.",
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
    c: "Talking to the Media/Press\nAny conversation with the media or press, including television stations, radio stations,\nnewspapers, etc., is strictly prohibited. Please direct any and all media inquiries to the\nCorporate Office.\n\nSocial Media Policy\nThe Company understands that social media can be a fun and rewarding way to share an\nemployee’s life and opinions with family, friends, and co-workers around the world. Social\nmedia includes all means of communicating, posting information, or content of any sort on the\ninternet. This may come from; employee’s own or someone else’s web log or blog, journal or\ndiary, personal website, social networking or affinity website, web bulletin board or a chat\nroom, as well as many other forms of electronic communication whether it is associated with\nThe Company or not.",
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
    c: "Using Social Media at Work\nAvoid using social media while on work time or on equipment we provide unless it is work-\nrelated as authorized by your supervisor or consistent with Company policy. Do not use\nCompany email addresses to register on social networks, blogs or other online tools utilized for\npersonal use.\n\nRetaliation is Prohibited\nThe Company prohibits taking negative action against any Employee for reporting a possible\ndeviation from any policy or for cooperating in an investigation. Any Employee who retaliates\nagainst another Employee for reporting a possible deviation from any policy or for cooperating\nin an investigation will be subject to disciplinary action, up to and including termination. If\nemployees have a question or need further guidance, please contact Human Resources.",
  },
  {
    i: 96,
    l: "Page 29 — Visitors in the Workplace",
    p: 30,
    s: "Visitors in the Workplace",
    printedPage: 29,
    sections: [{ page: 29, heading: "Visitors in the Workplace" }],
    c: "Visitors in the Workplace\nThis policy applies to The Company. Visitors include all persons who are granted access to\nCompany premises, including, but not limited to, Employees, contractors, customers, and\nEmployees’ acquaintances, friends and family members, regardless of whether the purpose of\nthe visit is for business reasons. For personal visitors, Employees must obtain approval from direct Supervisors each time they\ninvite a visitor into the workplace. The Supervisor has responsibility for enforcing this policy and\nensuring that visitors (regardless of whether or not they are JB & Associates Employees) stay for\nonly limited and non-disruptive periods of time. If a visitor does not have approval and/or is\nunannounced, the Supervisor will verify with the Employee that the visitor is “welcome”. If the\nvisitor is welcome, the Employee will be asked to meet the visitor at the front\nentrance/reception area. If the Employee is uncomfortable with allowing the visitor into the\nworkplace, the Supervisor or manager on duty must refuse to allow the visitor into the\nworkplace. Violent domestic issues, including Restraining Orders, PPO-Personal Protection Orders, and\nintense domestic concerns should be communicated promptly to Human Resources and the\ndirect Supervisor to promote a safe and secure workplace. Employees who have invited guests are responsible for escorting non-Employee visitors to their\ndestinations and always accompanying them. Employees are responsible for the conduct of their\nvisitors.",
  },
  {
    i: 100,
    l: "Page 30 — Handling Theft",
    p: 31,
    s: "Handling Theft",
    printedPage: 30,
    sections: [{ page: 30, heading: "Handling Theft" }],
    c: "Handling Theft\nThe Company Employees who have witnessed or suspect an act of dishonesty or business\nabuses should report it to the manager on duty, District Manager, or other Upper Management.\no It is paramount that employees do not discuss suspicions to anyone else in The Company, or\noutside of work.\nEmployees should not act on their own to resolve the theft issue. Communicate concerns as\noutlined above. We must prevent theft at all times to secure the success of our company. Theft\nis a loss that can be prevented. Following the correct procedures above will ensure that theft is\navoided and handled lawfully and ethically when it does occur.",
  },
  {
    i: 122,
    l: "Page 37 — Shift Replacement",
    p: 38,
    s: "Shift Replacement",
    printedPage: 37,
    sections: [{ page: 37, heading: "Shift Replacement" }],
    c: "Shift Replacement\nShift trading between employees disrupts company operations and is generally discouraged.\nHowever, in emergency situations, employees may trade shifts with prior approval from\nmanagement. It is the responsibility of the employee to find a replacement for their shift. If an\nemployee is unable to work due to illness, emergency, or unforeseen circumstances, they must\nimmediately call and speak directly with their supervisor to notify them of the situation.\nEmployees should provide at least two hours’ notice when calling in as a courtesy to colleagues.\nIn the event of an emergency where two hours’ notice is not possible the employee must\ncontact their supervisor directly by phone immediately. Texting is NOT an acceptable method of\ncommunication a phone call is required.",
  },
  {
    i: 123,
    l: "Page 37 — Seminar/Webinar Attendance",
    p: 38,
    s: "Seminar/Webinar Attendance",
    printedPage: 37,
    sections: [{ page: 37, heading: "Seminar/Webinar Attendance" }],
    c: "Seminar/Webinar Attendance\nIf you are enrolled in a seminar/webinar and do not attend the seminar without notifying your\nSupervisor, it is considered a no call no show to a scheduled shift. If you cannot attend a\nseminar/webinar you are scheduled for, you must notify your Supervisor via a personal phone\ncall. Notice of a call-in should not occur “last minute” and should be completed at least two (2)\nhours in advance out of courtesy to fellow Employees. In cases of emergency where two (2)\nhours advance notice is not possible (accident, etc.), you must contact your Supervisor via direct\nphone call immediately.",
  },
  {
    i: 128,
    l: "Page 39 — Bonus Policy",
    p: 40,
    s: "Bonus Policy",
    printedPage: 39,
    sections: [{ page: 39, heading: "Payroll Deductions" }],
    c: "one day’s notice. Please see your Supervisor regarding brand’s bonus policies and incentive pay\nprograms to find those that apply to your specific position.\n\nPayroll Deductions\nThe Company withholds all federal, state, and local taxes as required by law and IRS guidelines.\nAll bonuses, special pay, and prizes employees receive are taxable. Employee premium\npayments for their elected insurance benefits are also collected via payroll deductions unless\nthe Employee is on leave during which other payment arrangements will be made. (See also\nEmployee Insurance Benefits section for more details).",
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
