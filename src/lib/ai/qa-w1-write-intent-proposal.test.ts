import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope, ChatMessage } from "@/types";
/**
 * QA, 22 Oct 2026 — F-04 through the real proposal flow, turn by turn, with the
 * open form's template sent as the browser sends it. Synthetic people only.
 */

const store: FakeStore = { form_instances: [], form_instance_values: [], form_instance_events: [], form_template_versions: [], form_templates: [], form_template_current: [], form_template_assets: [] };
const state = vi.hoisted(() => ({ directory: [] as unknown[] }));

vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => fakeSupabase(store) }));
vi.mock("@/lib/forms/employee-roster", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/forms/employee-roster")>();
  return {
    ...actual,
    loadScopedRoster: async (scope: AccessScope | null) => actual.scopeRoster(state.directory as never, scope),
  };
});

process.env.NEXT_PUBLIC_DEMO_MODE = "false";
const { ensureTemplateLibrary, listTemplateSummaries } = await import("@/lib/forms/repository");
const { proposeFormForTurn } = await import("./form-proposal");

const SCOPE: AccessScope = { level: "salon", primaryAreaId: "loc-0310", alsoCoversAreaIds: [] };

async function conversation(turns: string[]) {
  const messages: ChatMessage[] = [];
  const proposals: ({ employeeName?: string | null; templateKey: string } | undefined)[] = [];
  let open: string | undefined;
  let n = 0;
  for (const text of turns) {
    n += 1;
    const response = await proposeFormForTurn({
      history: messages,
      question: text,
      questionMessageId: `u${n}`,
      actor: { role: "salon_director" as never, scope: SCOPE },
      summaries: await listTemplateSummaries(),
      today: "2026-10-21",
      policyManual: async () => null,
      ...(open ? { continueTemplateKey: open } : {}),
    });
    proposals.push(response?.formProposal);
    if (response?.formProposal) open = response.formProposal.templateKey;
    messages.push(
      { id: `u${n}`, role: "user", content: text, createdAt: "2026-10-21T18:00:00Z" } as ChatMessage,
      { id: `a${n}`, role: "assistant", content: response?.content ?? "", createdAt: "2026-10-21T18:00:01Z", ...(response?.formProposal ? { formProposal: response.formProposal } : {}) } as ChatMessage,
    );
  }
  return proposals;
}

beforeEach(async () => {
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  state.directory = [{ id: "e-1", firstName: "Pat", lastName: "Rivera", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0310"] }];
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-21T18:00:00Z"));
  await ensureTemplateLibrary("system");
});

describe("QA F-04: a writing request is not a Corrective Action request", () => {
  it("write a CA for <name> still proposes the Corrective Action Form", async () => {
    const [proposal] = await conversation(["write a CA for pat rivera, she was late today"]);
    expect(proposal?.templateKey).toBe("dpoa");
    expect(proposal?.employeeName?.toLowerCase()).toBe("pat rivera");
  });

  it.each([
    "can you write a summary of the corrective action policy",
    "write a note explaining the corrective action steps",
  ])("%s proposes no form", async (text) => {
    const [proposal] = await conversation([text]);
    expect(proposal).toBeUndefined();
  });

  it("mid-intake, a writing request about the CA does not start another form or change the employee", async () => {
    const proposals = await conversation([
      "write a CA for pat rivera, she was late today",
      "write an email to Sam Jones about the corrective action steps",
    ]);
    expect(proposals[0]?.templateKey).toBe("dpoa");
    for (const proposal of proposals.slice(1)) {
      if (proposal) {
        expect(proposal.templateKey).toBe("dpoa");
        expect(proposal.employeeName?.toLowerCase()).toBe("pat rivera");
      }
    }
  });
});
