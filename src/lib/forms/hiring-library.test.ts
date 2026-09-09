import { describe, expect, it } from "vitest";

import { FORM_CATEGORIES, groupTemplatesByCategory } from "./catalog";
import { parseFormDocument, responsibilityMap, type FormDocument } from "./document";
import {
  firstRoundManagementInterviewDocument,
  prescreenPhoneInterviewDocument,
  secondRoundManagementInterviewDocument,
  tanningConsultantInterviewDocument,
} from "./hiring-library";
import { TEMPLATE_SEEDS, coachingDocument } from "./library";

/**
 * SOURCE FIDELITY, ASSERTED RATHER THAN CLAIMED.
 *
 * Every section name, every checkbox option and every question below is
 * transcribed from the supplied Word document, and the assertions are written
 * as WHOLE LISTS rather than as spot checks. `toEqual` on the full list is what
 * catches the two failures a `toContain` cannot: an item that quietly went
 * missing, and an item nobody put in the source that quietly appeared.
 *
 * Reading these tests against the .docx is the review. That is the point of
 * writing them this way — a reviewer with the source open can check the form
 * without reading a line of the implementation.
 *
 * EVERY DOCUMENT IS ALSO PARSED BEFORE IT IS ASSERTED ON. `parseFormDocument`
 * is what the database read runs, and it refuses a duplicate field key, an
 * unknown block kind and a missing responsibility. A document that only passes
 * because it never reaches the parser would be a document that cannot be
 * stored.
 */

const stored = (document: FormDocument) => parseFormDocument(document);

function sections(document: FormDocument): string[] {
  return parseFormDocument(document)
    .blocks.filter((block) => block.kind === "section")
    .map((block) => (block as { label: string }).label);
}

function paragraphs(document: FormDocument): string[] {
  return parseFormDocument(document)
    .blocks.filter((block) => block.kind === "paragraph")
    .map((block) => (block as { text: string }).text);
}

function notes(document: FormDocument): string[] {
  return parseFormDocument(document)
    .blocks.filter((block) => block.kind === "note")
    .map((block) => (block as { text: string }).text);
}

function options(document: FormDocument, key: string): string[] {
  const group = parseFormDocument(document).blocks.find(
    (block) => block.kind === "checkbox_group" && block.key === key,
  );
  if (!group || group.kind !== "checkbox_group") {
    throw new Error(`no checkbox group "${key}"`);
  }
  return group.options.map((option) => option.label);
}

function fieldLabels(document: FormDocument): Map<string, string> {
  const labels = new Map<string, string>();
  for (const block of parseFormDocument(document).blocks) {
    if (block.kind === "field") labels.set(block.field.key, block.field.label);
    if (block.kind === "field_row") {
      for (const field of block.fields) labels.set(field.key, field.label);
    }
  }
  return labels;
}

function signatureRows(document: FormDocument): string[] {
  return parseFormDocument(document)
    .blocks.filter((block) => block.kind === "signature_row")
    .map((block) => (block as { label: string }).label);
}

/* ============================================================== coaching === */

describe("the Coaching Form matches 01. Coaching Form.docx", () => {
  const document = coachingDocument();

  it("keeps the letterhead the header carries", () => {
    // The source masthead reads "Coaching Form" over "Sun Tan City", in title
    // case — so the version stores it that way rather than shouting it. The
    // upper-case house BRAND still belongs to the chip the other forms print.
    const letterhead = stored(document).blocks[0];
    expect(letterhead).toEqual({
      kind: "letterhead",
      brand: "Sun Tan City",
      title: "Coaching Form",
      variantKey: undefined,
    });
  });

  it("has the source's five section bars, in the source's order", () => {
    expect(sections(document)).toEqual([
      "Employee Information",
      "Type of Coaching",
      "Topic of Coaching",
      "Details of Coaching",
      "Acknowledgement of Coaching",
    ]);
  });

  it("labels the header lines Name, Date, Job Title, Location", () => {
    const labels = fieldLabels(document);
    expect(labels.get("employee_name")).toBe("Name");
    expect(labels.get("form_date")).toBe("Date");
    expect(labels.get("job_title")).toBe("Job Title");
    expect(labels.get("location")).toBe("Location");
  });

  it("offers the three types of coaching the source lists", () => {
    expect(options(document, "coaching_type")).toEqual([
      "Underperformance",
      "Training Plan of Action",
      "Retraining",
    ]);
  });

  it("offers the eleven topics of coaching the source lists, in order", () => {
    expect(options(document, "coaching_topics")).toEqual([
      "Store Tours",
      "Engaging Conversation",
      "Engaging Questions",
      "Relevant Recommendations",
      "Overcoming Objections",
      "Product Basics",
      "Completing the Engagement",
      "Sales Strategies/Upselling",
      "Cleaning Tasks",
      "New Client Documents",
      "Other",
    ]);
  });

  it("keeps the Other write-in and the details area", () => {
    const labels = fieldLabels(document);
    expect(labels.get("other_topic")).toBe("Other");
    expect(labels.get("coaching_details")).toBe("Details of Coaching");
  });

  it("keeps the acknowledgement wording and both signature pairs", () => {
    const acknowledgement = stored(document).blocks.find(
      (block) => block.kind === "acknowledgement",
    );
    expect(acknowledgement).toMatchObject({
      text: "I confirm that my supervisor and I have discussed this training and plan for improvement.",
    });
    expect(signatureRows(document)).toEqual(["Employee Signature", "Supervisor Signature"]);
  });

  it("no longer carries the topics the superseded capture had", () => {
    /*
     * THE REPLACEMENT, ASSERTED FROM THE OTHER SIDE. The point of this batch was
     * that the OLD Coaching Form stops being the active one; a test that only
     * checked the new topics were present would still pass if both lists were.
     */
    const stale = ["Selling Memberships", "Lotion Basics", "Closing the Sale", "Salon Tours"];
    for (const label of stale) {
      expect(options(document, "coaching_topics"), label).not.toContain(label);
    }
    expect(options(document, "coaching_type")).not.toContain("Under Performance");
    expect(options(document, "coaching_type")).not.toContain("Re-Training");
    expect(sections(document)).not.toContain("Acknowledgement of Training");
  });

  it("is published as revision 2, so a database holding revision 1 moves on", () => {
    const seed = TEMPLATE_SEEDS.find((entry) => entry.key === "coaching");
    expect(seed?.revision).toBe(2);
  });

  it("moves a revision only where the document was re-issued", () => {
    /*
     * A REVISION NUMBER IS THE ONLY WAY A CHANGE IN THIS FILE REACHES A RUNNING
     * DATABASE, so it is also the only way an UNINTENDED change reaches one.
     * The list is the whole set of forms that have been re-issued since the
     * library was seeded, and every one of them names why:
     *
     *   coaching        published from the authoritative source document.
     *   dpoa            the observation and the Action Plan ask for their
     *   policy-review   drafted shapes — see `narrative-draft`.
     */
    const reissued = new Set(["coaching", "dpoa", "policy-review"]);
    for (const seed of TEMPLATE_SEEDS) {
      expect(seed.revision, seed.key).toBe(reissued.has(seed.key) ? 2 : 1);
    }
  });
});

/* ==================================================== first round — round 1 === */

describe("the First Round Management Interview matches its source", () => {
  const document = firstRoundManagementInterviewDocument();

  it("has the source's sections, in the source's order", () => {
    expect(sections(document)).toEqual([
      "Applicant Information",
      "Qualities to Observe Throughout Interview",
      "Intro & Motivation",
      "Leadership & Team Management",
      "Sales & Client Service",
      "Operational Excellence",
      "Role Play Scenario",
      "Required Information for the Applicant",
      "Qualities to Observe Throughout Interview & Walkthrough",
      "Store Walkthrough & Job Shadow",
    ]);
  });

  it("lists the five qualities to observe during the interview", () => {
    expect(options(document, "qualities_observed")).toEqual([
      "Leadership ability",
      "Confidence and professionalism",
      "Sales drive and client service focus",
      "Strong work ethic and flexibility",
      "Management experience",
    ]);
  });

  it("lists the six qualities to observe during the walkthrough", () => {
    expect(options(document, "walkthrough_qualities_observed")).toEqual([
      "Strategic leadership ability",
      "Coaching & development skills",
      "Operational & compliance knowledge",
      "Sales & revenue focus",
      "Client service leadership",
      "Cultural alignment",
    ]);
  });

  it("asks every question the source asks, in order", () => {
    expect(paragraphs(document)).toEqual([
      "How did your professional journey lead you here, and where do you see it going next?",
      "Can you walk me through your resume and highlight your most recent roles?",
      "Can you share one or two accomplishments you’re most proud of in your career so far?",
      "Confirm Pay/Salary expectations & schedule availability:",
      "Describe a time you successfully built and motivated a team. What specific actions did you take?",
      "Tell me about a time when you had to have a difficult conversation with an employee about performance or behavior. How did you prepare, and what steps did you take to ensure it was constructive?",
      "Give me an example of when you took initiative on something important. How did you balance moving forward independently with keeping leadership informed?",
      "Everyone responds differently to leadership styles. What type of communication and guidance do you find most effective from a manager?",
      "How do you drive sales performance while maintaining excellent client service?",
      "What were your sales targets in your last position? How consistently did you meet or exceed them?",
      "Tell me about a time you turned an unhappy client into a satisfied one.",
      "What systems or processes have you used to manage staffing, scheduling, and labor costs?",
      "This role involves hands-on work like cleaning beds and doing laundry. How do you lead by example in these tasks?",
      "How do you ensure your team is consistently trained to meet both performance expectations and company compliance standards?",
      "A client approaches the counter upset because the tanning bed they reserved is unavailable due to a mechanical issue. They are raising their voice and demanding a refund, while other clients are in the salon. Show how you would handle the client in the moment and explain the steps you would take afterward to address the root cause.",
      "Why should we select you for this position?",
      "1. Job Description and Job Requirements and Duties: Have printed to review.",
      "2. Pay Structure: Explain the pay structure and the earning potential with bonuses. Let the applicant know that bonuses depend on reaching certain levels of sales performance.",
      "3. Review the Dress Code with the applicant.",
      "4. Core Values Speech: While reviewing the Core Values Speech with the candidate, ask for examples (personally or professionally) that they have demonstrated each of the 4 Core Values.",
      "5. Questions: Give the applicant a chance to ask any questions. Ask the applicant if they understand the job requirements, if they can perform the job duties required and if they see themselves able to embody our Core Values.",
      "6. Notification: Notify the applicant that we will contact them if we choose to offer them the position and provide them with a timeline of hiring decisions to be made.",
    ]);
  });

  it("keeps the three instructions the source addresses to the interviewer", () => {
    expect(notes(document)).toEqual([
      "Please note :- Why did you leave your last position (or why are you considering leaving your current one) and What are you hoping to find in your next role that you haven’t had before?",
      "Explain each section thoroughly and allow the applicant to ask questions.",
      "If interview goes well, proceed to next step and give applicant a walkthrough of the salon. If you wish to pass on this applicant, stop here.",
      "Observe candidate during a guided walkthrough/job shadow in an operating salon. Evaluate: cleanliness, safety, compliance, staff interaction, and sales focus.",
    ]);
  });

  it("keeps both columns of the walkthrough observation table", () => {
    const areas = [
      "Cleanliness & organization",
      "Equipment maintenance & safety",
      "Client service interactions",
      "Staff engagement & leadership presence",
      "Sales focus & promotions",
    ];
    // The ✔ / X column.
    expect(options(document, "walkthrough_observed")).toEqual(areas);
    // The Key Notes column, one writing area per row.
    const labels = fieldLabels(document);
    expect([
      labels.get("walkthrough_cleanliness"),
      labels.get("walkthrough_equipment_safety"),
      labels.get("walkthrough_client_service"),
      labels.get("walkthrough_staff_engagement"),
      labels.get("walkthrough_sales_focus"),
    ]).toEqual(areas);
  });

  it("closes on the source's recommendation and CareerPlug lines", () => {
    expect(options(document, "final_recommendation")).toEqual([
      "Proceed to 2nd Round IV",
      "No Hire",
    ]);
    expect(options(document, "update_in_careerplug")).toEqual(["Yes"]);
  });
});

/* =================================================== second round — round 2 === */

describe("the Second Round Management Interview matches its source", () => {
  const document = secondRoundManagementInterviewDocument();

  it("has the source's sections, in the source's order", () => {
    expect(sections(document)).toEqual([
      "Applicant Information",
      "Intro and Overview",
      "Leadership & Strategic Thinking",
      "Operational Management & Compliance",
      "Role Play Scenarios",
      "Training & Development",
    ]);
  });

  it("asks every question the source asks, in order", () => {
    expect(paragraphs(document)).toEqual([
      "After going through the interview process so far, how would you describe what this job is really about?",
      "Based on what you know now, what skills or qualities do you think will matter most in this role?",
      "Confirm Salary Expectations and Availability:",
      "Describe your approach to setting and communicating performance goals for your team.",
      "How do you identify and develop future leaders within your salon team?",
      "How do you ensure all team members follow company policies, procedures, and safety guidelines?",
      "If you were given direction as a Salon Director to reduce expenses, what would be the first three areas you would focus on, and why?",
      "Tell me about a time you used performance results or key metrics to adjust your approach and improve outcomes.",
      "Scenario 1: Let’s pretend that during your walkthrough in the salon, a staff member fails to greet a client promptly. Demonstrate how you would address this in real-time.",
      "Scenario 2: Customer visits have dropped 20% over the past month and lotions and memberships sales are at their lowest in six months. One long-time team member is resistant to promoting add-ons, saying, “Customers don’t want to be pushed.” What are your next steps?",
      "How would you create a 30–60–90 day training plan for a new Assistant Salon Director or Tanning Consultant?",
      "How do you follow up to ensure training is being applied consistently?",
    ]);
  });

  it("does not reproduce the answers left in the source file", () => {
    /*
     * The supplied .docx is a copy somebody had already interviewed with. Three
     * Notes lines carry that candidate's answers, and printing them onto every
     * future applicant's form would be a real defect — so this asserts they are
     * absent rather than trusting that nobody transcribed them.
     */
    const everything = JSON.stringify(document);
    for (const leftover of [
      "Can start anytime",
      "bonused off of shrink",
      "Greet myself, when done handling customer",
      "loyality",
    ]) {
      expect(everything, leftover).not.toContain(leftover);
    }
  });

  it("closes on Hire / No Hire and the CareerPlug line", () => {
    expect(options(document, "final_recommendation")).toEqual(["Hire", "No Hire"]);
    expect(options(document, "update_in_careerplug")).toEqual(["Yes"]);
  });
});

/* ====================================================== tanning consultant === */

describe("the Tanning Consultant Interview matches its source", () => {
  const document = tanningConsultantInterviewDocument();

  it("has the source's sections, in the source's order", () => {
    expect(sections(document)).toEqual([
      "Applicant Information",
      "Qualities to Observe Throughout Interview",
      "Interview Questions",
      "Closing",
    ]);
  });

  it("lists the four qualities to observe", () => {
    expect(options(document, "qualities_observed")).toEqual([
      "Outgoing",
      "Competitive",
      "Likeable",
      "Hard Working",
    ]);
  });

  it("asks all twelve numbered questions, numbered as the source numbers them", () => {
    expect(paragraphs(document)).toEqual([
      "1. Tell me about yourself and why you’re interested in working at Sun Tan City.",
      "2. Can you walk me through your resume and highlight your most recent roles?",
      "3. Describe your availability and any scheduling restrictions.",
      "4. Describe a time you delivered excellent customer service and what made it stand out.",
      "5. Think back to a busy day when you were helping several customers at once. How did you keep things running smoothly and make sure everyone felt taken care of?",
      "6. This role includes recommending products and services to clients. How comfortable are you with sales, and what’s your approach?",
      "7. Give me an example of a time you were accountable for your results—what was the situation and outcome?",
      "8. Our company has five core values. Id like to hear about a time in your past experiences--work, school, or personal where youve shown one of these in action.",
      "9. Give me an example of a time when you and a teammate disagreed on how to get something done. How did you handle it, and what was the outcome?",
      "10. Give me an example of when you faced a challenge without your manager immediately available. How did you handle it, and what was the outcome?",
      "11. What skills or experiences make you confident you’ll succeed in this role?",
      "12. This position requires key functions such as standing for extended periods, lifting up to 25 lbs., operating a computer, and overseeing daily salon operations. Are you able to perform these essential functions, with or without reasonable accommodation?",
    ]);
  });

  it("prints the five core values in the source's words", () => {
    const reference = parseFormDocument(document).blocks.find(
      (block) => block.kind === "reference",
    );
    expect(reference).toMatchObject({
      label: "Sun Tan City Core Values",
      body: [
        "Nothing’s Impossible – We approach challenges with creativity and determination instead of excuses.",
        "Work Hard, Have Fun – We bring energy, positivity, and joy to doing our best work.",
        "We Speak Up – We share ideas, concerns, and feedback openly and respectfully.",
        "Own the Outcome – We take responsibility for results, not just tasks.",
        "Win Together – We succeed as a team, celebrating collective achievements over individual credit.",
      ],
    });
  });

  it("keeps the two closing checks", () => {
    expect(options(document, "closing_checklist")).toEqual([
      "Reviewed job duties, cleaning requirements, and sales expectations",
      "Reviewed pay structure and bonus potential",
    ]);
  });

  it("closes on Hire / No Hire and the CareerPlug line", () => {
    expect(options(document, "final_recommendation")).toEqual(["Hire", "No Hire"]);
    expect(options(document, "update_in_careerplug")).toEqual(["Yes"]);
  });
});

/* ======================================================= prescreen / phone === */

describe("the Prescreen / Phone Interview matches its source", () => {
  const document = prescreenPhoneInterviewDocument();

  it("has the source's three sections", () => {
    expect(sections(document)).toEqual([
      "Applicant Information",
      "Questions",
      "Prescreening Assessment",
    ]);
  });

  it("asks the age question as a yes or no", () => {
    const group = parseFormDocument(document).blocks.find(
      (block) => block.kind === "checkbox_group" && block.key === "at_least_18",
    );
    expect(group).toMatchObject({ label: "Are you at least 18 years old?" });
    expect(options(document, "at_least_18")).toEqual(["Yes", "No"]);
  });

  it("keeps the four written questions in the source's words and order", () => {
    const labels = fieldLabels(document);
    expect(labels.get("why_interested")).toBe(
      "Why are you interested in working for Sun Tan City?",
    );
    expect(labels.get("uniform_services")).toBe(
      "Are you willing to use our services as part of your Sun Tan City uniform? (Must agree to UV, Sunless and Spa usage to proceed with employment)",
    );
    expect(labels.get("previous_experience")).toBe("Previous Work Experience");
    expect(labels.get("availability")).toBe("Availability");
    expect(labels.get("job_title")).toBe("Position Applied For");
  });

  it("keeps the three prescreening assessment instructions", () => {
    expect(notes(document)).toEqual([
      "If the response to these questions best fits our business culture, goals, and if the person sounds friendly, you can then schedule an in-person interview with them or encourage them to apply at a neighboring salon if you do not have open positions.",
      'If you do not receive quality answers to these questions (as per our pre-screening process) or the person does not seem “qualified”, you can tell them "Thank you for your interest, I will keep you in mind for future positions we may have available."',
      "Attach this completed form to the online application email and file in your “Applications” folder.",
    ]);
  });

  it("closes on the interviewer's signature, and on nothing else", () => {
    expect(signatureRows(document)).toEqual(["Interviewer Signature"]);
    // The source has no recommendation and no CareerPlug line, so neither is
    // here — copying its three siblings would be inventing a step.
    const everything = JSON.stringify(document);
    expect(everything).not.toContain("Careerplug");
    expect(everything).not.toContain("Final Recommendation");
  });
});

/* ============================================================== the library === */

describe("the Hiring & Interview category", () => {
  const hiring = TEMPLATE_SEEDS.filter((seed) => seed.category === "hiring");

  it("contains exactly the four supplied forms, and nothing invented", () => {
    expect(hiring.map((seed) => seed.name)).toEqual([
      "Prescreen / Phone Interview Form",
      "Tanning Consultant Interview Form",
      "First Round Management Interview Form",
      "Second Round Management Interview Form",
    ]);
  });

  it("renders as its own section of the Forms page, after the HR forms", () => {
    const grouped = groupTemplatesByCategory(TEMPLATE_SEEDS);
    expect(grouped.map((group) => group.label)).toEqual([
      "HR & Performance Forms",
      "Hiring & Interview Forms",
    ]);
    // Ten HR forms now: the nine read from paper sources plus the
    // framework-defined Follow-Up Coaching Form.
    expect(grouped[0].templates).toHaveLength(10);
    expect(grouped[1].templates).toHaveLength(4);
  });

  it("leaves Coaching where it was", () => {
    const coaching = TEMPLATE_SEEDS.filter((seed) => seed.key === "coaching");
    expect(coaching).toHaveLength(1);
    expect(coaching[0].category).toBe("hr_performance");
  });

  it("gates every hiring form on its own permission", () => {
    for (const seed of hiring) {
      expect(seed.requiredPermission, seed.key).toBe("create_hiring_form");
      expect(seed.layoutFamily, seed.key).toBe("interview");
    }
  });

  it("never lets Ask Sunny draft an applicant's answers", () => {
    /*
     * THE ONE RULE THESE FOUR FORMS EXIST UNDER. An interview record is what a
     * candidate said; a drafted one is what a model guessed they said. Nothing
     * on these forms is `ai`, and this asserts it across every field, checkbox
     * group and numbered list rather than by reading the builders.
     */
    for (const seed of hiring) {
      const map = responsibilityMap(stored(seed.document), null);
      for (const [key, responsibility] of map) {
        expect(responsibility, `${seed.key}:${key}`).not.toBe("ai");
      }
    }
  });
});

describe("the library as a whole", () => {
  it("has no duplicate keys, names or display orders", () => {
    const keys = TEMPLATE_SEEDS.map((seed) => seed.key);
    const names = TEMPLATE_SEEDS.map((seed) => seed.name);
    const orders = TEMPLATE_SEEDS.map((seed) => seed.displayOrder);
    expect(new Set(keys).size, "duplicate template key").toBe(keys.length);
    expect(new Set(names).size, "duplicate template name").toBe(names.length);
    expect(new Set(orders).size, "duplicate display order").toBe(orders.length);
  });

  it("puts every template in a category the app knows", () => {
    const known = new Set<string>(FORM_CATEGORIES.map((category) => category.key));
    for (const seed of TEMPLATE_SEEDS) {
      expect(known.has(seed.category), `${seed.key}: ${seed.category}`).toBe(true);
    }
  });

  it("stores every document the reader can read back", () => {
    for (const seed of TEMPLATE_SEEDS) {
      expect(() => parseFormDocument(seed.document), seed.key).not.toThrow();
    }
  });
});
