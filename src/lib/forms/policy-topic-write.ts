import "server-only";

import { formatManualCitation, narrativeFieldOf } from "@/lib/ai/policy-citation-fields";
import { ACTIVE_BRAND } from "@/lib/brand";
import { formEditSingleWriterEnabled } from "@/lib/config/chat-quality-flags";
import { SupabaseKnowledgeProvider } from "@/lib/knowledge/providers/supabase";

import { draftFromRows } from "./form-reducer";
import { formLabels } from "./form-snapshot";
import { applyAssistantRevision, loadInstance, saveInstanceValues } from "./instances";
import type { ManualChunk } from "./official-policy-manual";
import { fieldNamedIn, policyFieldText, policyNamed, sectionForTopic } from "./policy-topic-field";

/**
 * POLICY_TOPIC_INTO_FIELD_ENABLED: the write of `policy-topic-field.ts` on a saved draft — the manual read, the section
 * for the topic quoted into the field the manager named (else the form's account field), as the app's own line, the
 * way EDIT_POLICY_ASK writes its citation (`edit-policy-ask.ts`). Never throws: a failure is the "couldn't" reply.
 */

export interface PolicyTopicOutcome {
  /** The sentence the reply says. */
  readonly sentence: string;
  /** The field written, when one was. */
  readonly written: string | null;
}

export async function writePolicyTopic(input: {
  readonly instanceId: string;
  readonly actorId: string;
  readonly question: string;
  readonly topic: string;
  /** The field the patch reader put the ask in, when it read one. */
  readonly readerField?: string | null;
}): Promise<PolicyTopicOutcome | null> {
  try {
    const loaded = await loadInstance(input.instanceId);
    if (!loaded || loaded.instance.status !== "draft") return null;
    const before = draftFromRows(loaded.values);
    const labels = formLabels(loaded);
    const key = fieldNamedIn(input.question, labels) ?? input.readerField ?? narrativeFieldOf(loaded.instance.templateKey);
    if (!key || !(key in labels)) return { sentence: noField(input.topic), written: null };
    const label = labels[key] ?? key;

    let chunks: readonly ManualChunk[] = [];
    try {
      const manual = await new SupabaseKnowledgeProvider().fetchOfficialPolicyManual(ACTIVE_BRAND.knowledgeScopeId);
      if (!manual.ok) return { sentence: couldNotRead(input.topic), written: null };
      chunks = manual.chunks;
    } catch {
      return { sentence: couldNotRead(input.topic), written: null };
    }
    const section = sectionForTopic(input.topic, chunks);
    if (!section) return { sentence: noSection(input.topic, label), written: null };

    const block = policyFieldText(section, chunks);
    const current = typeof before[key]?.value === "string" ? (before[key]!.value as string).trim() : "";
    const cited = formatManualCitation(section.heading, section.page);
    if (current.includes(block.split("\nPolicy reference:")[0]!)) {
      return { sentence: `${label} already has our ${policyNamed(section.heading)} (${cited}).`, written: null };
    }
    const next = current ? `${current}\n\n${block}` : block;
    const typed = before[key]?.owner === "manager";
    if (formEditSingleWriterEnabled()) {
      const result = await (await import("./form-write")).writeFormEdits(
        input.instanceId,
        [{ op: "set", field: key, value: next, derived: true, ...(typed ? { by: "manager" as const } : {}) }],
        { path: "policy", actorId: input.actorId, latest: input.question, loaded },
      );
      if (result.handoff === "refused") return { sentence: couldNotWrite(input.topic, label), written: null };
    } else {
      const write = { values: { [key]: next }, checked: {} };
      if (typed) await saveInstanceValues(input.instanceId, write, input.actorId);
      else {
        const result = await applyAssistantRevision(input.instanceId, write, [], input.actorId);
        if (!(key in result.accepted.values)) return { sentence: couldNotWrite(input.topic, label), written: null };
      }
    }
    return { sentence: `Added our ${policyNamed(section.heading)} to ${label}, from the manual (${cited}).`, written: key };
  } catch {
    return { sentence: couldNotRead(input.topic), written: null };
  }
}

const noSection = (topic: string, label: string) =>
  `I couldn't find a section of the policy manual on ${topic}, so I left ${label} as it was. Which policy should go there? Tell me its name, or paste the text, and I'll add it.`;
const noField = (topic: string) => `Which part of the form should our policy on ${topic} go in? Tell me and I'll add it from the manual.`;
const couldNotRead = (topic: string) =>
  `I couldn't read the policy manual just now, so our policy on ${topic} isn't on the form yet. Try again in a moment, or paste the text and I'll add it.`;
const couldNotWrite = (topic: string, label: string) =>
  `I couldn't add our policy on ${topic} to ${label}. Paste the text and I'll add it, or try again in a moment.`;
