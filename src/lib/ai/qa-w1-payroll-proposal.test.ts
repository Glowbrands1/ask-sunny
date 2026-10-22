import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope, ChatMessage } from "@/types";
/**
 * QA, 22 Oct 2026 — F-01 through the real proposal flow, turn by turn, with the
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
  const proposals: ({ payrollDeduct?: string | null; templateKey: string } | undefined)[] = [];
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

describe("QA F-01: the Corrective Action card never carries a Yes the manager did not give", () => {
  it.each([
    "create verbal ca for pat rivera, she was late today. we will not payroll deduct $25",
    "create verbal ca for pat rivera, she was late today. don't payroll deduct $25",
    "create verbal ca for pat rivera, she was late today. $25 payroll deduction was waived",
  ])("%s -> payroll No", async (text) => {
    const [proposal] = await conversation([text]);
    expect(proposal?.templateKey).toBe("dpoa");
    expect(proposal?.payrollDeduct).toBe("no");
  });

  it("an undecided deduction is asked, not answered", async () => {
    const [proposal] = await conversation(["create verbal ca for pat rivera, she was late today. maybe payroll deduct $25"]);
    expect(proposal?.templateKey).toBe("dpoa");
    expect(proposal?.payrollDeduct ?? null).toBeNull();
  });

  it("a later explicit correction changes No to Yes, and a waiver changes Yes to No", async () => {
    const proposals = await conversation([
      "create verbal ca for pat rivera, she was late today. we will not payroll deduct $25",
      "actually, payroll deduct $25",
      "sorry, the deduction was waived",
    ]);
    expect(proposals.map((proposal) => proposal?.payrollDeduct ?? null)).toEqual(["no", "yes", "no"]);
    expect(proposals.every((proposal) => proposal?.templateKey === "dpoa")).toBe(true);
  });
});
