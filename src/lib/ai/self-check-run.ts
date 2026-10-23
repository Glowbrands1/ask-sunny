import "server-only";

import { CLAUDE_HAIKU_MODEL } from "@/lib/config/models";
import { selfCheckEnabled } from "@/lib/config/chat-quality-flags";
import { displayName } from "@/lib/forms/employee-match";
import { loadScopedRoster, readDirectoryFacts } from "@/lib/forms/employee-roster";
import { SupabaseKnowledgeProvider } from "@/lib/knowledge/providers/supabase";

import { callClaudeTool } from "./call-claude";
import type { ChatActor } from "./form-proposal";
import { actionPlanIn, reviewOutgoing, runSelfCheck } from "./self-check";
import type { AskRequest, AskResponse } from "./types";

/**
 * The validation pass before a reply leaves.
 *
 * Off, the response is returned as it was. A failed read or a failed repair
 * does not take the turn down: what cannot be checked is left, and what
 * failed the check is removed by the fallback.
 */

const REPAIR_SYSTEM = `You repair one assistant reply. Call repair_reply once.
Cite a policy and page only when that heading and page are in the chunk list.
An action plan, when you include one, is exactly two sentences.
employeeName is a roster name from the list, or null.
Do not invent a policy, a page, or a person. If a part cannot be repaired, omit it.`;

export async function guardReply(
  response: AskResponse,
  input: { readonly request: AskRequest; readonly actor: ChatActor },
): Promise<AskResponse> {
  if (!selfCheckEnabled()) return response;
  try {
    const [chunks, roster] = await Promise.all([
      loadChunks(input.request.scopeId),
      loadRoster(input.actor),
    ]);
    const names = roster?.map((person) => displayName(person)) ?? [];
    const headings = chunks.flatMap((chunk) => [
      ...(chunk.section ? [chunk.section] : []),
      ...(chunk.sections ?? []).map((section) => `${section.heading} p.${section.page}`),
    ]);
    const employeeName = response.formProposal?.employeeName ?? null;
    const settled = await runSelfCheck(
      {
        content: response.content,
        employeeName,
        actionPlan: actionPlanIn(response.content),
        chunks,
        roster,
      },
      () =>
        callClaudeTool({
          model: CLAUDE_HAIKU_MODEL,
          system: REPAIR_SYSTEM,
          maxTokens: 700,
          tool: {
            name: "repair_reply",
            description: "The repaired reply. Omit anything you cannot support from the lists.",
            input_schema: {
              type: "object",
              additionalProperties: false,
              required: ["content", "employeeName", "actionPlan"],
              properties: {
                content: { type: "string" },
                employeeName: { type: ["string", "null"] },
                actionPlan: { type: ["string", "null"] },
              },
            },
          },
          messages: [
            {
              role: "user",
              content: `Failures:\n${reviewOutgoing({
                content: response.content,
                employeeName,
                actionPlan: actionPlanIn(response.content),
                chunks,
                roster,
              })
                .map((failure) => failure.detail)
                .join("\n")}\n\nRoster:\n${names.slice(0, 80).join("\n")}\n\nChunks:\n${headings.slice(0, 80).join("\n")}\n\nReply:\n${response.content.slice(0, 4000)}`,
            },
          ],
        }),
    );
    const proposal = response.formProposal;
    const employeeChanged = proposal && settled.employeeName !== proposal.employeeName;
    return {
      ...response,
      content: settled.content,
      ...(employeeChanged && proposal
        ? {
            formProposal: {
              ...proposal,
              employeeName: settled.employeeName,
              status: settled.employeeName ? proposal.status : "needs_employee",
            },
          }
        : {}),
    };
  } catch {
    return response;
  }
}

async function loadChunks(scopeId: string) {
  try {
    const manual = await new SupabaseKnowledgeProvider().fetchOfficialPolicyManual(scopeId);
    return manual.ok ? manual.chunks : [];
  } catch {
    return [];
  }
}

async function loadRoster(actor: ChatActor) {
  try {
    const facts = await readDirectoryFacts(actor.scope);
    if (facts.length > 0) return facts;
    return await loadScopedRoster(actor.scope);
  } catch {
    return null;
  }
}
