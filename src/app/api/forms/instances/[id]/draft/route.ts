import { NextResponse } from "next/server";

import { getAnthropicClient } from "@/lib/ai/anthropic";
import { AiError } from "@/lib/ai/errors";
import {
  assertLiveMode,
  assertNoConfigurationProblems,
  assertWithinRateLimit,
  errorResponse,
} from "@/lib/api/respond";
import { ACTIVE_BRAND } from "@/lib/brand";
import { CLAUDE_MAX_TOKENS, CLAUDE_MODEL } from "@/lib/config/models";
import { authorizeInstance, InstanceNotVisibleError } from "@/lib/forms/instance-scope";
import { parseFormVariants, interpolate, type FormField } from "@/lib/forms/document";
import { applyAssistantDraft } from "@/lib/forms/instances";
import {
  PERFORMANCE_MANAGEMENT_DRAFT_RULES,
  SENSITIVE_ACTION_NOTICE,
  refuseSensitiveSelections,
} from "@/lib/forms/escalation-guard";
import {
  PM_DRAFT_UNAVAILABLE_NOTICE,
  performanceManagementGovernance,
} from "@/lib/forms/pm-governance";
import { PERFORMANCE_MANAGEMENT_FRAMEWORK } from "@/lib/knowledge/document-roles";
import { SupabaseKnowledgeProvider } from "@/lib/knowledge/providers/supabase";
import {
  draftableCheckboxGroups,
  draftableFields,
  draftableNumberedLists,
  enforceResponsibilities,
} from "@/lib/forms/responsibility";
import { stripPlaceholdersFromDraft } from "@/lib/forms/drafted-text";
import {
  FOLLOW_UP_TIMEFRAME_RULES,
  guardFollowUpTimeframe,
} from "@/lib/forms/follow-up-timeframe";
import {
  EXPECTATION_LABEL,
  GOING_FORWARD_LABEL,
  OBSERVED_EXPECTATION,
  OBSERVED_LABEL,
  PLAN_OF_ACTION,
  guardNarrativeDraft,
} from "@/lib/forms/narrative-draft";
import {
  dropUngroundedPolicy,
  groundPolicy,
  groundingNotice,
  provenanceFor,
  refuseOffenseLabelEchoes,
} from "@/lib/forms/policy-grounding";
import {
  POLICY_CLAIM_REMOVED_NOTICE,
  POLICY_REQUIREMENT_REMOVED_NOTICE,
  POLICY_SEPARATION_RULES,
  genericCompliancePlan,
  stripUnsupportedPolicyClaims,
  stripUnsupportedPolicyRequirements,
} from "@/lib/forms/policy-claim-guard";
import {
  correctDraftedDates,
  formDateBrief,
  groundedSourceWithFormDate,
  resolveFormDate,
} from "@/lib/forms/form-date-grounding";

/**
 * POST /api/forms/instances/[id]/draft
 *
 * Ask Sunny drafts a form the manager has already started. It is the SAME
 * assistant as the rest of the app — same client, same model configuration —
 * doing a different job, not a second chatbot.
 *
 * WHAT THE MODEL IS AND IS NOT TRUSTED WITH:
 *
 *   The field list comes from the STORED TEMPLATE VERSION, not from the
 *   request. A client cannot widen what may be written by sending a longer
 *   list, which is exactly what the previous prototype allowed.
 *
 *   Only fields the template marks `ai` are described to it, and whatever comes
 *   back is filtered again by `applyAssistantDraft` before anything is stored.
 *   Signature fields have no key to address in the first place.
 *
 *   Policy-quoting fields are drafted only from retrieved approved policy. When
 *   retrieval finds nothing, those fields are withheld — the response says so
 *   and the manager writes them. An invented policy quotation on a disciplinary
 *   record is the single worst thing this feature could produce.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface DraftBody {
  /** What the manager described, in their own words. */
  notes?: string;
  topic?: string;
}

function fieldBrief(field: FormField, variantLabel: string | null): string {
  const label = interpolate(field.label, null).replace(/\{\{\w+\}\}/g, variantLabel ?? "the employee");
  /*
   * A NARRATIVE FIELD'S SHAPE COMES FROM THE RULES, NOT FROM ITS HELP TEXT.
   *
   * `help` is manager-facing guidance stored on the version, and a published
   * version is immutable — so a form published before the section contract
   * changed still carries the older wording. Sending both would put two
   * different instructions in front of the model about the same field. The
   * rules below are the contract; the marker is what points at them.
   */
  const help = field.help && !field.narrative ? ` (${field.help})` : "";
  const grounded = field.policyGrounded ? " [quote approved policy only]" : "";
  const narrative = field.narrative ? ` [${field.narrative}]` : "";
  return `- ${field.key}: ${label}${help}${grounded}${narrative}`;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    const { id } = await context.params;
    /*
     * The TEMPLATE'S OWN permission, and the form's salon. This asked for
     * `create_coaching_form` on every template, so a role that may draft a
     * coaching form could have Ask Sunny write into a Disciplinary Plan of
     * Action — at any salon, on a guessed UUID.
     */
    const { actor, loaded } = await authorizeInstance(request, id, "edit");
    assertWithinRateLimit(request, "chat");

    if (loaded.instance.status !== "draft") {
      return NextResponse.json(
        { error: "This form is finalized. Create a revision to change it." },
        { status: 409 },
      );
    }

    const body = ((await request.json().catch(() => null)) ?? {}) as DraftBody;
    const notes = String(body.notes ?? "").trim().slice(0, 4000);
    if (notes.length < 10) {
      throw new AiError(
        "bad_request",
        "Tell Ask Sunny what happened before asking for a draft.",
        400,
      );
    }

    const document = loaded.version.document;
    const variantKey = loaded.instance.variantKey;
    const variant =
      parseFormVariants(loaded.version.variants).find((entry) => entry.key === variantKey) ?? null;

    const fields = draftableFields(document, variantKey);
    const groups = draftableCheckboxGroups(document, variantKey);
    const lists = draftableNumberedLists(document, variantKey);
    if (fields.length === 0 && groups.length === 0 && lists.length === 0) {
      return NextResponse.json({ values: {}, checked: {}, withheld: [], notice: null });
    }

    /*
     * ========================================================================
     * DOES THE PROGRESSION FRAMEWORK GOVERN THIS FORM?
     * ========================================================================
     *
     * DERIVED FROM THE STORED VERSION, never from the request. Drafting a
     * Follow-Up Coaching Form means choosing a Next Step from Continue,
     * Role-play, EPP, DPOA and Leadership Review; drafting a DPOA means choosing
     * a Type of Warning. Those are positions on the approved ladder, and until
     * now the document that defines that ladder governed the chat answer path
     * and not the one place Ask Sunny writes an escalation onto a record.
     *
     * See `pm-governance.ts` for the three signals and for why the plain
     * Coaching Form is deliberately NOT governed.
     */
    const governance = performanceManagementGovernance({
      layoutFamily: loaded.instance.layoutFamily,
      document,
      variantKey,
    });

    const progression = governance.governed
      ? await new SupabaseKnowledgeProvider()
          .fetchRoleGrounding(
            PERFORMANCE_MANAGEMENT_FRAMEWORK,
            ACTIVE_BRAND.knowledgeScopeId,
          )
          .catch(() => null)
      : null;

    /*
     * FAILS CLOSED, AND THE FORM STAYS USABLE.
     *
     * No AI draft, a controlled response, and no general-HR fallback — a
     * progression described from general knowledge is the failure being
     * refused, not a lesser service. What the manager keeps is the blank form,
     * which is fully editable by hand, so nobody is blocked from filing today.
     *
     * `.catch(() => null)` above collapses a retrieval OUTAGE into the same
     * unavailable state rather than a 500, so this branch covers both.
     */
    if (governance.governed && (progression === null || !progression.ok)) {
      return NextResponse.json({
        values: {},
        checked: {},
        withheld: [],
        rejected: [],
        placeholders: { cleaned: [], emptied: [] },
        narrative: { adjusted: [], emptied: [] },
        notice: PM_DRAFT_UNAVAILABLE_NOTICE,
        sources: [],
      });
    }

    /*
     * The framework's own rows, with their provenance. Real chunks from the
     * indexed document — same document id, same locators the Knowledge Base
     * shows — so the model is reasoning from the approved text rather than from
     * a paraphrase of it that lives in this file.
     */
    const progressionBlock = progression?.ok
      ? `\nPERFORMANCE MANAGEMENT FRAMEWORK (the approved progression; reason from this, do not restate it):\n${progression.grounding.rows
          .map((row) => `[${row.document_title} — ${row.locator}]\n${row.content}`)
          .join("\n\n")}`
      : "";

    /*
     * Policy is retrieved from the MANAGER'S words, before the model runs — so
     * the quotation the model is allowed to use cannot be steered by anything
     * the model itself produced.
     */
    const needsPolicy = fields.some((field) => field.policyGrounded);
    const grounding = needsPolicy
      ? await groundPolicy(`${body.topic ?? ""} ${notes}`.trim())
      : { passages: [], sources: [], unverified: false, reason: null };

    const policyBlock = grounding.passages.length
      ? `\nAPPROVED POLICY (quote only from this, verbatim):\n${grounding.passages
          .map((passage) => `[${passage.source.documentTitle} ${passage.source.locator}]\n${passage.text}`)
          .join("\n\n")}`
      : needsPolicy
        ? "\nAPPROVED POLICY: none found. Leave every policy field empty."
        : "";

    const hasTimeframeField = fields.some(
      (field) => field.semantics === "follow_up_timeframe",
    );

    /*
     * ========================================================================
     * THE FORM'S OWN DATE, RESOLVED ONCE AND TREATED AS A FACT
     * ========================================================================
     *
     * SCOPED TO THE `corrective` FAMILY — the Corrective Action Form and the
     * Policy Review. Both open with a narrative Observation of Offense whose
     * first sentence is the whole factual record, and both are the forms where
     * losing that sentence to a mis-formatted date costs the most. Every other
     * template drafts exactly as it did; this changes no behaviour outside the
     * two documents it names.
     *
     * `form_date` is set when the record is created and defaults to today — so
     * a manager answering the intake's third question with "today" has already
     * had it resolved, server-side, from the application's clock. Nothing here
     * calculates a date and nothing asks the model to. See
     * `form-date-grounding.ts`.
     */
    const resolvedFormDate =
      loaded.instance.layoutFamily === "corrective"
        ? resolveFormDate(loaded.instance.formDate)
        : null;

    /*
     * The narrative fields, named once: the date correction runs on exactly
     * the set the narrative guard would otherwise gut.
     */
    const narrativeKeys = new Set(
      fields.filter((field) => field.narrative !== undefined).map((field) => field.key),
    );

    /*
     * WHAT THE GUARD TREATS AS SUPPLIED. The manager wrote "today"; the
     * application resolved it. They are the same fact, so the resolved
     * spellings travel with the notes — and a correctly-written date can no
     * longer cost the sentence around it.
     */
    const groundingSource = groundedSourceWithFormDate(notes, resolvedFormDate);

    /*
     * THE PLAN-OF-ACTION CONTRACT IS CONDITIONAL, and the condition is the
     * stored version rather than the template's name. Only the two corrective
     * forms declare the shape today; sending its rules to the Coaching Form
     * would put a second, differently-worded instruction about prose in front
     * of the model on a form that has no plan field to apply it to.
     */
    const hasPlanOfAction = fields.some((field) => field.narrative === PLAN_OF_ACTION);

    const system = [
      `You prepare drafts of ${ACTIVE_BRAND.brandName} management forms for a manager to review.`,
      "You are drafting, not deciding. A manager edits everything you write and signs it.",
      /*
       * THE MANAGER SUPPLIES THE INCIDENT; ASK SUNNY SUPPLIES THE COACHING.
       *
       * The line between the two is FACTS versus GUIDANCE, and it is the whole
       * shape of this prompt. Facts about what happened come from the manager
       * and nowhere else. The professional standard, and what the employee
       * should do differently, are ordinary coaching and are this assistant's
       * job to write — a manager who has to type the expectation themselves is
       * doing the work the feature exists to remove.
       */
      "FACTS come only from what the manager described: what happened, to whom, when, how many, where.",
      "COACHING GUIDANCE is yours to write: the standard an employee is expected to meet, and what good looks like next time.",
      "Complete the form. Do not leave a field you can reasonably fill empty, and do not ask the manager for wording you can write yourself.",
      "Never invent dates, figures, policy names or policy wording.",
      /*
       * SAID EXPLICITLY BECAUSE THE MODEL DID IT. A bracketed placeholder is
       * how a language model writes "somebody fills this in later", and on a
       * form that is exactly the wrong instinct: the field IS the place it gets
       * filled in.
       */
      "Never write a placeholder such as [Follow-Up Date] or [Employee Name]. If you do not have a value, leave the field empty.",
      /*
       * CONDITIONAL, because §9.2 defines a Follow-Up Coaching field that asks
       * for exactly this. The blanket prohibition made that field come back
       * empty on every draft — see `follow-up-timeframe.ts` for the two
       * different things called "follow-up".
       */
      ...(hasTimeframeField
        ? FOLLOW_UP_TIMEFRAME_RULES
        : [
            "Do not mention follow-up dates or scheduling at all: the follow-up date is recorded separately by the manager, not in these fields.",
          ]),
      "If you cannot support a field from what you were given, return it empty.",
      "Return only the fields you were asked for.",
      /*
       * THE OBSERVED / EXPECTATION SHAPE, asked for only by the fields whose
       * stored version requests it. A record that names the event and not the
       * expectation cannot show that anything was communicated to the employee.
       */
      `A field marked [${OBSERVED_EXPECTATION}] is written as three labelled sections, each label on its own line, separated by blank lines:`,
      `"${OBSERVED_LABEL}" then what happened, from the manager's account only.`,
      `"${EXPECTATION_LABEL}" then the standard the employee is expected to meet, stated neutrally and in the present tense.`,
      `"${GOING_FORWARD_LABEL}" then what the employee should do differently, as practical behaviour.`,
      "WRITE THE EXPECTATION YOURSELF. Infer a reasonable, neutral, behavioural standard for the issue described — for lateness, that an employee is expected to arrive on time and be ready to work at the start of their scheduled shift; for an unfinished task, that assigned work is expected to be completed within the shift; for weak client engagement, that clients are engaged with relevant questions and recommendations.",
      "This is general workplace coaching, NOT a quotation of any written rule. Never write that company policy, a handbook or a manual requires something, and never cite a policy section or attendance points.",
      "Keep every specific the manager gave — twenty minutes late stays twenty minutes late — and add none of your own.",
      "Never add a corrective step, a warning level, a suspension, a termination, an amount, a count of prior incidents, or a date the manager did not give you.",
      `"${GOING_FORWARD_LABEL}" is about the employee's behaviour, never about arranging a meeting: no follow-up, no check-in, no review date.`,
      `Only if the incident is too vague to infer a safe expectation, write the "${OBSERVED_LABEL}" section alone.`,
      /*
       * THE OBSERVATION / CATEGORY / POLICY SEPARATION, on the forms that have
       * policy fields to separate FROM. See `policy-claim-guard.ts`: the guard
       * that runs on the output is what holds, and these are what stop the
       * text being written in the first place.
       */
      ...(needsPolicy ? POLICY_SEPARATION_RULES : []),
      /*
       * THE CHEAPEST OF THE THREE DATE FIXES, and the only one that prevents
       * rather than repairs: a model told the date does not invent one.
       */
      ...(resolvedFormDate ? [formDateBrief(resolvedFormDate)] : []),
      /*
       * THE PLAN OF ACTION — three beats, in order, and nothing else.
       *
       * Written as the order of a paragraph rather than as a list of
       * prohibitions because the failure was not that the model broke a rule:
       * it was that a field labelled "Plan of Action" with no shape at all
       * invited a plan, and the only material the model had for one was
       * invention. Saying what the three sentences ARE leaves nothing for a
       * follow-up date and a policy quotation to fill.
       */
      ...(hasPlanOfAction
        ? [
            `A field marked [${PLAN_OF_ACTION}] is ONE PARAGRAPH — no labels, no bullets, no headings — in this order and nothing else:`,
            'FIRST, name what is being done and what it is about, from the form you are drafting and the topic the manager described: "This is being addressed as a policy review of salon appearance standards."',
            "SECOND, the standard the employee is expected to meet going forward, in their name and as practical behaviour — what they do before or during a shift, and who they ask when they are unsure.",
            "THIRD, that the specific policy language should be reviewed with the employee from the current applicable company manual, and that the manager should confirm they understand the standard. Write it as something still to be done. Never name, quote or paraphrase a policy here: the policy fields are the only place a manual is quoted, and they are left empty when nothing approved was retrieved.",
            "NOTHING ELSE BELONGS IN THIS PARAGRAPH. No date and no timeframe, no follow-up observation, review meeting or check-in, no disciplinary level, no consequence of a further occurrence, and no bracketed placeholder.",
          ]
        : []),
      ...(governance.governed ? PERFORMANCE_MANAGEMENT_DRAFT_RULES : []),
    ].join(" ");

    const prompt = [
      `FORM: ${loaded.instance.templateName}`,
      variant ? `REVIEWER: ${variant.role}. SUBJECT: ${variant.roleAbbr}.` : "",
      `EMPLOYEE: ${loaded.instance.employeeName}`,
      loaded.instance.locationName ? `LOCATION: ${loaded.instance.locationName}` : "",
      "",
      "WHAT THE MANAGER DESCRIBED:",
      notes,
      progressionBlock,
      policyBlock,
      "",
      "FIELDS YOU MAY WRITE:",
      ...fields.map((field) => fieldBrief(field, variant?.roleAbbr ?? null)),
      ...lists.map(
        (list) =>
          `- ${list.key}: ${interpolate(list.label, variant)} (up to ${list.count} items, one per line)`,
      ),
      "",
      /*
       * "MAY TICK" LEFT THESE BLANK. Read alongside the never-invent rules, a
       * permission to tick is safest declined, so a clear tardiness case came
       * back with no type, no topic and no write-in — a form the manager still
       * had to finish by hand. Choosing the option that matches what the
       * manager described is classification, not invention.
       */
      groups.length
        ? `CHECKBOXES TO TICK (use the option keys). Tick the options that match what the manager described; leave a group empty only when nothing in it fits:\n${groups
            .map(
              (group) =>
                `- ${group.key}: ${group.options.map((option) => `${option.key} = ${option.label}`).join("; ")}`,
            )
            .join("\n")}`
        : "",
      /*
       * The "Other" pair. The option and its write-in field are two separate
       * things on the document, and ticking one without filling the other
       * prints a ticked box with no label beside it.
       */
      groups.some((group) => group.options.some((option) => option.key === "other"))
        ? 'When no listed option fits, tick "other" AND name the topic in the matching write-in field — for lateness that write-in is "Punctuality".'
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: CLAUDE_MAX_TOKENS.detailed,
      system,
      messages: [{ role: "user", content: prompt }],
      tools: [
        {
          name: "write_form_fields",
          description: "Write the drafted values for the fields you were given.",
          input_schema: {
            type: "object",
            properties: {
              values: {
                type: "object",
                additionalProperties: { type: "string" },
                description: "Field key to drafted text. Omit a field you cannot support.",
              },
              checked: {
                type: "object",
                additionalProperties: { type: "array", items: { type: "string" } },
                description: "Checkbox group key to the option keys that apply.",
              },
            },
            required: ["values"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "write_form_fields" },
    });

    const call = response.content.find(
      (block): block is Extract<typeof block, { type: "tool_use" }> => block.type === "tool_use",
    );
    const drafted = (call?.input ?? {}) as {
      values?: Record<string, string>;
      checked?: Record<string, string[]>;
    };

    /*
     * UNRESOLVED PLACEHOLDERS GO BEFORE ANYTHING IS STORED.
     *
     * Asked to draft Details, the model wrote "I will check in with Sarah on
     * [Follow-Up Date]" — and that string became a canonical field value, an
     * editor row and a line in the printed PDF. The prompt already forbids it;
     * this is the guard that runs on what came back, because a model
     * instruction is a request and not a boundary.
     *
     * See `lib/forms/drafted-text.ts` for why the whole sentence goes rather
     * than the bracket, and why follow-up belongs to instance metadata rather
     * than to a paragraph in Details.
     */
    const cleaned = stripPlaceholdersFromDraft(drafted.values ?? {});

    /*
     * THEN THE NARRATIVE GUARD, on the fields whose stored version asks for the
     * Observed/Expectation shape.
     *
     * Run against the MANAGER'S OWN NOTES, which is what makes it a grounding
     * check rather than a style check: a date, an amount, a count of prior
     * occurrences or a disciplinary consequence survives only if the manager
     * supplied it, and an Expectation section survives only if their words
     * carried an expectation at all. Scheduling talk goes unconditionally —
     * follow-up is instance metadata with its own control, and a sentence
     * narrating it here is the same failure as `[Follow-Up Date]` without the
     * brackets. See `lib/forms/narrative-draft`.
     */
    /*
     * THE DATE CORRECTION RUNS FIRST, so what the narrative guard sees is a
     * grounded date and a sentence it can keep. A date the manager actually
     * gave is left exactly as they wrote it; one they did not is replaced by
     * the form's own, so the invented value never reaches the record AND the
     * fact around it survives. See `form-date-grounding.ts` for why a date is
     * the one unsupported value worth replacing rather than removing.
     */
    const dated = correctDraftedDates(
      cleaned.values,
      narrativeKeys,
      notes,
      resolvedFormDate,
    );

    const narrated = guardNarrativeDraft(dated.values, fields, groundingSource);

    /*
     * THEN THE TIMEFRAME GUARD. A drafted "Next Follow-Up" survives only if the
     * manager's own notes referred to a time at all — otherwise it is an
     * agreement between a manager and an employee that neither of them made.
     * Untouched on the thirteen templates that declare no timeframe field.
     */
    const timeframe = guardFollowUpTimeframe(narrated.values, fields, notes);

    /*
     * ========================================================================
     * THEN THE POLICY-FINDING GUARD, ON THE FIELDS THAT ARE NOT POLICY FIELDS
     * ========================================================================
     *
     * "…wearing a mini skirt at the Kearny salon, WHICH IS NOT IN COMPLIANCE
     * WITH THE SUN TAN CITY DRESS CODE POLICY." — written into Observation of
     * Offense on a form whose Policy Violated field was blank, because nothing
     * had been retrieved to put in it. The record asserted a breach and
     * declined to name the rule.
     *
     * The two guards above could not reach it: `policy-grounding` protects the
     * fields MARKED `policyGrounded`, and Observation is deliberately not one
     * of them; `guardNarrativeDraft` carries the right rule but runs only on
     * fields whose stored version asks for the Observed/Expectation shape,
     * which this one does not.
     *
     * SKIPS THE GROUNDED FIELDS, because `dropUngroundedPolicy` below refuses
     * them outright when the grounding is unverified — a stronger rule than
     * this one, and tidying a value that is about to be refused would only risk
     * making it look keepable.
     *
     * RUNS ONLY WHEN THE POLICY IS UNVERIFIED. With approved policy retrieved
     * the finding is supportable and the form is meant to make it.
     */
    const groundedKeys = new Set(
      fields.filter((field) => field.policyGrounded).map((field) => field.key),
    );
    const claims = grounding.unverified
      ? stripUnsupportedPolicyClaims(timeframe.values, groundedKeys)
      : { values: timeframe.values, adjusted: [] as string[], emptied: [] as string[] };

    /*
     * ========================================================================
     * THEN THE REQUIREMENT GUARD: A PLAN MAY SET AN EXPECTATION, NOT A RULE
     * ========================================================================
     *
     * "Sarah must wear pants instead of skirts" — written into the Action Plan
     * of a form whose policy fields were blank because nothing had been
     * retrieved. Nothing in the corpus says this company requires trousers.
     *
     * The claim guard above cannot see it: the sentence asserts no breach,
     * cites no manual and names no policy. It is a REQUIREMENT rather than a
     * finding, and it is the more dangerous of the two — it reads as the
     * manager's own instruction and is what the employee gets held to.
     *
     * UNLIKE THE CLAIM GUARD, THIS RUNS EVEN WHEN POLICY WAS RETRIEVED, because
     * a retrieved passage licenses only what it actually says: "skirts must
     * reach mid-thigh" is supportable once the manual says so, and "shoes must
     * be closed-toe" is not, on the same draft. The retrieved text is passed
     * in and the check is per requirement.
     *
     * WHAT REPLACES IT is the sentence that is always safe — the employee is
     * expected to meet the CURRENT requirement, and management will review it
     * with them — which is the step that makes the record defensible while the
     * manual is still to be read.
     */
    const requirements = needsPolicy
      ? stripUnsupportedPolicyRequirements(
          claims.values,
          groundedKeys,
          grounding.passages.map((passage) => passage.text).join(" "),
          genericCompliancePlan({
            employeeName: loaded.instance.employeeName,
            brandName: ACTIVE_BRAND.brandName,
            topic: null,
          }),
        )
      : { values: claims.values, adjusted: [] as string[], replaced: [] as string[] };

    /*
     * ========================================================================
     * EVERY GUARD RUNS IN MEMORY. THE WRITE HAPPENS ONCE, AT THE END.
     * ========================================================================
     *
     * THE DEFECT THIS ORDERING REPLACES was not a style problem. The route used
     * to call `applyAssistantDraft` here — WRITING the model's output to
     * `form_instance_values` — and then run `dropUngroundedPolicy` on what came
     * back, blanking the ungrounded policy fields with a second write of empty
     * strings.
     *
     * That second write did nothing. `enforceResponsibilities` drops empty
     * strings rather than treating them as a clear, so the empty values never
     * reached the table and the row kept whatever the model had invented. An
     * unverified "Policy Violated" and a fabricated quotation under "Direct
     * policy from official manual" were persisted on a disciplinary record, and
     * the code that looked like it removed them removed nothing.
     *
     * So the order is now: validate the shape, then check the grounding, then
     * write what survived both. There is no window in which an unverified
     * policy quotation exists in the database, because it is never sent.
     *
     * `enforceResponsibilities` is called HERE rather than relied on inside the
     * write, so the policy check operates on the same values the write will —
     * a field the template does not allow must not be able to influence what
     * the policy filter sees. `applyAssistantDraft` enforces both again at the
     * write; see the guard there for why that redundancy is deliberate.
     */
    /*
     * ========================================================================
     * A TERMINATION IS NEVER AI-SELECTED
     * ========================================================================
     *
     * Runs on the model's OUTPUT and before validation, so a ticked Termination
     * has no path to `form_instance_values` and none to the printed PDF, which
     * renders from the stored values.
     *
     * The options stay on the template — they are legitimate parts of the
     * business form and a manager acting on a leadership decision ticks them by
     * hand. What is refused is the ASSISTANT selecting one. The prompt says so
     * too; this is the half that holds, because a prompt instruction is a
     * request and this is a box whose meaning is that somebody lost their job.
     */
    const sensitive = refuseSensitiveSelections({
      document,
      variantKey,
      checked: drafted.checked ?? {},
    });

    const validated = enforceResponsibilities(document, variantKey, {
      values: requirements.values,
      checked: sensitive.checked,
    });

    /*
     * ========================================================================
     * A CATEGORY IS NOT A POLICY
     * ========================================================================
     *
     * Ticking "Dress Code Violation" under Type of Offense is a
     * classification. Writing those same three words into Policy Violated
     * invents a policy out of a category name, and QA caught the model doing
     * exactly that. It only happens when retrieval SUCCEEDED — with nothing
     * retrieved the field is withheld below and there is nothing to echo — so
     * it needs its own check, against the text that was actually retrieved
     * rather than against a list of forbidden words. A real policy title that
     * resembles an option label survives, because the passage that named it
     * contains it.
     */
    const echoes = refuseOffenseLabelEchoes(
      fields,
      validated.values,
      groups.flatMap((group) => group.options.map((option) => option.label)),
      grounding,
    );

    const provenance = provenanceFor(fields, echoes.values, grounding);

    // The policy rule, on validated values, BEFORE anything is stored.
    const policyChecked = dropUngroundedPolicy(fields, echoes.values, grounding);

    const guarded = await applyAssistantDraft(
      id,
      { values: policyChecked.values, checked: validated.checked },
      actor.id,
      provenance,
    );

    return NextResponse.json({
      values: guarded.accepted.values,
      checked: guarded.accepted.checked,
      /*
       * What the policy rule withheld, plus anything the write itself refused.
       * The second list should always be empty — the filter above already
       * removed them — and it is surfaced rather than dropped so that a
       * disagreement between the two is visible instead of silent.
       */
      withheld: [
        ...new Set([...echoes.withheld, ...policyChecked.withheld, ...guarded.policyRefused]),
      ],
      rejected: guarded.rejected,
      /** Fields the placeholder guard rewrote, and those it emptied entirely. */
      placeholders: { cleaned: cleaned.cleaned, emptied: cleaned.emptied },
      /** Same, for the ungrounded-narrative guard. */
      narrative: { adjusted: narrated.adjusted, emptied: narrated.emptied },
      /** Fields an unsupported policy finding was cut out of, or emptied by. */
      policyClaims: { adjusted: claims.adjusted, emptied: claims.emptied },
      /** Fields an unsourced policy REQUIREMENT was removed from. */
      policyRequirements: {
        adjusted: requirements.adjusted,
        replaced: requirements.replaced,
      },
      /** Narrative fields whose date was corrected to the form's own. */
      datesCorrected: dated.corrected,
      /** Timeframe fields emptied for want of anything to base one on. */
      timeframeEmptied: timeframe.emptied,
      /*
       * All three notices can apply at once — a Corrective Action Form whose
       * policy could not be verified, whose observation lost an unsupported
       * finding, AND whose Termination box was refused — so they are joined
       * rather than one winning. A refused sensitive action must never be
       * silent: an unticked box reads as "Ask Sunny judged this not to apply",
       * which is the opposite of what happened.
       */
      notice: [
        groundingNotice(grounding),
        /*
         * SAID OUT LOUD. A silently shortened observation is a change to an HR
         * record nobody signed off, and the manager may well be right that a
         * policy was broken — what is missing is the approved source saying so,
         * which is something they can go and check.
         */
        claims.adjusted.length + claims.emptied.length > 0
          ? POLICY_CLAIM_REMOVED_NOTICE
          : null,
        requirements.adjusted.length > 0 ? POLICY_REQUIREMENT_REMOVED_NOTICE : null,
        sensitive.anyRefused ? SENSITIVE_ACTION_NOTICE : null,
      ]
        .filter((line): line is string => Boolean(line))
        .join(" ") || null,
      /** Group key -> option keys the leadership-authority guard refused. */
      sensitiveRefused: sensitive.refused,
      sources: grounding.sources,
    });
  } catch (error) {
    if (error instanceof InstanceNotVisibleError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return errorResponse(error, "forms/instance/draft");
  }
}
