import { BRAND, field, type TemplateSeed } from "./catalog";
import type {
  FormBlock,
  FormDocument,
  FormVariant,
} from "./document";
import { HIRING_TEMPLATE_SEEDS } from "./hiring-library";

/**
 * THE TEMPLATE LIBRARY — nine forms, four layouts.
 *
 * Built from the nine reference captures, and grouped the way those captures
 * actually group rather than one template per file:
 *
 *   coaching    Coaching Form
 *   corrective  Corrective Action Form, Policy Review
 *   epp         SDIT EPP, TSD EPP, ASD-SDIT Performance EPP, FTTC Performance EPP
 *   dmit_epp    DMIT EPP — TSD Review, DMIT EPP — DMIT Review
 *
 * The EPP four are the same three-page document with a different title and a
 * different pairing of reviewer and subject — pixel-diffed at 0.06%–0.07% on
 * pages 2 and 3. The two DMIT reviews are ONE six-page document read two ways;
 * their captures differ by 0.96% on page 1 and 0.19% on page 3 and by nothing
 * anywhere else. So they are variants, not templates, and the misspelled
 * filenames (`REVIVIEW`, `TSd`) name no additional form.
 *
 * RESPONSIBILITIES ARE COPIED FROM THE REFERENCES, FIELD BY FIELD, not inferred
 * from what a field is called. The DMIT EPP's self-assessment is marked FILLED
 * BY HAND on the capture and is `manual` here; the SDIT EPP's "Assistant Salon
 * Director Thoughts" carries an AI FILLS chip and is `ai`. Two questions that
 * read almost identically, two different answers, because the business decided
 * so and not because a rule was inferred.
 */

/* ------------------------------------------------------------- helpers --- */

/**
 * `BRAND` and `field` come from `catalog.ts` so the hiring library can use the
 * same two without importing this file — which imports it. See that module.
 */

/** The header block every one of the nine HR forms opens with. */
function employeeInformation(): FormBlock[] {
  return [
    { kind: "section", label: "Employee Information" },
    {
      kind: "field_row",
      fields: [
        field("employee_name", "Employee Name", "system"),
        field("form_date", "Date", "system", "date"),
      ],
    },
    {
      kind: "field_row",
      fields: [
        field("job_title", "Job Title", "system"),
        field("location", "Location", "system"),
      ],
    },
  ];
}

/**
 * The acknowledgement and its two signature pairs.
 *
 * `signature` fields have no key by design — see `responsibility.ts`. Nothing
 * can write into them because there is nothing to write into.
 */
function acknowledgement(text: string): FormBlock[] {
  return [
    { kind: "section", label: "Acknowledgement" },
    { kind: "acknowledgement", text },
    { kind: "signature_row", label: "Employee Signature", dateLabel: "Date" },
    { kind: "signature_row", label: "Supervisor Signature", dateLabel: "Date" },
  ];
}

/* ------------------------------------------------------------ coaching --- */

/**
 * THE COACHING FORM, as the business now issues it.
 *
 * Reproduced block for block from `01. Coaching Form.docx` — the authoritative
 * copy — which differs from the capture the library was first built against in
 * three ways that matter and in nothing else:
 *
 *   the Employee Information line reads "Name", not "Employee Name";
 *   Type of Coaching is Underperformance / Training Plan of Action /
 *   Retraining, spelled as one word where the old capture hyphenated;
 *   Topic of Coaching is ELEVEN topics about the salon floor — tours,
 *   conversation, questions, recommendations, objections, product, the
 *   engagement, upselling, cleaning, new client documents, other — where the
 *   old ten were about memberships and lotion.
 *
 * IT IS THE SAME TEMPLATE, NOT A SECOND ONE. Same key, same route, same
 * permission, same field keys for everything the header carries, so a link to
 * `/forms/templates/coaching` still lands here and a stored `employee_name`
 * still means what it meant. The document becomes revision 2 of `coaching`;
 * revision 1 stays published-then-archived in `form_template_versions`, and
 * every form already filled from it still renders against it. Nothing about a
 * signed coaching record changes because the blank form did.
 *
 * The topic OPTION keys are new, because the topics are new — `store_tours` is
 * not a rename of `salon_tours`, it is a different list. That is safe for
 * history precisely because a finalized form is read against the version it was
 * signed on: the old keys still exist on the old version, which still exists.
 *
 * The employee-information block is written out here rather than taken from
 * `employeeInformation()`: this form says "Name" and the other eight say
 * "Employee Name", and quietly changing all nine to match one source document
 * would be editing eight forms nobody asked about.
 */
export function coachingDocument(): FormDocument {
  return {
    paper: "letter",
    /*
     * THE WORD SOURCE'S OWN LOOK, CARRIED BY THE VERSION.
     *
     * The document the business issues is not laid out like the rest of the
     * library: centred headings over hairlines rather than black bars, the
     * form's name and the brand stacked and centred, the Sun Tan City mark in
     * the top right, and a 1in page. Those are facts about THIS version of THIS
     * document, so they are stored with it — the renderer reads them
     * generically and knows nothing about coaching. Every other template omits
     * `style` and keeps the black bars it was measured with.
     *
     * The logo is named, not embedded: `sun-tan-city` resolves through the
     * approved asset registry to the exact bitmap lifted out of the Word file.
     * See `lib/forms/assets`.
     */
    style: {
      headingStyle: "rule",
      letterhead: "centered",
      margins: "wide",
      signatureLayout: "ruled",
      logo: { assetKey: "sun-tan-city", placement: "top-right", widthPt: 76 },
    },
    blocks: [
      // The subtitle is set in title case in the source, so it is stored that
      // way. The upper-case `BRAND` belongs to the chip the other forms use.
      { kind: "letterhead", brand: "Sun Tan City", title: "Coaching Form" },

      { kind: "section", label: "Employee Information" },
      {
        kind: "field_row",
        fields: [
          field("employee_name", "Name", "system"),
          field("form_date", "Date", "system", "date"),
        ],
      },
      {
        kind: "field_row",
        fields: [
          field("job_title", "Job Title", "system"),
          field("location", "Location", "system"),
        ],
      },

      { kind: "section", label: "Type of Coaching" },
      {
        kind: "checkbox_group",
        key: "coaching_type",
        options: [
          { key: "underperformance", label: "Underperformance" },
          { key: "training_plan_of_action", label: "Training Plan of Action" },
          { key: "retraining", label: "Retraining" },
        ],
        responsibility: "ai",
        columns: 3,
      },

      { kind: "section", label: "Topic of Coaching" },
      {
        kind: "checkbox_group",
        key: "coaching_topics",
        options: [
          { key: "store_tours", label: "Store Tours" },
          { key: "engaging_conversation", label: "Engaging Conversation" },
          { key: "engaging_questions", label: "Engaging Questions" },
          { key: "relevant_recommendations", label: "Relevant Recommendations" },
          { key: "overcoming_objections", label: "Overcoming Objections" },
          { key: "product_basics", label: "Product Basics" },
          { key: "completing_the_engagement", label: "Completing the Engagement" },
          { key: "sales_strategies_upselling", label: "Sales Strategies/Upselling" },
          { key: "cleaning_tasks", label: "Cleaning Tasks" },
          { key: "new_client_documents", label: "New Client Documents" },
          { key: "other", label: "Other" },
        ],
        responsibility: "ai",
        columns: 3,
      },
      {
        kind: "field",
        field: field("other_topic", "Other", "ai", "text", {
          help: "Only when the Other box is ticked. Left empty otherwise.",
        }),
      },

      { kind: "section", label: "Details of Coaching" },
      {
        kind: "field",
        field: field("coaching_details", "Details of Coaching", "ai", "long_text", {
          help:
            'Written as "Observed:" — what happened — then "Expectation:" — what the ' +
            "manager told the employee to do differently. One field, two labelled sections.",
          /*
           * The one narrative field on this form. A record that names the event
           * but not the expectation cannot show that anything was communicated,
           * which is the part a coaching form exists to evidence. See
           * `lib/forms/narrative-draft` — including why the Expectation section
           * disappears rather than being invented when the manager gave none.
           */
          narrative: "observed_expectation",
        }),
      },

      { kind: "section", label: "Acknowledgement of Coaching" },
      {
        kind: "acknowledgement",
        text: "I confirm that my supervisor and I have discussed this training and plan for improvement.",
      },
      { kind: "signature_row", label: "Employee Signature", dateLabel: "Date" },
      { kind: "signature_row", label: "Supervisor Signature", dateLabel: "Date" },
    ],
  };
}

/* ------------------------------------------------- follow-up coaching --- */

/**
 * ============================================================================
 * THE FOLLOW-UP COACHING FORM — DEFINED BY THE FRAMEWORK, NOT BY A PAPER FORM
 * ============================================================================
 *
 * THIS IS THE ONE TEMPLATE IN THE LIBRARY WITH NO APPROVED PAPER SOURCE, and
 * that fact is load-bearing rather than incidental. Every other form here is a
 * reading of a document the business issues — a .docx or a printed form somebody
 * signs. This one is specified by ASK SUNNY PERFORMANCE MANAGEMENT FRAMEWORK
 * §9.2, "Template: Create a follow-up coaching form", which names the form and
 * lists its fields and its two option sets exactly:
 *
 *   Original Coaching Topic / Original Expectation / Follow-Up Observation /
 *   Progress Level [Improved / Partially Improved / No Improvement] /
 *   Specific Evidence / Additional Coaching Completed /
 *   Next Step [Continue / Role-play / EPP / Corrective Action / Leadership Review] /
 *   Next Follow-Up [Timeframe]
 *
 * WHAT IS DELIBERATELY ABSENT, AND WHY EACH ABSENCE IS THE POINT.
 *
 *   NO ACKNOWLEDGEMENT PARAGRAPH AND NO SIGNATURE ROWS. Every other form in
 *   this library ends in one, and copying that here for visual consistency
 *   would be inventing the wording of an employee acknowledgement — on a
 *   document that goes in an employment file. §9.2 specifies neither. If the
 *   business issues a paper Follow-Up Coaching Form later, its acknowledgement
 *   arrives with it as revision 2.
 *
 *   NO POLICY FIELDS, NO WARNING LEVEL, NO DISCIPLINARY STEP. §9.2 has none.
 *   "Next Step" NAMES the escalation the manager is choosing — it does not
 *   impose one, and it is not the same thing as the Corrective Action Form's
 *   Type of Warning.
 *
 *   NO JOB TITLE AND NO LOCATION. §9.1 lists Job Title for the Coaching Form;
 *   §9.2 lists neither for this one, so neither is here.
 *
 * NOTHING IS PRESENT BEYOND §9.2 — INCLUDING THE EMPLOYEE AND THE DATE.
 *
 * An earlier version of this document opened with `employee_name` and
 * `form_date` as `system` fields, on the reasoning that a printed page carrying
 * no name is not a record of anything. That reasoning was right about the need
 * and wrong about where to meet it: §9.2 lists neither, and adding a field to a
 * framework-defined schema is the same class of act as adding an
 * acknowledgement to it.
 *
 * THEY ARE RECORD METADATA, AND THE ENGINE ALREADY RENDERS THEM AS SUCH. The
 * employee, the form date, the template name and the draft status print in the
 * footer of EVERY page from `RenderMeta`, sourced from the `form_instances` row
 * rather than from any field; the inline editor and the Create a Form screen
 * both show the employee from the same row, above the document. So the subject
 * is identified on screen and on paper without the field schema claiming a
 * field the framework does not define.
 *
 * If the business wants the employee and the date ON THE FORM as fields, that
 * is a change to a framework-defined document and needs explicit approval —
 * it is reported as a proposed business change rather than made here.
 *
 * PROGRESS LEVEL AND NEXT STEP ARE CHECKBOX GROUPS because a checkbox group is
 * this document model's only construct for a named option list. The framework
 * writes them as bracketed alternatives; ticking one is the faithful reading.
 *
 * THE COACHING FORM IS UNTOUCHED BY THIS. Follow-up is documented two ways in
 * the approved framework and they are different workflows, not duplicates:
 * §2.4 lists both a "follow-up coaching note" — this form — and an "updated
 * Coaching Form", which is a REVISION of the original coaching instance and is
 * already supported (`openRevision`, `revises_instance_id`). Neither replaces
 * the other, and nothing here changes the Coaching Form's document or version.
 */
export function followUpCoachingDocument(): FormDocument {
  return {
    paper: "letter",
    blocks: [
      { kind: "letterhead", brand: BRAND, title: "Follow-Up Coaching Form" },

      { kind: "section", label: "Original Coaching" },
      {
        kind: "field",
        field: field("original_topic", "Original Coaching Topic", "ai"),
      },
      {
        kind: "field",
        field: field("original_expectation", "Original Expectation", "ai", "long_text"),
      },

      { kind: "section", label: "Follow-Up" },
      {
        kind: "field",
        field: field("follow_up_observation", "Follow-Up Observation", "ai", "long_text", {
          help: "What the manager observed after the original coaching.",
        }),
      },
      {
        kind: "checkbox_group",
        key: "progress_level",
        label: "Progress Level",
        options: [
          { key: "improved", label: "Improved" },
          { key: "partially_improved", label: "Partially Improved" },
          { key: "no_improvement", label: "No Improvement" },
        ],
        responsibility: "ai",
        columns: 3,
      },
      {
        kind: "field",
        field: field("specific_evidence", "Specific Evidence", "ai", "long_text", {
          help: "What was seen, heard, or measured.",
        }),
      },
      {
        kind: "field",
        field: field("additional_coaching", "Additional Coaching Completed", "ai", "long_text", {
          help: "If any. Left empty when no further coaching was given.",
        }),
      },

      { kind: "section", label: "Next Step" },
      {
        kind: "checkbox_group",
        key: "next_step",
        options: [
          { key: "continue", label: "Continue" },
          { key: "role_play", label: "Role-play" },
          { key: "epp", label: "EPP" },
          /*
           * THE KEY IS `dpoa`; THE LABEL IS NOT. The rung the business now names
           * "Corrective Action" is recorded by the template whose stored key has
           * always been `dpoa`, and that key is what every saved value, every
           * guard in `pm-governance.ts` and every already-filled follow-up form
           * addresses. Renaming the label renames what a manager reads;
           * renaming the key would orphan every box already ticked.
           */
          { key: "dpoa", label: "Corrective Action" },
          { key: "leadership_review", label: "Leadership Review" },
        ],
        responsibility: "ai",
        columns: 3,
      },
      {
        /*
         * A TIMEFRAME, NOT A DATE. §9.2 says "[Timeframe]", and a `date` input
         * would quietly turn "in two weeks, on her next closing shift" into a
         * calendar day nobody agreed to. The instance's own follow-up date is
         * tracked separately and has its own control.
         */
        kind: "field",
        field: field("next_follow_up", "Next Follow-Up", "ai", "text", {
          help: "The timeframe agreed for the next follow-up.",
          /*
           * MARKED AS A TIMEFRAME, because the generic drafting prompt forbids
           * scheduling talk and would otherwise leave this §9.2 field empty on
           * every draft. Two different things wear the same word:
           *
           *   the INSTANCE's `follow_up_date`  a calendar date, managed by the
           *                                    manager through its own control,
           *                                    and what drives Form Monitoring.
           *
           *   THIS FIELD                       the timeframe the manager and
           *                                    employee agreed, in their words
           *                                    — "in two weeks, on her next
           *                                    closing shift". §9.2 calls it
           *                                    "[Timeframe]".
           *
           * The marker lets the prompt permit the second while still forbidding
           * the first, and lets a guard refuse a calendar date the manager never
           * gave. See `follow-up-timeframe.ts`.
           */
          semantics: "follow_up_timeframe",
        }),
      },
    ],
  };
}

/* ---------------------------------------------------------- corrective --- */

/**
 * ============================================================================
 * THE CORRECTIVE ACTION FORM — `dpoa` INTERNALLY, FOR AS LONG AS THE DATA IS
 * ============================================================================
 *
 * The business renamed this document. What a manager reads is "Corrective
 * Action Form"; what the database, the API and every already-filed record
 * address is still the key `dpoa`, and that split is deliberate rather than
 * unfinished work:
 *
 *   `form_templates.key`            addressed by every stored instance, every
 *                                   route, and `INLINE_DRAFT_TEMPLATE_KEYS`.
 *   `form_instances.template_id`    points at the row that key identifies.
 *   `next_step` option `dpoa`       already ticked on filed Follow-Up Coaching
 *                                   Forms.
 *
 * Renaming the key would orphan all three for a word nobody outside the code
 * ever sees. The DISPLAY name is data on the row — `form_instance_overview`
 * joins it live rather than snapshotting it — so renaming it here renames the
 * form everywhere a person meets it, including on records filed last month.
 *
 * The policy trio — what was observed, which policy it breached, and the manual's
 * own words — is the part that must never be improvised. `policyGrounded` marks
 * the two that quote policy; the assistant may only fill those from a knowledge
 * match and leaves them for the manager when it has none.
 *
 * THE TWO PROSE FIELDS EITHER SIDE OF THAT TRIO NOW CARRY SHAPES TOO, because
 * the trio failing closed is what exposed them. With the policy fields left
 * correctly empty, an unshaped Action Plan filled the silence with the very
 * things the policy fields had just refused — a policy paraphrased from
 * memory, a review date nobody set, a consequence nobody decided. The
 * observation asks for the coaching narrative and the plan asks for the
 * plan-of-action paragraph; see `lib/forms/narrative-draft` for both, and for
 * the guard that runs on whichever comes back.
 */
export function correctiveActionDocument(): FormDocument {
  return {
    paper: "letter",
    blocks: [
      { kind: "letterhead", brand: BRAND, title: "Corrective Action Form" },
      ...employeeInformation(),

      { kind: "section", label: "Type of Warning" },
      {
        kind: "checkbox_group",
        key: "warning_type",
        options: [
          { key: "verbal", label: "Verbal Warning" },
          { key: "written", label: "Written Warning" },
          { key: "termination", label: "Termination" },
          { key: "demotion", label: "Demotion" },
        ],
        responsibility: "ai",
        columns: 2,
      },
      {
        /*
         * "PREVIOUS CORRECTIVE ACTION", NOT "PREVIOUSLY DISCIPLINED". The field
         * key is unchanged — `previous_action` is what every stored value is
         * addressed by — and only the words the manager reads have moved.
         *
         * The help text is what stops the field reading as an accusation on a
         * first occurrence: "None — first occurrence" is a real answer, and a
         * form that leaves this blank instead is one a reader can mistake for a
         * history nobody checked.
         */
        kind: "field",
        field: field("previous_action", "Previous corrective action for this policy or issue", "ai", "text", {
          help: 'The prior coaching or corrective action on this same issue. Write "None — first occurrence" when there has been none.',
        }),
      },
      {
        kind: "field",
        field: field("previous_action_date", "Date of previous corrective action", "ai", "date"),
      },

      { kind: "section", label: "Type of Offense" },
      {
        kind: "checkbox_group",
        key: "offense_type",
        options: [
          { key: "tardiness", label: "Tardiness/Leaving Early" },
          { key: "absenteeism", label: "Absenteeism" },
          { key: "standards_of_conduct", label: "Standards of Conduct" },
          { key: "under_performance", label: "Under Performance" },
          { key: "dress_code", label: "Dress Code Violation" },
          { key: "company_policies", label: "Violation of Company Policies" },
        ],
        responsibility: "ai",
        columns: 2,
      },
      { kind: "field", field: field("other_offense", "Other", "ai") },

      { kind: "section", label: "Details" },
      {
        kind: "field",
        field: field("observation", "Observation of Offense", "ai", "long_text", {
          help:
            'Written as "Observed:" — what happened — then "Expectation:" — the ' +
            'standard the employee is expected to meet — then "Going Forward:" — ' +
            "what they do differently. One field, three labelled sections.",
          /*
           * THE SAME SHAPE THE COACHING FORM USES, for the same reason. A
           * corrective record that names the offence and not the standard
           * cannot show the employee was told what to do instead, which is the
           * part the signature is for.
           *
           * WHAT THE SHAPE DOES NOT LICENSE IS A FINDING. "Observed:" is what
           * was seen or heard; whether it broke a rule is settled by the two
           * policy fields below, from the approved manual, and by nothing else
           * on this form. `policy-claim-guard.ts` is what holds that when the
           * manual could not be searched or did not match.
           */
          narrative: "observed_expectation",
        }),
      },
      {
        /*
         * ====================================================================
         * THE TWO POLICY FIELDS, AS THE BUSINESS USES THEM
         * ====================================================================
         *
         * These were briefly modelled as "policy title" and "verbatim quote",
         * and the business corrected it: on their form,
         *
         *   POLICY VIOLATED       is the offense CATEGORY — whichever box is
         *                         ticked under Type of Offense above.
         *   DIRECT POLICY         names the approved manual the category was
         *                         checked against, with its section and page.
         *
         * BOTH ARE NOW DERIVED RATHER THAN WRITTEN, which is what makes the
         * change safe. Policy Violated is copied from the tick, so it cannot
         * disagree with the box beside it; Direct policy is built from the
         * document retrieval actually returned, so it cannot name a manual
         * nobody read. Neither is prose a model composes — see
         * `policy-fields.ts`.
         *
         * `policyGrounded` MOVES WITH THAT. Policy Violated is no longer a
         * claim about a manual, so it does not fail closed against retrieval;
         * Direct policy still is, and still does.
         */
        kind: "field",
        field: field("policy_violated", "Policy Violated", "ai", "text", {
          help: "The offense category ticked above. Filled from the form itself, not composed.",
        }),
      },
      {
        kind: "field",
        field: field("policy_language", "Direct policy from official manual", "ai", "long_text", {
          policyGrounded: true,
          help: "The approved manual this was checked against, with its section and page. Left for the manager when no approved policy matches.",
        }),
      },
      {
        kind: "field",
        field: field("action_plan", "Action Plan", "ai", "long_text", {
          help:
            "One paragraph: what is being done, what the employee does going " +
            "forward, and that the manual's own wording is reviewed with them. " +
            "No dates, no follow-up meeting, no consequence of a further occurrence.",
          narrative: "plan_of_action",
        }),
      },

      { kind: "section", label: "Acknowledgement of Receipt of Warning" },
      {
        kind: "acknowledgement",
        text: "Employee and supervisor discussed the warning and plan for improvement. Further violations may result in additional action.",
      },
      { kind: "signature_row", label: "Employee Signature", dateLabel: "Date" },
      { kind: "signature_row", label: "Supervisor Signature", dateLabel: "Date" },
    ],
  };
}

/**
 * The Policy Review Form.
 *
 * Structurally the DPOA's Details block without the warning: an observation,
 * the same two policy-grounded lines, and a plan. It carries the same two
 * narrative shapes for the same reason — a policy review whose plan invents a
 * follow-up date and a consequence has reviewed nothing.
 */
export function policyReviewDocument(): FormDocument {
  return {
    paper: "letter",
    blocks: [
      { kind: "letterhead", brand: BRAND, title: "Policy Review Form" },
      ...employeeInformation(),

      { kind: "section", label: "Type" },
      {
        kind: "checkbox_group",
        key: "review_types",
        options: [
          { key: "under_performance", label: "Under Performance" },
          { key: "tpoa", label: "TPOA" },
          { key: "policy_review", label: "Policy Review" },
        ],
        responsibility: "ai",
        columns: 3,
      },

      { kind: "section", label: "Topic" },
      { kind: "field", field: field("topic", "Topic", "ai") },

      { kind: "section", label: "Details" },
      {
        kind: "field",
        field: field("observation", "Observation", "ai", "long_text", {
          help:
            'Written as "Observed:" — what happened — then "Expectation:" — the ' +
            'standard the employee is expected to meet — then "Going Forward:" — ' +
            "what they do differently. One field, three labelled sections.",
          narrative: "observed_expectation",
        }),
      },
      {
        kind: "field",
        field: field("policy_violated", "Policy Violated", "ai", "text", {
          policyGrounded: true,
          help: "Named from the approved manual. Left for the manager when no approved policy matches.",
        }),
      },
      {
        kind: "field",
        field: field("policy_language", "Direct policy from official manual", "ai", "long_text", {
          policyGrounded: true,
          help: "Quoted verbatim from the manual. Never paraphrased and never invented.",
        }),
      },
      {
        kind: "field",
        field: field("plan_of_action", "Plan of Action", "ai", "long_text", {
          help:
            "One paragraph: what is being done, what the employee does going " +
            "forward, and that the manual's own wording is reviewed with them. " +
            "No dates, no follow-up meeting, no consequence of a further occurrence.",
          narrative: "plan_of_action",
        }),
      },

      { kind: "section", label: "Acknowledgement of Training" },
      {
        kind: "acknowledgement",
        text: "I confirm that my supervisor and I have discussed this training and plan for improvement.",
      },
      { kind: "signature_row", label: "Employee Signature", dateLabel: "Date" },
      { kind: "signature_row", label: "Supervisor Signature", dateLabel: "Date" },
    ],
  };
}

/* ----------------------------------------------------------------- EPP --- */

/**
 * The three-page Employee Performance Plan, shared by four templates.
 *
 * `{{role}}` is the reviewer — Training Salon Director, District Manager, Salon
 * Director — and `{{roleAbbr}}` is who is being reviewed: ASD, SD, TC. The four
 * templates differ in their title and in that pairing, and in nothing else,
 * which is why they are one builder taking two arguments rather than four
 * copies that can drift.
 *
 * Only the FIRST line of each numbered list carries an AI chip on the captures;
 * the rest are ruled lines the manager fills in conversation. That is preserved
 * — the list is one `ai` field whose drafted lines populate downward.
 */
export function eppDocument(title: string): FormDocument {
  return {
    paper: "letter",
    blocks: [
      { kind: "letterhead", brand: BRAND, title },
      ...employeeInformation(),

      { kind: "section", label: "To be filled out by {{role}}" },
      {
        kind: "field",
        field: field("where_succeeding", "In what areas is the {{roleAbbr}} currently succeeding?", "ai", "long_text"),
      },
      {
        kind: "field",
        field: field("needs_improvement", "In what areas does the {{roleAbbr}} currently need improvement?", "ai", "long_text"),
      },
      {
        kind: "numbered_list",
        key: "top_strengths",
        label: "Overall top three strengths",
        count: 3,
        responsibility: "ai",
      },
      {
        kind: "numbered_list",
        key: "improvement_areas",
        label: "Overall two biggest areas of improvement",
        count: 2,
        responsibility: "ai",
      },
      {
        kind: "field",
        field: field("employee_productivity", "{{roleAbbr}}'s current productivity", "ai", "long_text"),
      },
      {
        kind: "field",
        field: field("salon_productivity", "Salon's current productivity", "ai", "long_text"),
      },

      { kind: "section", label: "{{roleAbbr}} Thoughts" },
      {
        kind: "field",
        field: field("employee_self_review", "Self review", "ai", "long_text", {
          help: "Drafted from the conversation, then reviewed with the employee before signing.",
        }),
      },
      {
        kind: "numbered_list",
        key: "salon_goals",
        label: "Salon Goals: current top three goals",
        count: 3,
        responsibility: "ai",
      },

      { kind: "section", label: "Plan of Action" },
      {
        kind: "field",
        field: field("plan_of_action", "Plan, objectives and goals", "ai", "long_text"),
      },
      {
        kind: "field",
        field: field("follow_up_week", "{{role}} and {{roleAbbr}} will meet and re-evaluate the week of", "ai", "date"),
      },

      ...acknowledgement(
        "I confirm that my supervisor and I have discussed this training document and I will participate in the plan for improvement.",
      ),
    ],
  };
}

/** The reviewer/subject pairing each EPP template is printed for. */
export function eppVariant(role: string, roleAbbr: string, label: string): FormVariant[] {
  return [{ key: "default", label, role, roleAbbr }];
}

/* ------------------------------------------------------------ DMIT EPP --- */

/**
 * The six-page DMIT Employee Performance Plan, in two readings.
 *
 * What the reference shows and this reproduces:
 *
 *   a boxed POSITION DESCRIPTION printed for the reviewed position, different
 *   per variant and marked as such on the page;
 *   an explicit PAGE BREAK before the section the employee completes;
 *   a whole section marked FILLED BY HAND — the employee's own answers, which
 *   the assistant never drafts;
 *   Follow-up, Acknowledgement, then RE-EVALUATION and a SECOND acknowledgement,
 *   all in the one document.
 *
 * The re-evaluation is part of this form rather than a separate one, which is
 * why a form instance carries the whole lifecycle and a revision points back at
 * what it revised.
 */
export function dmitEppDocument(): FormDocument {
  return {
    paper: "letter",
    blocks: [
      { kind: "letterhead", brand: BRAND, title: "Employee Performance Plan" },
      ...employeeInformation(),

      {
        kind: "reference",
        label: "Printed for the reviewed position — TSD",
        variantKey: "tsd",
        body: [
          "To be reviewed with District Manager",
          "First we need to understand what the purpose and responsibilities are for a District Manager with Sun Tan City:",
          "General Purpose of Position",
          "The District Manager is responsible for overseeing several salons. Responsibilities include managing sales and operations, driving revenue, controlling expenses and payroll budgets, handling personnel issues, accounting, merchandising, and loss prevention. District Managers are also ultimately responsible for ensuring the highest level of client service throughout the salons.",
        ],
      },
      {
        kind: "reference",
        label: "Printed for the reviewed position — DMIT",
        variantKey: "dmit",
        body: [
          "To be reviewed with District Manager in Training",
          "First we need to understand what the purpose and responsibilities are for a District Manager in Training with Sun Tan City:",
          "General Purpose of Position",
          "The District Manager in Training is learning to oversee several salons: sales and operations, revenue, expense and payroll control, personnel, accounting, merchandising and loss prevention, while being assessed against the District Manager standard.",
        ],
      },

      { kind: "section", label: "To be filled out by {{role}}" },
      {
        kind: "field",
        field: field("where_succeeding", "In what areas is the {{roleAbbr}} currently succeeding?", "ai", "long_text"),
      },
      {
        kind: "field",
        field: field("needs_improvement", "In what areas does the {{roleAbbr}} currently need improvement?", "ai", "long_text"),
      },
      {
        kind: "numbered_list",
        key: "top_strengths",
        label: "What are the {{roleAbbr}}'s overall top three strengths?",
        count: 3,
        responsibility: "ai",
      },
      {
        kind: "numbered_list",
        key: "improvement_areas",
        label: "What are the {{roleAbbr}}'s overall two biggest areas of improvement?",
        count: 2,
        responsibility: "ai",
      },
      {
        kind: "field",
        field: field("employee_productivity", "{{role}}'s current productivity", "ai", "long_text"),
      },
      {
        kind: "field",
        field: field("salon_productivity", "Salon's current productivity", "ai", "long_text"),
      },

      { kind: "page_break" },

      { kind: "section", label: "To be filled out by {{role}}" },
      {
        kind: "note",
        text: "This section is completed by hand, in the conversation. Ask Sunny does not draft it.",
      },
      {
        kind: "field",
        field: field("most_important_skill", "What do you feel is the most important skill for a {{role}} to possess?", "manual"),
      },
      {
        kind: "field",
        field: field("self_succeeding", "In what areas do you feel you are currently succeeding?", "manual", "long_text"),
      },
      {
        kind: "field",
        field: field("self_improvement", "In what areas do you feel you need improvement?", "manual", "long_text"),
      },
      {
        kind: "numbered_list",
        key: "self_strengths",
        label: "What are your overall top three strengths?",
        count: 3,
        responsibility: "manual",
      },
      {
        kind: "numbered_list",
        key: "self_improvement_areas",
        label: "What are your overall two biggest areas of improvement?",
        count: 2,
        responsibility: "manual",
      },
      {
        kind: "numbered_list",
        key: "salon_goals",
        label: "Salon Goals: What are your salon's current top three goals?",
        count: 3,
        responsibility: "manual",
      },

      { kind: "section", label: "Plan of Action" },
      { kind: "paragraph", text: "Review and adjust together with the employee." },
      {
        kind: "field",
        field: field("plan_of_action", "Plan, objectives and goals", "ai", "long_text"),
      },

      { kind: "page_break" },

      { kind: "section", label: "Follow-up" },
      {
        kind: "field",
        field: field("follow_up_week", "{{role}} and {{roleAbbr}} will meet and re-evaluate the week of", "ai", "date"),
      },
      ...acknowledgement(
        "I confirm that my supervisor and I have discussed this training document and I will participate in the plan for improvement.",
      ),

      { kind: "section", label: "Re-Evaluation" },
      {
        kind: "field",
        field: field("objectives_met", "Which objectives were met?", "ai", "long_text"),
      },
      {
        kind: "field",
        field: field("reevaluation_plan", "Plan of Action", "ai", "long_text"),
      },
      ...acknowledgement(
        "I confirm that my supervisor and I have discussed this training document and I will participate in the plan for improvement.",
      ),
    ],
  };
}

export const DMIT_VARIANTS: FormVariant[] = [
  {
    key: "tsd",
    label: "TSD Review",
    role: "District Manager",
    roleAbbr: "TSD",
    reviewedPosition: "TSD",
  },
  {
    key: "dmit",
    label: "DMIT Review",
    role: "District Manager",
    roleAbbr: "DMIT",
    reviewedPosition: "DMIT",
  },
];

/* -------------------------------------------------------- the library --- */

export type { TemplateSeed } from "./catalog";

/**
 * THE NINE HR & PERFORMANCE FORMS.
 *
 * `HR_TEMPLATE_SEEDS` is this file's own list; `TEMPLATE_SEEDS` below is the
 * whole library, this list followed by the hiring one. A form is added to a
 * category by being added to that category's list — there is no separate place
 * where the grouping is decided a second time.
 */
export const HR_TEMPLATE_SEEDS: TemplateSeed[] = [
  {
    key: "coaching",
    name: "Coaching Form",
    shortName: "Coaching",
    description:
      "The everyday documented coaching conversation. Names the gap, the expectation and the follow-up.",
    category: "hr_performance",
    layoutFamily: "coaching",
    requiredPermission: "create_coaching_form",
    displayOrder: 1,
    document: coachingDocument(),
    variants: [],
    revision: 2,
    revisionNote: "Published from the authoritative 01. Coaching Form source document.",
    bundledPdfName: "Coaching Form.pdf",
  },
  {
    /*
     * THE KEY STAYS `dpoa`. See `correctiveActionDocument` for why: it is what
     * every filed instance, every route and every ticked Next Step box already
     * addresses, and the name a manager reads is a column on the row rather
     * than the row's identity.
     */
    key: "dpoa",
    name: "Corrective Action Form",
    shortName: "Corrective Action",
    description:
      "The formal corrective step after coaching. Records the warning, the policy breached in the manual's own words, and the plan.",
    category: "hr_performance",
    layoutFamily: "corrective",
    requiredPermission: "create_corrective_action",
    displayOrder: 2,
    document: correctiveActionDocument(),
    variants: [],
    revision: 3,
    revisionNote:
      "Renamed to Corrective Action Form, and Observation of Offense drafts as Observed/Expectation/Going Forward with the Action Plan as the plan-of-action paragraph. Revision 3 sets the two policy fields to the business's own reading of them: Policy Violated is the offense category ticked on the form, and Direct policy names the approved manual with its section and page. The letterhead and the previous-action wording follow the business's current terminology; the template key, the field keys and every stored value are unchanged.",
    bundledPdfName: "Corrective Action Form.pdf",
  },
  {
    key: "policy-review",
    name: "Policy Review",
    shortName: "Policy Review",
    description:
      "A documented review of a policy with an employee, quoting the approved manual.",
    category: "hr_performance",
    layoutFamily: "corrective",
    requiredPermission: "create_policy_review",
    displayOrder: 3,
    document: policyReviewDocument(),
    variants: [],
    revision: 2,
    revisionNote:
      "Observation drafts as Observed/Expectation/Going Forward, and the Plan of Action as the plan-of-action paragraph.",
    bundledPdfName: "Policy Review Form.pdf",
  },
  {
    key: "sdit-epp",
    name: "SDIT EPP",
    shortName: "SDIT EPP",
    description: "Employee Performance Plan for a Salon Director in training.",
    category: "hr_performance",
    layoutFamily: "epp",
    requiredPermission: "create_epp",
    displayOrder: 4,
    document: eppDocument("Employee Performance Plan - SDIT"),
    variants: eppVariant("Training Salon Director", "ASD", "SDIT review"),
    revision: 1,
    revisionNote: "Seeded from the approved reference forms.",
    bundledPdfName: "Employee EPP (SDIT).pdf",
  },
  {
    key: "tsd-epp",
    name: "TSD EPP",
    shortName: "TSD EPP",
    description: "Employee Performance Plan for a Training Salon Director.",
    category: "hr_performance",
    layoutFamily: "epp",
    requiredPermission: "create_epp",
    displayOrder: 5,
    document: eppDocument("Employee Performance Plan - TSD"),
    variants: eppVariant("District Manager", "SD", "TSD review"),
    revision: 1,
    revisionNote: "Seeded from the approved reference forms.",
    bundledPdfName: "Management EPP (TSD).pdf",
  },
  {
    key: "asd-sdit-epp",
    name: "ASD-SDIT Performance EPP",
    shortName: "ASD-SDIT",
    description: "Performance plan covering the ASD to SDIT development track.",
    category: "hr_performance",
    layoutFamily: "epp",
    requiredPermission: "create_epp",
    displayOrder: 6,
    document: eppDocument("Performance EPP - ASD/SDIT"),
    variants: eppVariant("Training Salon Director", "ASD", "ASD/SDIT review"),
    revision: 1,
    revisionNote: "Seeded from the approved reference forms.",
    bundledPdfName: "ASD-SDIT Performance EPP.pdf",
  },
  {
    key: "fttc-epp",
    name: "FTTC Performance EPP",
    shortName: "FTTC",
    description: "Performance plan for a full-time Tanning Consultant.",
    category: "hr_performance",
    layoutFamily: "epp",
    requiredPermission: "create_epp",
    displayOrder: 7,
    document: eppDocument("Performance EPP - FTTC"),
    variants: eppVariant("Salon Director", "TC", "FTTC review"),
    revision: 1,
    revisionNote: "Seeded from the approved reference forms.",
    bundledPdfName: "FTTC Performance EPP.pdf",
  },
  {
    key: "dmit-epp-tsd",
    name: "DMIT EPP — TSD Review",
    shortName: "DMIT / TSD",
    description:
      "The TSD reading of the DMIT Employee Performance Plan, through re-evaluation.",
    category: "hr_performance",
    layoutFamily: "dmit_epp",
    requiredPermission: "create_epp",
    displayOrder: 8,
    document: dmitEppDocument(),
    variants: DMIT_VARIANTS,
    revision: 1,
    revisionNote: "Seeded from the approved reference forms.",
    bundledPdfName: "DMIT EPP - TSD Review.pdf",
  },
  {
    key: "dmit-epp-dmit",
    name: "DMIT EPP — DMIT Review",
    shortName: "DMIT / DMIT",
    description:
      "The DMIT reading of the DMIT Employee Performance Plan, through re-evaluation.",
    category: "hr_performance",
    layoutFamily: "dmit_epp",
    requiredPermission: "create_epp",
    displayOrder: 9,
    document: dmitEppDocument(),
    variants: DMIT_VARIANTS,
    revision: 1,
    revisionNote: "Seeded from the approved reference forms.",
    bundledPdfName: "DMIT EPP - DMIT Review.pdf",
  },
  {
    /*
     * ========================================================================
     * THE FOLLOW-UP COACHING FORM
     * ========================================================================
     *
     * See `followUpCoachingDocument` for what it contains and, more
     * importantly, for what it deliberately does not.
     *
     * WHY `displayOrder` IS 14 AND NOT 2. Reading order would put it beside the
     * Coaching Form, and it cannot go there: `display_order` is written only on
     * INSERT, so renumbering the eight forms below it in this file would leave
     * the code saying one order and every already-seeded database saying
     * another. 14 is the next free number after the four hiring forms, so it is
     * the same on a database seeded today and on one seeded last month, and it
     * sorts last inside HR & Performance rather than tying with the Corrective
     * Action Form for second place. A tie would order the two by whatever the database happened
     * to return.
     *
     * `create_coaching_form`, because this documents the follow-up to a
     * coaching conversation and whoever may open the coaching record is who
     * follows it up. It is NOT `create_corrective_action`: naming an escalation
     * as the next step is not taking one, and gating the follow-up behind the
     * disciplinary permission would mean the manager who did the coaching could
     * not close the loop on it.
     */
    key: "follow-up-coaching",
    name: "Follow-Up Coaching Form",
    shortName: "Follow-Up Coaching",
    description:
      "Records what changed after a coaching conversation — the original expectation, what was observed since, the progress level, and the next step.",
    category: "hr_performance",
    layoutFamily: "coaching",
    requiredPermission: "create_coaching_form",
    displayOrder: 14,
    document: followUpCoachingDocument(),
    variants: [],
    revision: 2,
    revisionNote:
      "Published from ASK SUNNY PERFORMANCE MANAGEMENT FRAMEWORK §9.2 (Template: Create a follow-up coaching form). Framework-defined: there is no approved paper or PDF source form for this document, and no acknowledgement or signature wording was specified for it. Revision 2 renames the Next Step option `dpoa` to read \"Corrective Action\"; the option key is unchanged, so every box already ticked still resolves.",
    /*
     * The filename the structured renderer prints under. The bundled default IS
     * the renderer rather than an uploaded file — true of every template here —
     * and for this one there is additionally no paper form it could ever be. The
     * `provenance` below is what says so on the row itself.
     */
    bundledPdfName: "Follow-Up Coaching Form.pdf",
    provenance: {
      kind: "framework",
      document: "ASK_SUNNY_PERFORMANCE_MANAGEMENT_FRAMEWORK_KB_TEXT",
      locator: "§9.2 Template: Create a follow-up coaching form",
      note: "Framework-defined form. Fields and option lists are taken verbatim from §9.2 of the approved Performance Management Framework. This form did NOT originate from an uploaded business PDF, and no paper source form exists for it.",
    },
  },
];

/**
 * THE WHOLE LIBRARY, IN CATEGORY ORDER.
 *
 * One array, because everything that installs, lists or authorizes a template
 * reads exactly this. Adding a Hiring & Interview form means appending to
 * `HIRING_TEMPLATE_SEEDS` in `hiring-library.ts` and nothing here: the category
 * it lands in, the page section it renders under and the permission it needs
 * all come from the seed itself.
 */
export const TEMPLATE_SEEDS: TemplateSeed[] = [
  ...HR_TEMPLATE_SEEDS,
  ...HIRING_TEMPLATE_SEEDS,
];

/** The default variant a new form of this template starts on. */
export function defaultVariantKey(seedKey: string): string | null {
  if (seedKey === "dmit-epp-tsd") return "tsd";
  if (seedKey === "dmit-epp-dmit") return "dmit";
  const seed = TEMPLATE_SEEDS.find((entry) => entry.key === seedKey);
  return seed?.variants[0]?.key ?? null;
}
