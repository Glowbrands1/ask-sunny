import "server-only";

import { accountManualSections } from "@/lib/ai/account-manual-sections";
import { flaggedCitationWrite, NARRATIVE_CITATION_TEMPLATES } from "@/lib/ai/policy-citation-fields";
import { ACTIVE_BRAND } from "@/lib/brand";
import { formEditSingleWriterEnabled } from "@/lib/config/chat-quality-flags";
import { SupabaseKnowledgeProvider } from "@/lib/knowledge/providers/supabase";

import { draftFromRows } from "./form-reducer";
import { formLabels } from "./form-snapshot";
import { applyAssistantRevision, loadInstance, saveInstanceValues } from "./instances";

/**
 * ============================================================================
 * "PLEASE LIST THE POLICY" IN AN EDIT (EDIT_POLICY_ASK_ENABLED)
 * ============================================================================
 *
 * QA's live run (7 Nov 2026, Sonnet 5, 2×) of the sibling app's "I need you to make it about showing up late and
 * please list the policy make the date for 10/14/26." on an open Coaching Form: Details became "Showing up late"
 * and the Date stayed right, but the reply said nothing about the policy, in both modes. The patch reader reads
 * the account and the date; a policy is not something it writes ("Never invent … policy"), and the policy-change
 * path (`chat-policy-change.ts`) only changes a form with a Direct policy line, which a Coaching Form has not.
 *
 * With the flag on, the patch reader says whether the latest message asks for the policy (`policy_asked`, read
 * by the model, no phrase list), and this step answers that ask the way a first draft cites a policy on a
 * Coaching Form: the manual sections the account reads as (`accountManualSections`, the same readers), written
 * as the app's own "Policy reference: …, JBA Policy Manual p.N" line on the account field (`flaggedCitationWrite`,
 * the draft's own writer). The reply always says what happened to the ask:
 *
 *   - the line was added: "Listed the policy in <field>: <line>."
 *   - it was already there: "<field> already lists the policy: <line>."
 *   - no section matches the account, or the manual cannot be read: said so, and the manager is asked which
 *     policy applies. Nothing is guessed.
 *
 * Only the forms whose account field carries the citation line (Coaching, Follow-Up Coaching); a Corrective
 * Action's Direct policy line stays the policy-change path's. Never throws: a failure is the "couldn't" reply.
 */

export interface PolicyAskOutcome {
  /** The sentence the reply adds. */
  readonly sentence: string;
  /** The field the line was written to, when it was. */
  readonly written: string | null;
}

/** Whether this form's policy ask is this step's: a form whose account field carries the citation line. */
export function policyAskApplies(templateKey: string): boolean {
  return NARRATIVE_CITATION_TEMPLATES.includes(templateKey);
}

export async function answerPolicyAsk(input: {
  readonly instanceId: string;
  readonly actorId: string;
  readonly question: string;
}): Promise<PolicyAskOutcome | null> {
  try {
    const loaded = await loadInstance(input.instanceId);
    if (!loaded || loaded.instance.status !== "draft" || !policyAskApplies(loaded.instance.templateKey)) return null;
    const before = draftFromRows(loaded.values);
    const values: Record<string, string> = {};
    for (const [key, field] of Object.entries(before)) {
      if (typeof field.value === "string") values[key] = field.value;
    }
    const labels = formLabels(loaded);
    const jobTitle = values.job_title ?? null;
    const account = Object.values(values).join("\n");
    const notes = `${account}\n${input.question}`;

    let chunks: Parameters<typeof accountManualSections>[1] = [];
    try {
      const manual = await new SupabaseKnowledgeProvider().fetchOfficialPolicyManual(ACTIVE_BRAND.knowledgeScopeId);
      if (!manual.ok) return { sentence: COULD_NOT_READ, written: null };
      chunks = manual.chunks;
    } catch {
      return { sentence: COULD_NOT_READ, written: null };
    }
    if (accountManualSections(notes, chunks, jobTitle).length === 0) return { sentence: NO_SECTION, written: null };

    const cited = flaggedCitationWrite({ enabled: true, templateKey: loaded.instance.templateKey, values, notes, chunks });
    const key = Object.keys(cited.values).find((candidate) => cited.values[candidate] !== values[candidate]);
    const line = (text: string) => text.match(/Policy reference:\s*([^\n]+)/i)?.[1]?.trim() ?? "";
    if (!key) {
      const holder = Object.keys(values).find((candidate) => /Policy reference:/i.test(values[candidate] ?? ""));
      return holder
        ? { sentence: `${labels[holder] ?? holder} already lists the policy: ${line(values[holder]!)}.`, written: null }
        : { sentence: NO_SECTION, written: null };
    }
    const next = cited.values[key]!;
    const typed = before[key]?.owner === "manager";
    if (formEditSingleWriterEnabled()) {
      // The one writer, as code's own line (the manual's citation), the way the policy path writes one.
      const result = await (await import("./form-write")).writeFormEdits(
        input.instanceId,
        [{ op: "set", field: key, value: next, derived: true, ...(typed ? { by: "manager" as const } : {}) }],
        { path: "policy", actorId: input.actorId, latest: input.question, loaded },
      );
      if (result.handoff === "refused") return { sentence: NO_SECTION, written: null };
    } else {
      const write = { values: { [key]: next }, checked: {} };
      if (typed) await saveInstanceValues(input.instanceId, write, input.actorId);
      else {
        const result = await applyAssistantRevision(input.instanceId, write, [], input.actorId);
        if (!(key in result.accepted.values)) return { sentence: NO_SECTION, written: null };
      }
    }
    return { sentence: `Listed the policy in ${labels[key] ?? key}: ${line(next.slice(values[key]?.length ?? 0)) || line(next)}.`, written: key };
  } catch {
    return { sentence: COULD_NOT_READ, written: null };
  }
}

const NO_SECTION =
  "I didn't list a policy: nothing in the account points to a section of the policy manual. Tell me which policy applies and I'll add it from the manual.";
const COULD_NOT_READ = "I couldn't read the policy manual just now, so no policy is listed yet. Try again in a moment, or tell me which policy applies.";
