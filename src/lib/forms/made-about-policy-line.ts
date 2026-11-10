import "server-only";

import { flaggedCitationWrite } from "@/lib/ai/policy-citation-fields";
import { ACTIVE_BRAND } from "@/lib/brand";
import { formEditSingleWriterEnabled } from "@/lib/config/chat-quality-flags";
import { SupabaseKnowledgeProvider } from "@/lib/knowledge/providers/supabase";

import { splitAppCitationLine } from "./app-citation-line";
import { draftFromRows } from "./form-reducer";
import { applyAssistantRevision, loadInstance } from "./instances";

/**
 * MADE_ABOUT_POLICY_LINE_ENABLED (QA's live round-11 test, 9 Nov 2026; the person invented): on a saved Coaching draft
 * whose Details ended "Policy reference: Attendance Policy, JBA Policy Manual p.14", "make it about leaving the front desk
 * unattended on 11/6/26" rewrote Details and the line went with the old account; no reference to the new one was written.
 * The account rewritten, its policy reference is written again from the new account: the manual's section and the page it
 * prints, as the card cites it (`ai/policy-citation-fields.ts`), as the app's own line. No section found: none, rather than
 * the old account's. Never over a line the new account already carries. Returns the field written, or null.
 */
export async function rewriteMadeAboutPolicyLine(input: {
  readonly instanceId: string;
  readonly actorId: string;
  readonly question: string;
  readonly accountKey: string;
  /**
   * MADE_ABOUT_REWRITE_FINISHES_ENABLED: the old account's line. Kept by the revision on the new account, it is not the new
   * account's reference: it is taken off and the reference is read again.
   */
  readonly oldLine?: string | null;
  /** MADE_ABOUT_POLICY_LINE_REPLACES_ENABLED: every policy line the rewritten account carries is taken off, wherever it sits. */
  readonly replaceAnywhere?: boolean;
}): Promise<string | null> {
  try {
    const loaded = await loadInstance(input.instanceId);
    if (!loaded || loaded.instance.status !== "draft") return null;
    const before = draftFromRows(loaded.values);
    const saved = typeof before[input.accountKey]?.value === "string" ? (before[input.accountKey]!.value as string) : "";
    const split = splitAppCitationLine(saved);
    /*
     * MADE_ABOUT_POLICY_LINE_REPLACES_ENABLED (QA's live Sunny round 15, 10 Nov 2026): after "I need you to make it about
     * showing up late" wrote "Policy reference: Attendance Policy, JBA Policy Manual p.14", "make it about leaving the front
     * desk unattended on 11/6/26" saved "Policy reference: Standards of Conduct Policy, JBA Policy Manual p.13; Attendance
     * Policy, JBA Policy Manual p.14": the revision kept the old line in a shape the splitter does not read as the app's own
     * (a trailing period, or not the last paragraph), so it stayed in the account and the new reference was read from it
     * too. Every "Policy reference: …" line the rewritten account carries is the old account's: all are taken off, wherever
     * they sit, and the reference is read again from the new account's own words alone.
     */
    const stripped = input.replaceAnywhere ? withoutPolicyLines(saved) : null;
    const anywhere = stripped !== null && stripped !== saved.trim();
    const keptOld = anywhere || (input.oldLine != null && split.line !== null && split.line === input.oldLine);
    const account = anywhere ? stripped : keptOld ? split.body : saved;
    if (!account.trim() || (!keptOld && split.line !== null)) return null;
    const manual = await new SupabaseKnowledgeProvider().fetchOfficialPolicyManual(ACTIVE_BRAND.knowledgeScopeId);
    if (!manual.ok) return null;
    const cited = flaggedCitationWrite({
      enabled: true,
      templateKey: loaded.instance.templateKey,
      values: { [input.accountKey]: account },
      notes: `${account}\n${input.question}`,
      chunks: manual.chunks,
    });
    const cited_ = cited.values[input.accountKey];
    // The old account's line taken off and no section found: the account without it, rather than the old reference.
    const next = cited_ && cited_ !== account ? cited_ : keptOld ? account : null;
    if (!next || next === saved) return null;
    if (formEditSingleWriterEnabled()) {
      // The one writer, as code's own line (the manual's citation), the way the policy path writes one.
      const result = await (await import("./form-write")).writeFormEdits(
        input.instanceId,
        [{ op: "set", field: input.accountKey, value: next, derived: true }],
        { path: "policy", actorId: input.actorId, latest: input.question, loaded },
      );
      return result.handoff === "refused" ? null : input.accountKey;
    } else {
      const result = await applyAssistantRevision(input.instanceId, { values: { [input.accountKey]: next }, checked: {} }, [], input.actorId);
      return input.accountKey in result.accepted.values ? input.accountKey : null;
    }
  } catch {
    return null;
  }
}

/** MADE_ABOUT_POLICY_LINE_REPLACES_ENABLED: the text without any "Policy reference: …" line, wherever it sits. */
export function withoutPolicyLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*Policy reference:/i.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
