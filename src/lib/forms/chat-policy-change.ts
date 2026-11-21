import "server-only";

import { madeAbout } from "@/lib/ai/make-it-about";
import type { AskResponse } from "@/lib/ai/types";
import { ACTIVE_BRAND } from "@/lib/brand";
import {
  SupabaseKnowledgeProvider,
  type OfficialPolicyManualResult,
} from "@/lib/knowledge/providers/supabase";
import type { ChatMessage } from "@/types";
import { accountChangeRederivesPolicyEnabled, formEditSingleWriterEnabled, policyChangeRelevantEnabled } from "@/lib/config/chat-quality-flags";

import { policyPhrase } from "./ca-action-plan";
import { syncCorrectiveActionPlan } from "./ca-action-plan-sync";
import { CA_POLICY_QUESTION, readCaPolicy, statedOffenseKeys } from "./ca-policy";
import { offeredOffenseKeys } from "./offense-keys";
import { describedManualSection } from "./named-policy-section";
import { checkboxGroupsForVariant, fieldsForVariant, parseFormDocument } from "./document";
import { employeeFirstName } from "./employee-reference";
import { changeOnEditableDraft } from "./editable-draft";
import { authorizeInstance } from "./instance-scope";
import { applyAssistantDraft, applyAssistantRevision } from "./instances";
import {
  COMPANY_POLICIES_OFFENSE,
  boxSectionNames,
  findManualSection,
  approvedManualConfirmed,
  headingKey,
  manualSectionHeadings,
  manualDisplayTitle,
  officialManualProvenance,
  offenseKeyForManualHeading,
  sectionHeadingsFor,
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

/** The Type of Offense boxes. */
const OFFENSE_KEY = "offense_type";

/** "Create a CA for …", "I need a new corrective action" — a new form, not this one. */
const NEW_FORM = /\b(?:create|start|pull up|new|another|need an?|draft an?)\b/i;

/** "Add THAT policy", "the one you quoted" — the policy is in an earlier turn. */
const REFERS_BACK =
  /\b(?:that|this|the same|those|above|it|you (?:just\s+)?(?:quoted|found|mentioned|showed|cited|shared|pulled))\b/i;

/**
 * POLICY_CHANGE_RELEVANT_ENABLED (QA, 5 Nov 2026, severe): a reference back to a POLICY — "that policy", "the
 * section you quoted" — never a bare "that" ("include THAT <name> signed …", a conjunction).
 */
const REFERS_BACK_TO_A_POLICY =
  /\b(?:that|this|the same|those|above|it)\s+(?:[a-z'’-]+\s+){0,2}?(?:polic(?:y|ies)|sections?|rules?)\b|\byou (?:just\s+)?(?:quoted|found|mentioned|showed|cited|shared|pulled)\b/i;

/** The words that call a section a section — the same ones `REFERS_BACK_TO_A_POLICY` reads. */
const POLICY_WORD = /\b(?:polic(?:y|ies)|sections?|rules?)\b/gi;

/**
 * POLICY_CHANGE_RELEVANT_ENABLED: a message whose only "policy" is the manual's own name ("signed the jba policy
 * manual on 10-15-26", "the employee policy manual") asks for no change to the cited policy.
 */
function namesOnlyTheManual(question: string): boolean {
  const rest = question.replace(/\b(?:[\p{L}&'’-]+\s+){0,3}polic(?:y|ies)\s+(?:manual|handbook|book)\b/giu, " ");
  return rest !== question && !/\bpolic(?:y|ies)\b/i.test(rest);
}

/**
 * POLICY_CHANGE_RELEVANT_ENABLED: an earlier turn names a policy only where it names it AS one — a bold span that
 * is a manual heading whole ("**Late Opening** (page 15)"), or plain words. A bold span that is no heading is the
 * app's own wording and never names a section by a word inside it: the manual's 401k sheet is headed "Warning",
 * and "Is this new corrective action a **Verbal Warning** or a **Written Warning**?" is not that sheet.
 */
function turnPolicyText(content: string, headingKeys: readonly string[]): string {
  return content.replace(/\*\*([^*]+)\*\*/g, (whole, span: string) => (headingKeys.includes(headingKey(span.replace(/:$/, ""))) ? whole : " "));
}

/**
 * POLICY_CHANGE_RELEVANT_ENABLED: the form's own words that hold a manual heading without being one — "Verbal
 * Warning", "Written Warning", "Type of Warning" hold the 401k sheet's heading "Warning" — are the form's field or
 * option, never that section. Taken out of the text before any heading is read in it.
 */
function withoutFormWords(text: string, formWords: readonly string[]): string {
  let next = text;
  for (const words of formWords) next = next.replace(new RegExp(String.raw`\b${words.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, String.raw`\s+`)}\b`, "gi"), " ");
  return next;
}

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
  const lastAssistant = [...input.history].reverse().find((turn) => turn.role === "assistant" && !turn.error);
  const mode = readPolicyChange(input.question, {
    policyAsked: typeof lastAssistant?.content === "string" && lastAssistant.content.includes(CA_POLICY_QUESTION),
  });
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
  const relevant = policyChangeRelevantEnabled();
  const headingKeysAll = manualSectionHeadings(manual.chunks).map(headingKey);
  const formWords = relevant
    ? [...new Set([...fieldsForVariant(document, instance.variantKey).map((entry) => entry.label), ...checkboxGroupsForVariant(document, instance.variantKey).flatMap((group) => [group.label, ...group.options.map((option) => option.label)])])]
        .filter((label) => {
          const key = ` ${headingKey(label)} `;
          // A label that is a heading once its "policy" / "section" / "rule" word is off ("Attendance Policy") names
          // that section: the manager's "take the attendance policy off" means it (the sibling app's flip-3 gate, 6 Nov 2026).
          const named = headingKey(label.replace(POLICY_WORD, " "));
          return !headingKeysAll.includes(headingKey(label)) && !headingKeysAll.includes(named) && headingKeysAll.some((heading) => heading && key.includes(` ${heading} `));
        })
        .sort((a, b) => b.length - a.length)
    : [];
  const readable = (text: string) => (relevant ? withoutFormWords(text, formWords) : text);
  let wanted = sectionsNamedIn({ text: readable(input.question), chunks: manual.chunks, jobTitle });
  // POLICY_CHANGE_RELEVANT_ENABLED: "… signed the jba policy manual …" is no change to the cited policy; the turn goes on.
  if (relevant && wanted.length === 0 && namesOnlyTheManual(input.question)) return null;
  /*
   * "ADD THAT POLICY TO THE FORM" — the policy was named a turn or two ago,
   * most often in Sunny's own answer quoting it. The nearest turn that names
   * a manual heading answers, and nothing older.
   */
  if (wanted.length === 0 && (relevant ? REFERS_BACK_TO_A_POLICY : REFERS_BACK).test(input.question)) {
    const recent = input.history.filter((turn) => !turn.error && typeof turn.content === "string").slice(-LOOKBACK_TURNS);
    for (const turn of [...recent].reverse()) {
      const text = relevant ? readable(turnPolicyText(turn.content, headingKeysAll)) : turn.content;
      wanted = sectionsNamedIn({ text, chunks: manual.chunks, jobTitle });
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
      /*
       * FORM_EDIT_SINGLE_WRITER_ENABLED: every write of a policy change goes
       * through the one writer (`lib/forms/form-write.ts`, path "policy"): the
       * remove-all a clear, refused on a line the manager typed.
       */
      if (formEditSingleWriterEnabled()) {
        await (await import("./form-write")).clearWrite(input.instanceId, [POLICY_KEY], actor.id, { path: "policy", latest: input.question });
      } else {
        await applyAssistantRevision(input.instanceId, {}, [POLICY_KEY], actor.id);
      }
      const violated = await followOffense(input.instanceId, actor.id, loaded, document, []);
      /* The Action Plan names the policy Direct policy cites — so it follows the line. See `ca-action-plan.ts`. */
      const plan = formEditSingleWriterEnabled()
        ? await (await import("./form-write")).syncPlan(input.instanceId, actor.id)
        : await syncCorrectiveActionPlan(input.instanceId, actor.id);
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

  const policyProvenance = {
    [POLICY_KEY]: {
      ...officialManualProvenance({
        documentId: manual.documentId,
        documentTitle: manual.documentTitle,
        matchedBy: manual.matchedBy,
        ownerConfirmed: approvedManualConfirmed(manual),
        sections: next,
      }),
      citation: policies,
      via: "chat_policy_change",
    },
  };
  // FORM_EDIT_SINGLE_WRITER_ENABLED: the manual's line through the one writer; it may replace a typed line (typedExempt).
  const saved = formEditSingleWriterEnabled()
    ? await (await import("./form-write")).draftWrite(input.instanceId, { values: { [POLICY_KEY]: value }, checked: {} }, actor.id, policyProvenance, {
        path: "policy",
        latest: input.question,
        typedExempt: new Set([POLICY_KEY]),
      })
    : await applyAssistantDraft(
        input.instanceId,
        { values: { [POLICY_KEY]: value }, checked: {} },
        actor.id,
        policyProvenance,
      );
  if (!(POLICY_KEY in saved.accepted.values)) {
    return reply(`I couldn't save ${field.label} on the ${who}, so it is as it was. Type the policy into that line on the form instead.`);
  }
  const moved =
    mode === "replace"
      ? await followReplacedBox(input.instanceId, actor.id, loaded, document, next, input.question, input.history)
      : null;
  /* Policy Violated names the section now cited beside its box, as a first draft does. */
  const violated = await followOffense(input.instanceId, actor.id, loaded, document, next, moved);
  /* The Action Plan names the policy Direct policy cites — so it follows the line. See `ca-action-plan.ts`. */
  const plan = formEditSingleWriterEnabled()
    ? await (await import("./form-write")).syncPlan(input.instanceId, actor.id)
    : await syncCorrectiveActionPlan(input.instanceId, actor.id);

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
  if (moved) {
    lines.push("", `Type of Offense now reads **${moved.labels.join(", ")}**, so it matches the policy cited.`);
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
    formUpdate: { instanceId: input.instanceId, updated: [POLICY_KEY, ...(moved ? [OFFENSE_KEY] : []), ...violated, ...plan] },
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
  /** The boxes `followReplacedBox` just ticked, when it moved them. */
  moved: { keys: string[] } | null = null,
): Promise<string[]> {
  const variantKey = loaded.instance.variantKey;
  if (!fieldsForVariant(document, variantKey).some((entry) => entry.key === VIOLATED_KEY)) return [];
  const ticked = moved?.keys ?? loaded.values.find((value) => value.fieldKey === OFFENSE_KEY)?.checked ?? [];
  const violated = loaded.values.find((value) => value.fieldKey === VIOLATED_KEY);
  const sectionNames = boxSectionNames(cited.map((section) => section.heading));
  /*
   * Only where a section is, or was, named beside a box: Violation of Company
   * Policies, a box now cited for a section not its own ("Late Opening" under
   * Tardiness), or a line that named one before.
   */
  const names =
    moved !== null ||
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
  // FORM_EDIT_SINGLE_WRITER_ENABLED: the derived line through the one writer (path "policy").
  const saved = formEditSingleWriterEnabled()
    ? await (await import("./form-write")).draftWrite(instanceId, { values: { [VIOLATED_KEY]: derived }, checked: {} }, actorId, formDerivedProvenance([VIOLATED_KEY]), {
        path: "policy",
      })
    : await applyAssistantDraft(
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

/**
 * ============================================================================
 * A POLICY REPLACED MOVES ITS BOX
 * ============================================================================
 *
 * QA, 22 Oct 2026: "use the standards of conduct policy instead" on a form
 * ticked Absenteeism re-quoted Direct policy and the Action Plan, and left
 * Type of Offense and Policy Violated saying Absenteeism — one record naming
 * two policies. A policy the manager names INSTEAD is the box that is ticked,
 * as on a first draft (`statedOffenseKeys`): Attendance is Absenteeism for an
 * absence, a missed meeting included, and Tardiness otherwise; any other
 * section is the box that cites it.
 *
 * NEVER OVER THE MANAGER'S OWN TICK, and never where a box already ticked
 * cites the section named. Returns the boxes and their labels, or null.
 */
async function followReplacedBox(
  instanceId: string,
  actorId: string,
  loaded: Awaited<ReturnType<typeof authorizeInstance>>["loaded"],
  document: ReturnType<typeof parseFormDocument>,
  cited: readonly ManualSection[],
  question: string,
  history: readonly Pick<ChatMessage, "role" | "content" | "error">[],
): Promise<{ keys: string[]; labels: string[] } | null> {
  const group = checkboxGroupsForVariant(document, loaded.instance.variantKey).find((entry) => entry.key === OFFENSE_KEY);
  if (!group || cited.length === 0) return null;
  const row = loaded.values.find((value) => value.fieldKey === OFFENSE_KEY);
  const current = row?.checked ?? [];
  if (row?.filledBy === "manager" && current.length > 0) return null;

  const citedUnder = (key: string) =>
    sectionHeadingsFor({ offenseKeys: [key], jobTitle: loaded.instance.employeeRole }).flat().map(headingKey);
  if (cited.every((section) => current.some((key) => citedUnder(key).includes(headingKey(section.heading))))) return null;

  const account = [
    ...history.filter((turn) => turn.role === "user" && !turn.error).map((turn) => String(turn.content ?? "")),
    question,
  ].join("\n\n");
  const stated = statedOffenseKeys(readCaPolicy(question), account);
  const offered = group.options.map((option) => option.key);
  // Revision 8: a removed box is the box that replaced it, where this version offers only that (`offense-keys.ts`).
  const keys = offeredOffenseKeys([...new Set(stated ?? cited.map((section) => offenseKeyForManualHeading(section.heading)))], offered);
  if (keys.length === 0 || (keys.length === current.length && keys.every((key) => current.includes(key)))) return null;

  // FORM_EDIT_SINGLE_WRITER_ENABLED: the box through the one writer (path "policy").
  const saved = formEditSingleWriterEnabled()
    ? await (await import("./form-write")).draftWrite(instanceId, { values: {}, checked: { [OFFENSE_KEY]: keys } }, actorId, {}, { path: "policy", latest: question })
    : await applyAssistantDraft(instanceId, { values: {}, checked: { [OFFENSE_KEY]: keys } }, actorId);
  if (!(OFFENSE_KEY in saved.accepted.checked)) return null;
  return {
    keys,
    labels: keys.map((key) => group.options.find((option) => option.key === key)?.label ?? key),
  };
}

/*
 * ============================================================================
 * A REPLACED ACCOUNT CARRIES ITS POLICY (ACCOUNT_CHANGE_REDERIVES_POLICY_ENABLED)
 * ============================================================================
 *
 * Ported from Ask Bubbles at QA's direction (13 Nov 2026; QA's live test there): on a Corrective Action draft about
 * lateness, "make it about her phone use instead, she was on her phone the whole shift" and "change the issue to not doing the 10-minute sanitation" rewrote
 * the Observation, and Type of Offense, Policy Violated, Direct policy and the synced Action Plan stayed on Attendance.
 *
 * After an edit that replaces the whole account (the caller decides that: the old account's sentences are gone), the
 * offense is read again from the new account, as on a first draft:
 *   - a cleaning duty described is Other (Pau's rule): the Other box, Policy Violated from it, Direct policy cleared;
 *   - otherwise the manual section the account describes (`describedManualSection`) is cited in Direct policy, its box
 *     ticked (`statedOffenseKeys`, else the section's own box), and Policy Violated follows;
 *   - nothing read (no section, no Other): the form's policy is left as it was, never cleared on a reading of nothing.
 * The Action Plan Ask Sunny built follows (`syncPlan`). A policy the manager NAMES in the edit itself is kept (the
 * named-policy path answers that turn), and a line or tick the manager wrote is never touched. Returns the keys written.
 */
export async function rederivePolicyFromAccount(input: {
  readonly request: Request;
  readonly instanceId: string;
  readonly account: string;
  readonly question: string;
}): Promise<string[]> {
  if (!accountChangeRederivesPolicyEnabled() || !formEditSingleWriterEnabled()) return [];
  let authorized: Awaited<ReturnType<typeof authorizeInstance>>;
  try {
    authorized = await authorizeInstance(input.request, input.instanceId, "edit");
  } catch {
    return [];
  }
  const { actor, loaded } = authorized;
  const document = parseFormDocument(loaded.version.document);
  const fields = fieldsForVariant(document, loaded.instance.variantKey);
  if (!fields.some((field) => field.key === POLICY_KEY && field.policyGrounded)) return [];
  const group = checkboxGroupsForVariant(document, loaded.instance.variantKey).find((entry) => entry.key === OFFENSE_KEY);
  const manual = await readManual();
  if (!manual.ok) return [];
  const chunks = manual.chunks;
  const jobTitle = loaded.instance.employeeRole;
  // A policy named in the edit itself wins: the named-policy path answers it.
  if (sectionsNamedIn({ text: input.question, chunks, jobTitle }).length > 0) return [];

  const row = (key: string) => loaded.values.find((value) => value.fieldKey === key);
  const managers = (key: string) => row(key)?.filledBy === "manager" && ((row(key)?.value ?? "").trim() !== "" || (row(key)?.checked ?? []).length > 0);
  const writer = formEditSingleWriterEnabled() ? await import("./form-write") : null;
  if (!writer) return [];
  const written: string[] = [];
  const offered = group?.options.map((option) => option.key) ?? [];
  const reading = readCaPolicy(input.account);

  let keys: string[] = [];
  let sections: ManualSection[] = [];
  // Pau's rule: a cleaning or sanitation duty described is Other (this app's reader, with OTHER_POLICY_AGREES).
  if (reading.other === "cleaning" && offered.includes("other")) {
    keys = ["other"];
  } else {
    /*
     * The account as saved, else the manager's own made-about words (QA's live 17x item 2a in the sibling app, 14 Nov
     * 2026): the saved account says "on the phone the whole shift" (the app's neutral wording for "her phone"), which
     * reads as no section, while "make it about her phone use instead, she was on her phone the whole shift" reads as
     * the Cell Phone policy. Only the made-about clause is read, never the rest of the turn.
     */
    const about = madeAbout(input.question);
    const fromAccount = describedManualSection({ text: input.account, chunks });
    const described = fromAccount ?? (about ? describedManualSection({ text: about, chunks }) : null);
    const readFrom = fromAccount ? input.account : (about ?? input.account);
    if (described) {
      sections = [described.section];
      const stated = statedOffenseKeys(fromAccount ? reading : readCaPolicy(readFrom), readFrom);
      keys = offeredOffenseKeys([...new Set(stated ?? [offenseKeyForManualHeading(described.section.heading)])], offered);
    }
  }
  /*
   * Nothing read from the new account (the sibling's gate replay "nov7-refusal-sun-same-outline": a pasted outline reworded with
   * another employee's facts reads as no section): the policy on the form is kept, never cleared on a reading of nothing.
   */
  if (keys.length === 0) return [];

  // Direct policy: the section the account describes, from the manual; or cleared.
  if (!managers(POLICY_KEY)) {
    if (sections.length > 0) {
      const policies = manualGroundedPolicies(manual, sections);
      const value = policyFieldValue(policies);
      if (value && value !== (row(POLICY_KEY)?.value ?? "").trim()) {
        const provenance = {
          [POLICY_KEY]: {
            ...officialManualProvenance({
              documentId: manual.documentId,
              documentTitle: manual.documentTitle,
              matchedBy: manual.matchedBy,
              ownerConfirmed: approvedManualConfirmed(manual),
              sections,
            }),
            citation: policies,
            via: "account_change",
          },
        };
        const saved = await writer.draftWrite(input.instanceId, { values: { [POLICY_KEY]: value }, checked: {} }, actor.id, provenance, { path: "policy", latest: input.question });
        if (POLICY_KEY in saved.accepted.values) written.push(POLICY_KEY);
      }
    } else if ((row(POLICY_KEY)?.value ?? "").trim() !== "") {
      await writer.clearWrite(input.instanceId, [POLICY_KEY], actor.id, { path: "policy", latest: input.question });
      written.push(POLICY_KEY);
    }
  }

  // Type of Offense: the box the new account reads as; never over the manager's own tick.
  const current = row(OFFENSE_KEY)?.checked ?? [];
  let moved: { keys: string[] } | null = null;
  if (group && !managers(OFFENSE_KEY) && !(keys.length === current.length && keys.every((key) => current.includes(key)))) {
    const saved = await writer.draftWrite(input.instanceId, { values: {}, checked: { [OFFENSE_KEY]: keys } }, actor.id, {}, { path: "policy", latest: input.question });
    if (OFFENSE_KEY in saved.accepted.checked) {
      moved = { keys };
      written.push(OFFENSE_KEY);
    }
  }

  /*
   * Policy Violated follows the boxes (never a line the manager typed): the box this step ticked, or the one already on
   * the form when it is the box the new account reads as (QA's live 17x item 2a in the sibling app, 14 Nov 2026: the
   * made-about revision had ticked Standards of Conduct itself, so nothing "moved" here and Policy Violated stayed
   * Attendance).
   */
  const violated = row(VIOLATED_KEY);
  const boxes = moved ? moved.keys : current;
  const boxesAgree = keys.length > 0 && keys.length === boxes.length && keys.every((key) => boxes.includes(key));
  if (boxesAgree && !managers(VIOLATED_KEY) && fields.some((field) => field.key === VIOLATED_KEY)) {
    const derived = offenseCategoryValue({
      document,
      variantKey: loaded.instance.variantKey,
      checked: { [OFFENSE_KEY]: boxes },
      values: Object.fromEntries(loaded.values.map((value) => [value.fieldKey, value.value ?? ""])),
      sectionNames: boxSectionNames(sections.map((section) => section.heading)),
    });
    const next = derived ?? "";
    if (next !== (violated?.value ?? "").trim()) {
      if (next) {
        const saved = await writer.draftWrite(input.instanceId, { values: { [VIOLATED_KEY]: next }, checked: {} }, actor.id, formDerivedProvenance([VIOLATED_KEY]), { path: "policy" });
        if (VIOLATED_KEY in saved.accepted.values) written.push(VIOLATED_KEY);
      } else {
        await writer.clearWrite(input.instanceId, [VIOLATED_KEY], actor.id, { path: "policy", latest: input.question });
        written.push(VIOLATED_KEY);
      }
    }
  }

  // The Action Plan Ask Sunny built follows the policy now cited (`ca-action-plan.ts`, via the one writer).
  if (written.length > 0) written.push(...(await writer.syncPlan(input.instanceId, actor.id)));
  return written;
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
