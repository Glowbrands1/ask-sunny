import "server-only";

import type { AskResponse } from "@/lib/ai/types";
import { ACTIVE_BRAND } from "@/lib/brand";
import {
  SupabaseKnowledgeProvider,
  type OfficialPolicyManualResult,
} from "@/lib/knowledge/providers/supabase";
import type { ChatMessage } from "@/types";

import { policyPhrase } from "./ca-action-plan";
import { syncCorrectiveActionPlan } from "./ca-action-plan-sync";
import { fieldsForVariant, parseFormDocument } from "./document";
import { employeeFirstName } from "./employee-reference";
import { changeOnEditableDraft } from "./editable-draft";
import { authorizeInstance } from "./instance-scope";
import { applyAssistantDraft, applyAssistantRevision } from "./instances";
import {
  COMPANY_POLICIES_OFFENSE,
  boxSectionNames,
  findManualSection,
  manualDisplayTitle,
  officialManualProvenance,
  type ManualSection,
} from "./official-policy-manual";
import { manualGroundedPolicies, policyFieldValue } from "./policy-citation";
import { formDerivedProvenance, offenseCategoryValue } from "./policy-fields";
import {
  nextPolicySections,
  readPolicyChange,
  sectionsNamedIn,
  similarHeadings,
  unresolvedPolicyName,
} from "./policy-change";
import { extractEmployeeNames, samePerson } from "./proposal";
import { asksForAnotherForm } from "./revision";

/** The line on a Corrective Action Form and a Policy Review that quotes the manual. */
const POLICY_KEY = "policy_language";

/** The Corrective Action Form's Policy Violated line: the ticked box, and the section cited beside it. */
const VIOLATED_KEY = "policy_violated";

/** "Create a CA for …", "I need a new corrective action" — a new form, not this one. */
const NEW_FORM = /\b(?:create|start|pull up|new|another|need an?|draft an?)\b/i;

/** "Add THAT policy", "the one you quoted" — the policy is in an earlier turn. */
const REFERS_BACK =
  /\b(?:that|this|the same|those|above|it|you (?:just\s+)?(?:quoted|found|mentioned|showed|cited|shared|pulled))\b/i;

/** How far back "that policy" may reach. */
const LOOKBACK_TURNS = 6;

/**
 * ============================================================================
 * "ADD THE LATE OPENING POLICY" ON THE FORM THAT IS OPEN
 * ============================================================================
 *
 * Tried by the chat route after `correctActiveForm` and before a revision or
 * an ordinary answer, only where the browser named a form this conversation
 * created. Null for anything that is not a policy change to a form with a
 * Direct policy line — the turn is then answered exactly as before.
 *
 * THE MANUAL'S WORDS, NEVER THE MODEL'S. No model is called. The section is
 * found by the heading the manual prints (`policy-change.ts`), its wording is
 * copied out of the pinned manual's rows, and it is written with the same
 * `officialManualProvenance` the first draft gives a section it resolved — so
 * the form card's verification notice and the finalize acknowledgement behave
 * exactly as they do for a first draft that found the section itself.
 *
 * EVERYTHING IS RE-CHECKED: the instance is loaded and `authorizeInstance`
 * runs with "edit", the template's own permission and the salon scope.
 */
export async function changeActiveFormPolicy(input: {
  request: Request;
  instanceId: string;
  question: string;
  history: Pick<ChatMessage, "role" | "content" | "error">[];
}): Promise<AskResponse | null> {
  const mode = readPolicyChange(input.question);
  if (!mode) return null;
  if (asksForAnotherForm(input.question) || NEW_FORM.test(input.question)) return null;

  let authorized: Awaited<ReturnType<typeof authorizeInstance>>;
  try {
    authorized = await authorizeInstance(input.request, input.instanceId, "edit");
  } catch {
    return null;
  }
  const { actor, loaded } = authorized;
  const instance = loaded.instance;
  const document = parseFormDocument(loaded.version.document);
  const field = fieldsForVariant(document, instance.variantKey).find(
    (candidate) => candidate.key === POLICY_KEY && candidate.policyGrounded,
  );
  if (!field) return null;

  // A turn about somebody else is not a change to this form.
  const named = extractEmployeeNames(input.question);
  if (named.length > 0 && !named.some((name) => samePerson(name, instance.employeeName))) return null;

  const who = `**${instance.templateName}** for **${instance.employeeName}**`;
  /*
   * A FINALIZED FORM'S POLICY IS CHANGED ON A NEW DRAFT OF IT, opened here;
   * the finalized record is never written. See `editable-draft.ts`.
   */
  if (instance.status !== "draft") {
    return changeOnEditableDraft(input.request, input.instanceId, (draftId) =>
      changeActiveFormPolicy({ ...input, instanceId: draftId }),
    );
  }

  const manual = await readManual();
  if (!manual.ok) {
    return reply(
      `I couldn't read the official policy manual just now, so I haven't changed ${field.label} on the ${who}. Try again in a moment, or type the policy into that line on the form yourself.`,
    );
  }

  const jobTitle = instance.employeeRole;
  let wanted = sectionsNamedIn({ text: input.question, chunks: manual.chunks, jobTitle });
  /*
   * "ADD THAT POLICY TO THE FORM" — the policy was named a turn or two ago,
   * most often in Sunny's own answer quoting it. The nearest turn that names
   * a manual heading answers, and nothing older.
   */
  if (wanted.length === 0 && REFERS_BACK.test(input.question)) {
    const recent = input.history.filter((turn) => !turn.error && typeof turn.content === "string").slice(-LOOKBACK_TURNS);
    for (const turn of [...recent].reverse()) {
      wanted = sectionsNamedIn({ text: turn.content, chunks: manual.chunks, jobTitle });
      if (wanted.length > 0) break;
    }
  }

  if (wanted.length === 0) {
    const asked = unresolvedPolicyName(input.question);
    // "The policy is correct" names no policy: not a change, an ordinary turn.
    if (!asked) return null;
    const similar = similarHeadings(asked, manual.chunks);
    return reply(
      [
        `I couldn't find a section called "${asked}" in the ${manualDisplayTitle(manual.documentTitle)}, so I haven't changed ${field.label} on the ${who}.`,
        similar.length > 0
          ? `The manual does have ${similar.map((heading) => `**${heading}**`).join(", ")} — tell me which one you mean.`
          : "Tell me the section's name as the manual prints it, and I'll add it.",
      ].join(" "),
    );
  }

  const row = loaded.values.find((value) => value.fieldKey === POLICY_KEY);
  const before = (row?.value ?? "").trim();
  const current = currentSections(row?.provenance, manual.chunks);
  const next = nextPolicySections({ mode, current, named: wanted });
  const names = (sections: readonly ManualSection[]) =>
    sections.map((section) => `**${section.heading}** (page ${section.page})`).join(" and ");

  if (mode === "remove") {
    if (next.length === current.length) {
      return reply(`${names(wanted)} isn't cited on the ${who}, so I haven't changed anything.`);
    }
    if (next.length === 0) {
      await applyAssistantRevision(input.instanceId, {}, [POLICY_KEY], actor.id);
      const violated = await followOffense(input.instanceId, actor.id, loaded, document, []);
      /* The Action Plan names the policy Direct policy cites — so it follows the line. See `ca-action-plan.ts`. */
      const plan = await syncCorrectiveActionPlan(input.instanceId, actor.id);
      return {
        ...reply(
          `Removed ${names(wanted)} from ${field.label} on the ${who}. That line is now blank — tell me which policy applies and I'll add it from the manual.${plan.length > 0 ? " The Action Plan has been updated to match." : ""} Everything else on the form is as it was.`,
        ),
        formUpdate: { instanceId: input.instanceId, updated: [POLICY_KEY, ...violated, ...plan] },
      };
    }
  }

  if (mode !== "remove" && next.length === current.length && next.every((section, i) => section.heading === current[i]!.heading)) {
    return reply(`${field.label} on the ${who} already cites ${names(wanted)}, word for word from the manual. Nothing needed changing.`);
  }

  const policies = manualGroundedPolicies(manual, next);
  const value = policyFieldValue(policies);
  if (!value) return null;

  const saved = await applyAssistantDraft(
    input.instanceId,
    { values: { [POLICY_KEY]: value }, checked: {} },
    actor.id,
    {
      [POLICY_KEY]: {
        ...officialManualProvenance({
          documentId: manual.documentId,
          documentTitle: manual.documentTitle,
          matchedBy: manual.matchedBy,
          sections: next,
        }),
        citation: policies,
        via: "chat_policy_change",
      },
    },
  );
  if (!(POLICY_KEY in saved.accepted.values)) {
    return reply(`I couldn't save ${field.label} on the ${who}, so it is as it was. Type the policy into that line on the form instead.`);
  }
  /* Policy Violated names the section now cited beside its box, as a first draft does. */
  const violated = await followOffense(input.instanceId, actor.id, loaded, document, next);
  /* The Action Plan names the policy Direct policy cites — so it follows the line. See `ca-action-plan.ts`. */
  const plan = await syncCorrectiveActionPlan(input.instanceId, actor.id);

  const added = mode === "remove" ? [] : wanted;
  const lines: string[] = [];
  if (mode === "remove") {
    lines.push(`Removed ${names(wanted)} from ${field.label} on the ${who}. It now cites ${names(next)}.`);
  } else {
    lines.push(
      `Updated ${field.label} on the ${who}: it now cites ${names(next)} from the ${manualDisplayTitle(manual.documentTitle)}, in the manual's own words.`,
    );
    for (const policy of policies.filter((p) => added.some((section) => section.heading === p.sectionTitle))) {
      if (policy.policyText.trim() === "") continue;
      lines.push("", `**${policy.sectionTitle}:**`, ...policy.policyText.trim().split("\n").map((line) => `> ${line}`));
    }
  }
  /*
   * WHAT IT REPLACED IS SAID, so nothing a person typed disappears silently —
   * the old text is quoted back and can be put back on the form.
   */
  const replacedTyped = before !== "" && current.length === 0 && row?.filledBy !== "ai";
  if (replacedTyped) {
    lines.push("", `This replaces what had been typed into that line by hand: "${before}".`);
  } else if (mode === "replace" && current.length > 0 && current.some((section) => !next.some((kept) => kept.heading === section.heading))) {
    lines.push("", `It no longer cites ${names(current.filter((section) => !next.some((kept) => kept.heading === section.heading)))}.`);
  }
  if (plan.length > 0) {
    lines.push(
      "",
      `The Action Plan now says management will review ${policyPhrase(next.map((section) => section.heading))} with ${employeeFirstName(instance.employeeName) ?? "the employee"}.`,
    );
  }
  lines.push(
    "",
    "The policy line is now checked against the manual, so the form won't ask you to verify it at Finalize. Everything else on the form is as it was — give it a read below.",
  );
  return {
    ...reply(lines.join("\n")),
    formUpdate: { instanceId: input.instanceId, updated: [POLICY_KEY, ...violated, ...plan] },
  };
}

/**
 * ============================================================================
 * POLICY VIOLATED NAMES THE SECTION DIRECT POLICY CITES BESIDE ITS BOX
 * ============================================================================
 *
 * On a first draft Policy Violated reads "Violation of Company Policies —
 * Visitors in the Workplace" for a section no other box covers, and
 * "Tardiness/Leaving Early — Late Opening" for a late opening under Tardiness
 * (`boxSectionNames`). When the open form's Direct policy line changes in
 * chat, Policy Violated is re-derived from the boxes and the sections now
 * cited, so the two lines never name different sections (District Manager
 * feedback, 21 Oct 2026).
 *
 * NOTHING ELSE MOVES. The offense box is the manager's (or the draft's) and
 * is not ticked or unticked here; a form with no section named beside a box,
 * before or after, or whose Policy Violated a person wrote by hand, is left
 * exactly as it is. Returns the keys it wrote.
 */
async function followOffense(
  instanceId: string,
  actorId: string,
  loaded: Awaited<ReturnType<typeof authorizeInstance>>["loaded"],
  document: ReturnType<typeof parseFormDocument>,
  cited: readonly ManualSection[],
): Promise<string[]> {
  const variantKey = loaded.instance.variantKey;
  if (!fieldsForVariant(document, variantKey).some((entry) => entry.key === VIOLATED_KEY)) return [];
  const ticked = loaded.values.find((value) => value.fieldKey === "offense_type")?.checked ?? [];
  const violated = loaded.values.find((value) => value.fieldKey === VIOLATED_KEY);
  const sectionNames = boxSectionNames(cited.map((section) => section.heading));
  /*
   * Only where a section is, or was, named beside a box: Violation of Company
   * Policies, a box now cited for a section not its own ("Late Opening" under
   * Tardiness), or a line that named one before.
   */
  const names =
    ticked.includes(COMPANY_POLICIES_OFFENSE) ||
    ticked.some((key) => key in sectionNames) ||
    / — /.test(violated?.value ?? "");
  if (!names) return [];
  if (violated && violated.filledBy === "manager" && (violated.value ?? "").trim() !== "") return [];

  const derived = offenseCategoryValue({
    document,
    variantKey,
    checked: { offense_type: ticked },
    values: Object.fromEntries(loaded.values.map((value) => [value.fieldKey, value.value ?? ""])),
    sectionNames,
  });
  if (!derived || derived === (violated?.value ?? "").trim()) return [];
  const saved = await applyAssistantDraft(
    instanceId,
    { values: { [VIOLATED_KEY]: derived }, checked: {} },
    actorId,
    formDerivedProvenance([VIOLATED_KEY]),
  );
  return VIOLATED_KEY in saved.accepted.values ? [VIOLATED_KEY] : [];
}

/**
 * The sections the line cites now — only where Ask Sunny put them there from
 * the manual. Re-found by heading in the manual as it reads today, so a
 * re-indexed manual is quoted as it is, not as a stale chunk number said.
 */
function currentSections(
  provenance: Record<string, unknown> | undefined,
  chunks: Parameters<typeof findManualSection>[0],
): ManualSection[] {
  if (!provenance || provenance.verified !== true || provenance.source !== "official_policy_manual") return [];
  const listed = Array.isArray(provenance.sections) ? provenance.sections : [];
  const found: ManualSection[] = [];
  for (const entry of listed) {
    const heading = typeof (entry as { locator?: unknown })?.locator === "string" ? (entry as { locator: string }).locator : "";
    const section = heading ? findManualSection(chunks, [heading]) : null;
    if (section && !found.some((seen) => seen.heading === section.heading)) found.push(section);
  }
  return found;
}

/** The pinned manual, or a reason — a knowledge-base outage never fails the turn. */
async function readManual(): Promise<OfficialPolicyManualResult> {
  try {
    return await new SupabaseKnowledgeProvider().fetchOfficialPolicyManual(ACTIVE_BRAND.knowledgeScopeId);
  } catch {
    return { ok: false, reason: "The official policy manual could not be read." };
  }
}

function reply(content: string): AskResponse {
  return { content, citations: [], coverage: "not_applicable", recommendedVideoIds: [] };
}
