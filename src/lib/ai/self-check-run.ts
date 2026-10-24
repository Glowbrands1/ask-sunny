import "server-only";

import { CLAUDE_HAIKU_MODEL } from "@/lib/config/models";
import { printedPageCitationEnabled, selfCheckEnabled } from "@/lib/config/chat-quality-flags";
import { displayName } from "@/lib/forms/employee-match";
import { loadScopedRoster, readDirectoryFacts } from "@/lib/forms/employee-roster";
import { SupabaseKnowledgeProvider } from "@/lib/knowledge/providers/supabase";

import { callClaudeTool } from "./call-claude";
import type { ChatActor } from "./form-proposal";
import { actionPlanIn, runSelfCheck } from "./self-check";
import type { AskRequest, AskResponse } from "./types";

/**
 * The validation pass before a reply leaves.
 *
 * Off, the response is returned as it was. A failed read or a failed repair
 * does not take the turn down: what cannot be checked is left, and what
 * failed the check is removed by the fallback.
 */

const REPAIR_SYSTEM = `You repair one assistant reply. Call repair_reply once.
For each cited section, read that chunk's own text and the manager's question. Set applies to false when the chunk's text limits the section to a situation the question does not describe. Omit that section from content, including a consequence stated only in that chunk. Judge only from the chunk text and the question.
An action plan, when you include one, is exactly two sentences.
employeeName is the name already on the reply, or a roster spelling of that same person. Never clear it because the roster has no row.
Do not invent a policy, a page, or a person. Do not refuse the form. If a part cannot be repaired, omit that part and leave the rest of the reply.`;

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
    const headings = chunks.flatMap((chunk) => {
      const page = citationPage(chunk);
      const label = chunk.section?.trim() || chunk.sections?.[0]?.heading?.trim() || "";
      return label && page ? [`${label} p.${page}`] : [];
    });
    const pageRule = printedPageCitationEnabled()
      ? "Cite a heading only when it is in the chunk list, and the page must be the printed page, never the PDF sheet number."
      : "Cite a heading only when it is in the chunk list, and the page must be that chunk's page.";
    const employeeName = response.formProposal?.employeeName ?? null;
    const settled = await runSelfCheck(
      {
        content: response.content,
        employeeName,
        actionPlan: actionPlanIn(response.content),
        chunks,
        roster,
        question: input.request.question,
      },
      (brief) =>
        callClaudeTool({
          model: CLAUDE_HAIKU_MODEL,
          system: `${pageRule}\n${REPAIR_SYSTEM}`,
          maxTokens: 700,
          tool: {
            name: "repair_reply",
            description: "The repaired reply, and whether each cited section's own text fits the question.",
            input_schema: {
              type: "object",
              additionalProperties: false,
              required: ["content", "employeeName", "actionPlan", "sections"],
              properties: {
                content: { type: "string" },
                employeeName: { type: ["string", "null"] },
                actionPlan: { type: ["string", "null"] },
                sections: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["heading", "applies"],
                    properties: {
                      heading: { type: "string" },
                      applies: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
          messages: [
            {
              role: "user",
              content: [
                brief.question ? `Question:\n${brief.question}` : "",
                `Failures:\n${brief.failures.map((failure) => failure.detail).join("\n")}`,
                `Cited sections:\n${brief.sections
                  .map((section) => `${section.heading} — page ${section.page ?? ""}\n${section.text}`)
                  .join("\n\n")}`,
                `Roster:\n${names.slice(0, 80).join("\n")}`,
                headings.length > 0 ? `Chunk pages:\n${headings.slice(0, 80).join("\n")}` : "",
                `Reply:\n${response.content.slice(0, 4000)}`,
              ]
                .filter((part) => part.trim())
                .join("\n\n"),
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

function citationPage(chunk: {
  readonly printedPage?: number | null;
  readonly page: number | null;
  readonly sections?: readonly { readonly heading: string; readonly page: number }[] | null;
}): number | null {
  if (typeof chunk.printedPage === "number" && chunk.printedPage > 0) return chunk.printedPage;
  if (printedPageCitationEnabled()) {
    const listed = chunk.sections?.find((section) => section.page > 0);
    return listed ? listed.page : null;
  }
  return typeof chunk.page === "number" && chunk.page > 0 ? chunk.page : null;
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
