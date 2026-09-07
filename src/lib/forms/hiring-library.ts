import { BRAND, field, type TemplateSeed } from "./catalog";
import type { FormBlock, FormDocument } from "./document";

/**
 * HIRING & INTERVIEW FORMS — the forms a CANDIDATE is the subject of.
 *
 * Separate from `library.ts` because the two answer to different things. Those
 * nine document an employee: they carry Employee Information, an
 * acknowledgement and two signatures, and Ask Sunny drafts most of what goes in
 * them from a conversation that already happened. These four document an
 * INTERVIEW: they carry Applicant Information, they are written in the room
 * while the candidate is answering, and there is nothing for the assistant to
 * draft — the answers do not exist until the applicant gives them.
 *
 * THAT IS WHY EVERY ANSWER FIELD HERE IS `manager`. It is not an oversight and
 * it is not a stricter setting chosen for safety: `ai` would mean Ask Sunny may
 * write an applicant's interview answers, which is the one thing an interview
 * record must never contain. Only the four header lines the app genuinely knows
 * — who the form is about, the date, the salon — are `system`.
 *
 * FOUR FORMS, FOUR DOCUMENTS, DELIBERATELY NOT ONE TEMPLATE WITH VARIANTS.
 * Round 1 and Round 2 look alike from a distance and are not: Round 1 runs a
 * salon walkthrough and a job shadow and ends in "proceed to 2nd round", Round 2
 * opens with a job preview and ends in "hire". Folding them into one document
 * with a `{{round}}` placeholder would lose every question that differs, which
 * is most of them.
 *
 * ADDING THE NEXT ONE. Write its `…Document()` builder, append its seed to
 * `HIRING_TEMPLATE_SEEDS` with the next `displayOrder`, and stop. The category,
 * the page section it renders under, the permission it needs and the seeding
 * are all read from the seed.
 *
 * ON FIDELITY. Every question, option, instruction and scenario below is
 * transcribed from the supplied Word documents. Three transcription rules were
 * applied consistently, and nothing else was changed:
 *
 *   1  A trailing colon on a heading or a label is Word punctuation before a
 *      rule or a bar — "Applicant Name:" is the label "Applicant Name".
 *   2  The bold "Notes:" line under a question is the answer area, so it is
 *      that question's field and it is called "Notes".
 *   3  Answers left behind in the Round 2 file by whoever last used it are not
 *      part of the blank form and are not reproduced. See that builder.
 *
 * Typos in the source are NOT corrected — see the core-values question in the
 * Tanning Consultant form. Rewriting the business's own words, even obviously
 * accidental ones, is a decision for the business.
 */

/* -------------------------------------------------------------- helpers --- */

/**
 * The Applicant Information block all three interview forms open with.
 *
 * The KEYS are the engine's, the LABELS are the interview's. `employee_name`,
 * `form_date` and `location` are the three keys `createInstance` fills from the
 * record, so an interviewer who has already named the applicant and picked the
 * salon does not type either again. Renaming them to `applicant_name` would
 * read better in the JSON and would leave all three lines blank on the page.
 *
 * `interviewed_by` is `manager` on purpose: the app knows who is signed in, but
 * the person conducting the interview is not always the person driving the
 * screen, and a name filled in automatically is one nobody checks.
 */
function applicantInformation(): FormBlock[] {
  return [
    { kind: "section", label: "Applicant Information" },
    {
      kind: "field_row",
      fields: [
        field("employee_name", "Applicant Name", "system"),
        field("form_date", "Date", "system", "date"),
      ],
    },
    {
      kind: "field_row",
      fields: [
        field("interviewed_by", "Interviewed By", "manager"),
        field("location", "Salon Name", "system"),
      ],
    },
  ];
}

/** A question and the writing space under it, as the documents lay them out. */
function question(key: string, text: string): FormBlock[] {
  return [
    { kind: "paragraph", text },
    { kind: "field", field: field(`${key}_notes`, "Notes", "manager", "long_text") },
  ];
}

/** The two lines every one of these forms closes on. */
function closingRecommendation(proceedLabel: string): FormBlock[] {
  return [
    {
      kind: "checkbox_group",
      key: "final_recommendation",
      label: "Final Recommendation",
      options: [
        { key: "proceed", label: proceedLabel },
        { key: "no_hire", label: "No Hire" },
      ],
      responsibility: "manager",
      columns: 2,
    },
    {
      kind: "checkbox_group",
      key: "update_in_careerplug",
      label: "Update In Careerplug",
      options: [{ key: "yes", label: "Yes" }],
      responsibility: "manager",
      columns: 2,
    },
  ];
}

/* ------------------------------------------------- first round — round 1 --- */

export function firstRoundManagementInterviewDocument(): FormDocument {
  return {
    paper: "letter",
    blocks: [
      { kind: "letterhead", brand: BRAND, title: "Management Interview Form Round 1" },
      ...applicantInformation(),

      { kind: "section", label: "Qualities to Observe Throughout Interview" },
      {
        kind: "checkbox_group",
        key: "qualities_observed",
        options: [
          { key: "leadership_ability", label: "Leadership ability" },
          { key: "confidence_professionalism", label: "Confidence and professionalism" },
          { key: "sales_drive_client_service", label: "Sales drive and client service focus" },
          { key: "work_ethic_flexibility", label: "Strong work ethic and flexibility" },
          { key: "management_experience", label: "Management experience" },
        ],
        responsibility: "manager",
        columns: 2,
      },

      { kind: "section", label: "Intro & Motivation" },
      ...question(
        "journey",
        "How did your professional journey lead you here, and where do you see it going next?",
      ),
      {
        kind: "paragraph",
        text: "Can you walk me through your resume and highlight your most recent roles?",
      },
      {
        kind: "note",
        text: "Please note :- Why did you leave your last position (or why are you considering leaving your current one) and What are you hoping to find in your next role that you haven’t had before?",
      },
      { kind: "field", field: field("resume_notes", "Notes", "manager", "long_text") },
      ...question(
        "accomplishments",
        "Can you share one or two accomplishments you’re most proud of in your career so far?",
      ),
      ...question(
        "pay_and_availability",
        "Confirm Pay/Salary expectations & schedule availability:",
      ),

      { kind: "section", label: "Leadership & Team Management" },
      ...question(
        "built_a_team",
        "Describe a time you successfully built and motivated a team. What specific actions did you take?",
      ),
      ...question(
        "difficult_conversation",
        "Tell me about a time when you had to have a difficult conversation with an employee about performance or behavior. How did you prepare, and what steps did you take to ensure it was constructive?",
      ),
      ...question(
        "took_initiative",
        "Give me an example of when you took initiative on something important. How did you balance moving forward independently with keeping leadership informed?",
      ),
      ...question(
        "leadership_style",
        "Everyone responds differently to leadership styles. What type of communication and guidance do you find most effective from a manager?",
      ),

      { kind: "section", label: "Sales & Client Service" },
      ...question(
        "drive_sales",
        "How do you drive sales performance while maintaining excellent client service?",
      ),
      ...question(
        "sales_targets",
        "What were your sales targets in your last position? How consistently did you meet or exceed them?",
      ),
      ...question(
        "unhappy_client",
        "Tell me about a time you turned an unhappy client into a satisfied one.",
      ),

      { kind: "section", label: "Operational Excellence" },
      ...question(
        "staffing_systems",
        "What systems or processes have you used to manage staffing, scheduling, and labor costs?",
      ),
      ...question(
        "hands_on_work",
        "This role involves hands-on work like cleaning beds and doing laundry. How do you lead by example in these tasks?",
      ),
      ...question(
        "team_training",
        "How do you ensure your team is consistently trained to meet both performance expectations and company compliance standards?",
      ),

      { kind: "section", label: "Role Play Scenario" },
      ...question(
        "role_play",
        "A client approaches the counter upset because the tanning bed they reserved is unavailable due to a mechanical issue. They are raising their voice and demanding a refund, while other clients are in the salon. Show how you would handle the client in the moment and explain the steps you would take afterward to address the root cause.",
      ),
      ...question("why_select_you", "Why should we select you for this position?"),

      { kind: "section", label: "Required Information for the Applicant" },
      {
        kind: "note",
        text: "Explain each section thoroughly and allow the applicant to ask questions.",
      },
      {
        kind: "paragraph",
        text: "1. Job Description and Job Requirements and Duties: Have printed to review.",
      },
      {
        kind: "paragraph",
        text: "2. Pay Structure: Explain the pay structure and the earning potential with bonuses. Let the applicant know that bonuses depend on reaching certain levels of sales performance.",
      },
      { kind: "paragraph", text: "3. Review the Dress Code with the applicant." },
      {
        kind: "paragraph",
        text: "4. Core Values Speech: While reviewing the Core Values Speech with the candidate, ask for examples (personally or professionally) that they have demonstrated each of the 4 Core Values.",
      },
      {
        kind: "paragraph",
        text: "5. Questions: Give the applicant a chance to ask any questions. Ask the applicant if they understand the job requirements, if they can perform the job duties required and if they see themselves able to embody our Core Values.",
      },
      {
        kind: "paragraph",
        text: "6. Notification: Notify the applicant that we will contact them if we choose to offer them the position and provide them with a timeline of hiring decisions to be made.",
      },
      {
        kind: "note",
        text: "If interview goes well, proceed to next step and give applicant a walkthrough of the salon. If you wish to pass on this applicant, stop here.",
      },

      { kind: "section", label: "Qualities to Observe Throughout Interview & Walkthrough" },
      {
        kind: "checkbox_group",
        key: "walkthrough_qualities_observed",
        options: [
          { key: "strategic_leadership", label: "Strategic leadership ability" },
          { key: "coaching_development", label: "Coaching & development skills" },
          { key: "operational_compliance", label: "Operational & compliance knowledge" },
          { key: "sales_revenue_focus", label: "Sales & revenue focus" },
          { key: "client_service_leadership", label: "Client service leadership" },
          { key: "cultural_alignment", label: "Cultural alignment" },
        ],
        responsibility: "manager",
        columns: 2,
      },

      { kind: "section", label: "Store Walkthrough & Job Shadow" },
      {
        kind: "note",
        text: "Observe candidate during a guided walkthrough/job shadow in an operating salon. Evaluate: cleanliness, safety, compliance, staff interaction, and sales focus.",
      },
      /*
       * THE OBSERVATION TABLE, IN THE TWO BLOCKS THE ENGINE HAS.
       *
       * On paper this is a five-row table: Observation Area, Key Notes, and a
       * ✔ / X column. There is no table block — the nine forms that built this
       * engine have none — so it becomes the tick column as one checkbox group
       * over the five areas, and the Key Notes column as five fields named
       * after those same areas. Every string still comes from the document, and
       * an interviewer ticking "Sales focus & promotions" and typing under
       * "Sales focus & promotions" has filled the row.
       */
      {
        kind: "checkbox_group",
        key: "walkthrough_observed",
        label: "✔ / X",
        options: [
          { key: "cleanliness", label: "Cleanliness & organization" },
          { key: "equipment_safety", label: "Equipment maintenance & safety" },
          { key: "client_service", label: "Client service interactions" },
          { key: "staff_engagement", label: "Staff engagement & leadership presence" },
          { key: "sales_focus", label: "Sales focus & promotions" },
        ],
        responsibility: "manager",
        columns: 2,
      },
      {
        kind: "field",
        field: field("walkthrough_cleanliness", "Cleanliness & organization", "manager", "long_text", {
          help: "Key Notes",
        }),
      },
      {
        kind: "field",
        field: field(
          "walkthrough_equipment_safety",
          "Equipment maintenance & safety",
          "manager",
          "long_text",
          { help: "Key Notes" },
        ),
      },
      {
        kind: "field",
        field: field(
          "walkthrough_client_service",
          "Client service interactions",
          "manager",
          "long_text",
          { help: "Key Notes" },
        ),
      },
      {
        kind: "field",
        field: field(
          "walkthrough_staff_engagement",
          "Staff engagement & leadership presence",
          "manager",
          "long_text",
          { help: "Key Notes" },
        ),
      },
      {
        kind: "field",
        field: field(
          "walkthrough_sales_focus",
          "Sales focus & promotions",
          "manager",
          "long_text",
          { help: "Key Notes" },
        ),
      },

      ...closingRecommendation("Proceed to 2nd Round IV"),
    ],
  };
}

/* ------------------------------------------------ second round — round 2 --- */

/**
 * The second-round interview and job preview.
 *
 * WHAT IS DELIBERATELY MISSING. The supplied file is a copy somebody had
 * already interviewed with: three of its Notes lines carry that candidate's
 * answers — "Can start anytime.", the shrink/truck/sales/loyalty metrics note,
 * and a real answer to the greeting scenario. They are one person's interview,
 * not part of the blank form, and reproducing them would print another
 * applicant's answers onto every future candidate's page. The questions they
 * sat under are all here; only the answers are not.
 */
export function secondRoundManagementInterviewDocument(): FormDocument {
  return {
    paper: "letter",
    blocks: [
      {
        kind: "letterhead",
        brand: BRAND,
        title: "Second Round Management Interview and Job Preview",
      },
      ...applicantInformation(),

      { kind: "section", label: "Intro and Overview" },
      ...question(
        "what_the_job_is_about",
        "After going through the interview process so far, how would you describe what this job is really about?",
      ),
      ...question(
        "skills_that_matter",
        "Based on what you know now, what skills or qualities do you think will matter most in this role?",
      ),
      ...question(
        "salary_and_availability",
        "Confirm Salary Expectations and Availability:",
      ),

      { kind: "section", label: "Leadership & Strategic Thinking" },
      ...question(
        "performance_goals",
        "Describe your approach to setting and communicating performance goals for your team.",
      ),
      ...question(
        "future_leaders",
        "How do you identify and develop future leaders within your salon team?",
      ),

      { kind: "section", label: "Operational Management & Compliance" },
      ...question(
        "policy_compliance",
        "How do you ensure all team members follow company policies, procedures, and safety guidelines?",
      ),
      ...question(
        "reduce_expenses",
        "If you were given direction as a Salon Director to reduce expenses, what would be the first three areas you would focus on, and why?",
      ),
      ...question(
        "metrics_adjustment",
        "Tell me about a time you used performance results or key metrics to adjust your approach and improve outcomes.",
      ),

      { kind: "section", label: "Role Play Scenarios" },
      ...question(
        "scenario_one",
        "Scenario 1: Let’s pretend that during your walkthrough in the salon, a staff member fails to greet a client promptly. Demonstrate how you would address this in real-time.",
      ),
      ...question(
        "scenario_two",
        "Scenario 2: Customer visits have dropped 20% over the past month and lotions and memberships sales are at their lowest in six months. One long-time team member is resistant to promoting add-ons, saying, “Customers don’t want to be pushed.” What are your next steps?",
      ),

      { kind: "section", label: "Training & Development" },
      ...question(
        "training_plan",
        "How would you create a 30–60–90 day training plan for a new Assistant Salon Director or Tanning Consultant?",
      ),
      ...question(
        "training_follow_up",
        "How do you follow up to ensure training is being applied consistently?",
      ),

      ...closingRecommendation("Hire"),
    ],
  };
}

/* ------------------------------------------------------ tanning consultant --- */

export function tanningConsultantInterviewDocument(): FormDocument {
  return {
    paper: "letter",
    blocks: [
      { kind: "letterhead", brand: BRAND, title: "Tanning Consultant Interview Form" },
      ...applicantInformation(),

      { kind: "section", label: "Qualities to Observe Throughout Interview" },
      {
        kind: "checkbox_group",
        key: "qualities_observed",
        options: [
          { key: "outgoing", label: "Outgoing" },
          { key: "competitive", label: "Competitive" },
          { key: "likeable", label: "Likeable" },
          { key: "hard_working", label: "Hard Working" },
        ],
        responsibility: "manager",
        columns: 2,
      },

      { kind: "section", label: "Interview Questions" },
      ...question(
        "about_yourself",
        "1. Tell me about yourself and why you’re interested in working at Sun Tan City.",
      ),
      ...question(
        "resume",
        "2. Can you walk me through your resume and highlight your most recent roles?",
      ),
      ...question(
        "availability",
        "3. Describe your availability and any scheduling restrictions.",
      ),
      ...question(
        "customer_service",
        "4. Describe a time you delivered excellent customer service and what made it stand out.",
      ),
      ...question(
        "busy_day",
        "5. Think back to a busy day when you were helping several customers at once. How did you keep things running smoothly and make sure everyone felt taken care of?",
      ),
      ...question(
        "sales_approach",
        "6. This role includes recommending products and services to clients. How comfortable are you with sales, and what’s your approach?",
      ),
      ...question(
        "accountability",
        "7. Give me an example of a time you were accountable for your results—what was the situation and outcome?",
      ),
      /*
       * QUESTION 8 IS TRANSCRIBED AS WRITTEN, apostrophes and all. "Id like",
       * "youve" and the double hyphen are in the source document. They are the
       * business's own words on a form the business issues, and correcting them
       * here would put a quiet edit into a hiring record; whoever owns the form
       * can fix the Word file and this follows.
       */
      {
        kind: "paragraph",
        text: "8. Our company has five core values. Id like to hear about a time in your past experiences--work, school, or personal where youve shown one of these in action.",
      },
      {
        kind: "reference",
        label: "Sun Tan City Core Values",
        body: [
          "Nothing’s Impossible – We approach challenges with creativity and determination instead of excuses.",
          "Work Hard, Have Fun – We bring energy, positivity, and joy to doing our best work.",
          "We Speak Up – We share ideas, concerns, and feedback openly and respectfully.",
          "Own the Outcome – We take responsibility for results, not just tasks.",
          "Win Together – We succeed as a team, celebrating collective achievements over individual credit.",
        ],
      },
      { kind: "field", field: field("core_values_notes", "Notes", "manager", "long_text") },
      ...question(
        "teammate_disagreement",
        "9. Give me an example of a time when you and a teammate disagreed on how to get something done. How did you handle it, and what was the outcome?",
      ),
      ...question(
        "manager_unavailable",
        "10. Give me an example of when you faced a challenge without your manager immediately available. How did you handle it, and what was the outcome?",
      ),
      ...question(
        "skills_for_the_role",
        "11. What skills or experiences make you confident you’ll succeed in this role?",
      ),
      ...question(
        "essential_functions",
        "12. This position requires key functions such as standing for extended periods, lifting up to 25 lbs., operating a computer, and overseeing daily salon operations. Are you able to perform these essential functions, with or without reasonable accommodation?",
      ),

      { kind: "section", label: "Closing" },
      {
        kind: "checkbox_group",
        key: "closing_checklist",
        options: [
          {
            key: "reviewed_duties",
            label: "Reviewed job duties, cleaning requirements, and sales expectations",
          },
          { key: "reviewed_pay", label: "Reviewed pay structure and bonus potential" },
        ],
        responsibility: "manager",
        columns: 2,
      },

      ...closingRecommendation("Hire"),
    ],
  };
}

/* ------------------------------------------------ prescreen / phone screen --- */

/**
 * The prescreening call.
 *
 * The only one of the four that is not an interview: it is the call that
 * decides whether there will be one, and it closes on the INTERVIEWER's
 * signature rather than on a hire recommendation. It carries no Final
 * Recommendation and no CareerPlug line because the source has neither, and
 * adding them to match its three siblings would be inventing a step.
 *
 * "Position Applied For" takes the `job_title` key so it is filled from the
 * record like the other header lines.
 */
export function prescreenPhoneInterviewDocument(): FormDocument {
  return {
    paper: "letter",
    blocks: [
      { kind: "letterhead", brand: BRAND, title: "Prescreening / Phone Interview" },

      { kind: "section", label: "Applicant Information" },
      {
        kind: "field_row",
        fields: [
          field("employee_name", "Applicant Name", "system"),
          field("form_date", "Date", "system", "date"),
        ],
      },
      { kind: "field", field: field("job_title", "Position Applied For", "system") },

      { kind: "section", label: "Questions" },
      {
        kind: "checkbox_group",
        key: "at_least_18",
        label: "Are you at least 18 years old?",
        options: [
          { key: "yes", label: "Yes" },
          { key: "no", label: "No" },
        ],
        responsibility: "manager",
        columns: 2,
      },
      {
        kind: "field",
        field: field(
          "why_interested",
          "Why are you interested in working for Sun Tan City?",
          "manager",
          "long_text",
        ),
      },
      {
        kind: "field",
        field: field(
          "uniform_services",
          "Are you willing to use our services as part of your Sun Tan City uniform? (Must agree to UV, Sunless and Spa usage to proceed with employment)",
          "manager",
          "long_text",
        ),
      },
      {
        kind: "field",
        field: field("previous_experience", "Previous Work Experience", "manager", "long_text"),
      },
      { kind: "field", field: field("availability", "Availability", "manager", "long_text") },

      { kind: "section", label: "Prescreening Assessment" },
      {
        kind: "note",
        text: "If the response to these questions best fits our business culture, goals, and if the person sounds friendly, you can then schedule an in-person interview with them or encourage them to apply at a neighboring salon if you do not have open positions.",
      },
      {
        kind: "note",
        text: "If you do not receive quality answers to these questions (as per our pre-screening process) or the person does not seem “qualified”, you can tell them \"Thank you for your interest, I will keep you in mind for future positions we may have available.\"",
      },
      {
        kind: "note",
        text: "Attach this completed form to the online application email and file in your “Applications” folder.",
      },

      { kind: "signature_row", label: "Interviewer Signature", dateLabel: "Date" },
    ],
  };
}

/* ---------------------------------------------------------------- seeds --- */

/**
 * The Hiring & Interview library.
 *
 * `displayOrder` continues from the nine HR forms rather than restarting, so
 * the single `order by display_order` the repository does still produces a
 * stable page. The next hiring form is 14.
 */
export const HIRING_TEMPLATE_SEEDS: TemplateSeed[] = [
  {
    key: "prescreen-phone-interview",
    name: "Prescreen / Phone Interview Form",
    shortName: "Prescreen",
    description:
      "The prescreening call, before anyone is booked for an interview. Age, interest, uniform agreement, experience and availability, signed off by the interviewer.",
    category: "hiring",
    layoutFamily: "interview",
    requiredPermission: "create_hiring_form",
    displayOrder: 10,
    document: prescreenPhoneInterviewDocument(),
    variants: [],
    revision: 1,
    revisionNote: "Published from the 04. Prescreen Form - Phone Interview source document.",
    bundledPdfName: "Prescreen Form - Phone Interview.pdf",
  },
  {
    key: "tanning-consultant-interview",
    name: "Tanning Consultant Interview Form",
    shortName: "TC Interview",
    description:
      "The in-salon interview for a Tanning Consultant. Twelve questions through service, sales, accountability, the core values and the essential job functions.",
    category: "hiring",
    layoutFamily: "interview",
    requiredPermission: "create_hiring_form",
    displayOrder: 11,
    document: tanningConsultantInterviewDocument(),
    variants: [],
    revision: 1,
    revisionNote: "Published from the 03. Tanning Consultant Interview Form source document.",
    bundledPdfName: "Tanning Consultant Interview Form.pdf",
  },
  {
    key: "management-interview-round-1",
    name: "First Round Management Interview Form",
    shortName: "Mgmt Round 1",
    description:
      "The first management interview, through leadership, sales, operations and a role play, then the salon walkthrough and job shadow.",
    category: "hiring",
    layoutFamily: "interview",
    requiredPermission: "create_hiring_form",
    displayOrder: 12,
    document: firstRoundManagementInterviewDocument(),
    variants: [],
    revision: 1,
    revisionNote: "Published from the 02. First Round Managment Interview Form source document.",
    bundledPdfName: "First Round Management Interview Form.pdf",
  },
  {
    key: "management-interview-round-2",
    name: "Second Round Management Interview Form",
    shortName: "Mgmt Round 2",
    description:
      "The second management interview and job preview. Strategic thinking, compliance, two role plays and the 30-60-90 day training plan.",
    category: "hiring",
    layoutFamily: "interview",
    requiredPermission: "create_hiring_form",
    displayOrder: 13,
    document: secondRoundManagementInterviewDocument(),
    variants: [],
    revision: 1,
    revisionNote: "Published from the 03. Second Round Managment Interview Form source document.",
    bundledPdfName: "Second Round Management Interview Form.pdf",
  },
];
