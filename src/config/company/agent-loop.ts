import type { AgentLoopContent, LoopWords } from "@/lib/ai/agent-loop/app-config";

/**
 * ============================================================================
 * ASK SUNNY'S COMPANY CONTENT FOR THE AGENT LOOP'S RULES BOOK
 * ============================================================================
 *
 * Phase 1 of the loop port to the sibling app (QA, 21 Nov 2026): the rules book (`rules-book.ts`) is mechanism;
 * what belongs to this company is here: the rulings on this company's JBA Policy Manual headings, its sales metrics,
 * its report names, its time zone, who approves a termination, the page forms are listed on, and the example phrases
 * the rules teach with. Every string is the rules book's own text, moved here unchanged, so Sunny's rules book is
 * byte-identical (`app-config.test.ts` against `__fixtures__/sunny-rules-book.txt`).
 *
 * The sibling app writes its own version of this file from its own manual, metrics and reports. Never copy these
 * strings there: port the mechanism, not this company's content (CLAUDE.md).
 */
export function sunnyLoopContent({ place, staff }: LoopWords): AgentLoopContent {
  return {
    formsPageName: "Form Monitoring",
    notPeopleExamples: "\"Under Performance\", \"Club Close\", \"MSB\" (must see behaviors) and other metrics",
    otherTopics: "Must See Behaviors, a cleaning duty left undone",
    statsReports: "Daily Stats, Sales Totals and Comp",
    terminationApproval: "DM/HR approval",
    timeZone: { label: "US Central time", short: "Central", abbrev: "CT" },
    whoRules: [
      "Managers' shorthand for a doctor (Pau, 20 Nov 2026): \"dr\", \"dr.\", \"drs\", \"dr note\", \"drs note\" and \"dr's note\" mean doctor and a doctor's note. They are never a person, a name or a title: no find_staff and no Did-you-mean for them. Spell them out (\"doctor's note\", \"doctor\") in what_happened, your reply and any tool query (read_policy, search), never \"drs note\". An absence the manager tells with or without a doctor's note is an attendance account (the Attendance section: absent more than two days needs a doctor's note on return).",
    ],
    policyRulings: [
      "The policy fits WHAT HAPPENED, not the words around it: a coat or the wrong top during a shift is dress code; failing to open on time is late opening; a missed shift or lateness is attendance.",
      "On a Corrective Action, a cleaning or sanitation duty left undone (beds, lobby, restrooms, the 10-minute sanitation, disinfecting; propose_form's cleaning_duty fact names it) is policy \"Other — <short topic>\", never the Standards of Conduct, unless the manager names the Care and Cleaning policy (then that section). A cleaning duty beside another offense cites both: policy \"<that offense's heading>; Other — <topic>\".",
      "Clocking out early or leaving before the end of the scheduled shift is Attendance (knowing the work schedule and being on time; Pau, 17 Nov 2026). The " + place + " closed early or closing duties done before close are part of that same offense, so it is still Attendance alone, with the closing detail kept in the account.",
      "Staying after hours, or clocking out more than fifteen minutes after the end of the scheduled shift without a manager's approval, is the manual's Time Records section (Timekeeping & Payroll; Pau, 17 Nov 2026), never Attendance.",
      "Late FOR a shift (\"late for her opening shift\", the employee arrived late) is Attendance; \"late to open\", the " + place + " opening late (doors opened late, failure to open) is Late Opening.",
      "A guest or customer complaint about the employee's conduct is the Standards of Conduct. \"MSB\" / \"must see behaviors\" (abbreviated or spelled out, any case) is not the Standards of Conduct: its policy is \"Other — Must See Behaviors\" (Pau, 16 Nov 2026).",
      "Underperformance against sales or performance targets is the Standards of Conduct. If the manager asked for \"Under Performance\", add in your reply: \"Under Performance isn't on the CA form. Sales performance CAs use the Standards of Conduct.\"",
    ],
    sectionRulings: [
      "An animal anywhere in an at-work sentence (a pet, a dog in the " + place + ", an animal brought to work) is Animals in the Workplace.",
      "Each of these has its own section; read it and cite it: a wet floor with no wet floor sign, a long or extra break, social media posts about work, harassment, pets and animals, theft, cash handling, insubordination.",
      "The Standards of Conduct: assigned work or training not finished by its deadline (" + staff + " training, acknowledgements, assigned courses); leaving the front desk, register or work area unattended during the shift (never Attendance); a sale rung up wrong (wrong items or prices); a short drawer or register (never Handling Theft unless the manager says theft).",
    ],
    attendanceRules: [
      "Attendance (QA, 20 Nov 2026): a Corrective Action citing Attendance always takes attendance (absence: a shift missed, as \"did not come in\", a no-show, a call-out; lateness: late, or left early; both: each) with attendance_evidence, the manager's words from this request that describe it, exactly as typed. A missed shift is an absence, never lateness. attendance_not_given or attendance_evidence_not_found means propose the card again with it.",
    ],
    underPerformanceReplies: [
      "under_performance: \"Under Performance isn't on the CA form. Sales performance CAs use the Standards of Conduct.\"",
    ],
    metricsRule: "Metrics are kept exactly as the manager wrote them: MSB (must see behaviors), PPTA, LPSVA, UPTA, Club Average, Club Close %, CC%, Spa %, every number (\"146 tans\", \"237 tanning transactions\") and the month. They are never people.",
    volumeRule: "A number right before \"tans\" or \"transactions\" is the volume, and the metrics after \"below in\" are where the employee fell short: \"verbal 146 tans Below in PPTA, LPSVA, Average Club, CC%, Spa%\" is \"Across 146 tans, she was below target in PPTA, LPSVA, Average Club, CC% and Spa%.\", never \"146 tans below\".",
    statsGuideRule: "A Daily Stats \"what to focus on\" answer follows the focus_guide read_stats returns, and cites it with its cite marker.",
    examples: {
      addedTopic: "weekly coaching for how to get EFTs",
      addedTopicQuestion: "Who is this weekly EFT coaching for?",
      namedPolicy: "cite the animals in the workplace policy",
      misspelledPolicy: "ca for the key holdr policy",
      formAbout: "the 10/31 one about getting rooms ready between guests",
      spellingFixes: "\"th e10 minute sanitaion\" → \"the 10-minute sanitation\", \"disenfect\" → \"disinfect\"",
      becausePlace: "late because of traffic on Dodge",
      ruleInOtherSection: "\"No tanning while on the clock\" is in Employee Discounts for Company Products and Services",
      approvedTermination: "my DM approved her termination",
      rewordNoLink: "\"didnt check the beds between clients and left towels on the floor in room 3\" is \"She did not check the beds between clients. She left towels on the floor in room 3.\"",
      policyLine: "Attendance Policy, JBA Policy Manual p.14",
      position: "who are my tanning consultants",
      howTo: "\"how do I do the 10 minute sanitation\", \"what's the opening checklist\"",
      businessDocs: "the reviews SOP, the trackers, the Daily Stats guide",
    },
  };
}
