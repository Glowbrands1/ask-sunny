/**
 * ============================================================================
 * A BENEFITS "WARNING" NEVER GOES ONTO A CORRECTIVE ACTION (QA, 5 Nov 2026, severe)
 * ============================================================================
 *
 * Ported from the sibling app (QA, 5 Nov 2026). A real location manager there, in a revision of a finalized Corrective Action Form:
 * "in the previously recieved coaching include that <name> signed the jba policy
 * manual on 10-15-26". The reply said Direct policy "now cites Standards of
 * Conduct (page 12) and Warning (page 36)", and the saved policy_language quoted
 * the manual's 401k sheet headed "Warning" (current income taxes, legal retirement
 * age, an IRA). The date was not added.
 *
 * Root cause (`forms/chat-policy-change.ts`): "include THAT <name> signed …" read
 * as a reference back ("that"), and the nearest earlier turn naming a manual
 * heading was the app's own "Is this new corrective action a **Verbal Warning**
 * or a **Written Warning**?" — the manual's heading "Warning". The message's only
 * "policy" is the manual's own name.
 *
 * The manager's words, with the harness's invented person for the real one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * EDITING AN OPEN CORRECTIVE ACTION FORM FROM THE CONVERSATION
 * ============================================================================
 *
 * Production feedback, 20 Oct 2026. With a Corrective Action Form for Wren
 * Halvorsen open, "can you add late opening policy to the direct policy
 * section of this from" was answered "No form has been created yet", and the
 * manager was told to create the form again. A manager has to be able to add
 * or swap a policy, change a detail, and answer a question — on the form that
 * is open — without starting another one.
 *
 * End to end through the real proposal, creation and draft routes against the
 * fake database and the real JBA manual fixture; then the chat handlers the
 * route tries, in the order it tries them.
 */

const store: FakeStore = {
  form_instances: [],
  form_instance_values: [],
  form_instance_events: [],
  form_template_versions: [],
  form_templates: [],
  form_template_current: [],
  form_template_assets: [],
};

const state = vi.hoisted(() => ({
  role: "salon_director",
  scope: null as unknown,
  toolValues: {} as Record<string, string>,
  toolChecked: {} as Record<string, string[]>,
  systems: [] as string[],
  manualOk: true,
}));

vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => fakeSupabase(store) }));

vi.mock("@/lib/api/respond", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/respond")>();
  return {
    ...actual,
    assertLiveMode: () => {},
    assertNoConfigurationProblems: () => {},
    assertWithinRateLimit: () => {},
  };
});

vi.mock("@/lib/auth/server", async () => {
  const { AuthError } = await import("@/lib/auth/types");
  const { DEFAULT_PERMISSION_MATRIX, hasPermission } = await import("@/lib/permissions");
  return {
    authorizeRequest: async (_request: Request, permission: string) => {
      if (!hasPermission(DEFAULT_PERMISSION_MATRIX, state.role as never, permission as never)) {
        throw new AuthError("forbidden", "Your role does not have permission to do that.");
      }
      return {
        identity: {
          subject: "manager-1",
          email: "manager@example.com",
          displayName: "Manager",
          role: state.role,
          scope: state.scope,
          verified: true,
        },
        permission,
        provider: "supabase",
      };
    },
  };
});

vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async (request: { system: string }) => {
        state.systems.push(request.system);
        return {
          content: [{ type: "tool_use", name: "write_form_fields", input: { values: state.toolValues, checked: state.toolChecked } }],
        };
      },
    },
  }),
}));

vi.mock("@/lib/knowledge/providers/supabase", async () => {
  const { JBA_MANUAL_CHUNKS, JBA_MANUAL_DOCUMENT } = await import("@/lib/ai/__fixtures__/jba-policy-manual");
  return {
    SupabaseKnowledgeProvider: class {
      async search() {
        return [];
      }
      async fetchRoleGrounding() {
        const row = (index: number, locator: string, content: string) => ({
          chunk_id: `pmf-${index}`,
          document_id: "doc-progression",
          document_title: "ASK SUNNY PERFORMANCE MANAGEMENT FRAMEWORK KB TEXT",
          category: "leadership_coaching",
          locator,
          page: null,
          section: null,
          content,
          similarity: 0,
        });
        return {
          ok: true,
          grounding: {
            role: { id: "performance_management_framework" },
            documentId: "doc-progression",
            documentTitle: "ASK SUNNY PERFORMANCE MANAGEMENT FRAMEWORK KB TEXT",
            matchedBy: "tag",
            rows: [
              row(0, "SECTION 2 – PERFORMANCE MANAGEMENT LADDER", "Solve the issue at the lowest appropriate level."),
              row(1, "10.7 Final operating rule for Ask Sunny", "Classify the issue before escalating."),
            ],
            presentGroups: ["escalation_ladder", "final_operating_rule"],
          },
        };
      }
      async fetchOfficialPolicyManual() {
        if (!state.manualOk) return { ok: false, reason: "down" };
        return {
          ok: true,
          documentId: JBA_MANUAL_DOCUMENT.id,
          documentTitle: JBA_MANUAL_DOCUMENT.title,
          matchedBy: "tag",
          chunks: JBA_MANUAL_CHUNKS,
        };
      }
    },
  };
});

vi.mock("@/lib/knowledge", () => ({
  getKnowledgeProvider: () => {
    throw new Error("getKnowledgeProvider() is the browser knowledge client and must not be used on the server");
  },
}));

process.env.NEXT_PUBLIC_DEMO_MODE = "false";

const { ensureTemplateLibrary, listTemplateSummaries } = await import("@/lib/forms/repository");
const { proposeFormForTurn } = await import("@/lib/ai/form-proposal");
const { createInlineForm } = await import("@/features/chat/create-inline-form");
const { changeActiveFormPolicy } = await import("@/lib/forms/chat-policy-change");
const instancesRoute = await import("./instances/route");
const instanceRoute = await import("./instances/[id]/route");
const draftRoute = await import("./instances/[id]/draft/route");

function joinOverview() {
  for (const row of store.form_instances ?? []) {
    const template = store.form_templates!.find((entry) => entry.id === row.template_id);
    const version = store.form_template_versions.find((entry) => entry.id === row.template_version_id);
    Object.assign(row, {
      form_date: row.form_date ?? "2026-10-20",
      template_key: template?.key,
      template_name: template?.name,
      layout_family: template?.layout_family,
      template_version: version?.version,
    });
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const request = new Request(`https://app.test${url}`, init);
  const draft = /^\/api\/forms\/instances\/([^/]+)\/draft$/.exec(url);
  const response = draft
    ? await draftRoute.POST(request, { params: Promise.resolve({ id: draft[1]! }) })
    : url === "/api/forms/instances"
      ? await instancesRoute.POST(request)
      : null;
  if (!response) throw new Error(`no route for ${url}`);
  joinOverview();
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

async function review(id: string) {
  joinOverview();
  const response = await instanceRoute.GET(new Request(`https://app.test/api/forms/instances/${id}`), {
    params: Promise.resolve({ id }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as {
    values: { fieldKey: string; value: string | null; checked: string[]; filledBy: string; provenance?: Record<string, unknown> }[];
  };
}

const row = async (id: string, key: string) => (await review(id)).values.find((entry) => entry.fieldKey === key);

let sequence = 0;
const said = (content: string): ChatMessage => ({
  id: `m${(sequence += 1)}`,
  role: "user",
  content,
  createdAt: "2026-10-20T15:00:00Z",
});

const chat = () => new Request("https://app.test/api/chat", { method: "POST" });

/**
 * A verbal warning for Wren, created in chat. The account says she was late
 * rather than naming Late Opening, so the first draft cites Attendance and the
 * Late Opening section is what the conversation then asks to add. (Named in
 * the account, the first draft cites Late Opening by itself — see
 * `DESCRIBED_SECTIONS`.)
 */
async function createdForm() {
  const message = said("create corrective action for Wren Halvorsen, she was late to work today. It is a verbal warning");
  const response = await proposeFormForTurn({
    history: [],
    question: message.content,
    questionMessageId: message.id,
    actor: { role: state.role as never, scope: state.scope as AccessScope },
    summaries: await listTemplateSummaries(),
    today: "2026-10-20",
  });
  const proposal = response!.formProposal!;
  expect(proposal.templateKey).toBe("dpoa");
  expect(proposal.employeeName).toBe("Wren Halvorsen");
  const result = await createInlineForm({ proposal, messages: [message], call, onCreated: () => {} });
  joinOverview();
  const id = (store.form_instances ?? [])[0]!.id as string;
  const history: ChatMessage[] = [
    message,
    { id: "a1", role: "assistant", content: response!.content, createdAt: "2026-10-20T15:00:01Z", formProposal: proposal } as ChatMessage,
  ];
  return { id, result, history };
}

beforeEach(async () => {
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  state.role = "salon_director";
  state.scope = { level: "salon", primaryAreaId: "loc-0310", alsoCoversAreaIds: [] };
  state.toolValues = { observation: "Observed: Wren did not open the salon on time.\nExpectation: Open on time.\nGoing Forward: Wren will open on time." };
  state.toolChecked = { warning_type: ["verbal"], offense_type: ["tardiness"] };
  state.systems = [];
  state.manualOk = true;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-20T15:00:00Z"));
  await ensureTemplateLibrary("system");
});

const answered = (content: string): ChatMessage =>
  ({ id: `a${(sequence += 1)}`, role: "assistant", content, createdAt: "2026-10-20T15:00:01Z" }) as ChatMessage;

const ASKS_LEVEL = "Is this new corrective action a **Verbal Warning** or a **Written Warning**? Tell me here, or tick it on the form — I won't choose it for you.";
const QUESTION = "in the previously recieved coaching include that wren halvorsen signed the jba policy manual on 10-15-26";

async function theFlow() {
  const { id, history } = await createdForm();
  const turns = [...history, answered(ASKS_LEVEL), said("wren did not acknowledge woven policies by the due date 10/31")];
  const answer = await changeActiveFormPolicy({ request: chat(), instanceId: id, question: QUESTION, history: turns });
  return { id, answer, turns };
}

describe("ported from the sibling app (QA, 5 Nov 2026): the manager's revision never cites the manual's benefits \"Warning\"", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("off (main): this app never cites the benefits sheet (\"warning\" is in policy-change.ts NOT_A_SECTION), but the turn is still taken as a policy change — \"I couldn't find a section called …\" — and the revision never runs", async () => {
    const { id, answer } = await theFlow();
    expect(answer?.content).toMatch(/^I couldn't find a section called "wren halvorsen signed the jba"/);
    expect(answer?.content ?? "").not.toMatch(/\*\*Warning\*\*/);
    expect((await row(id, "policy_language"))?.value ?? "").not.toMatch(/legal retirement age/);
  });

  it("on: the message is not a policy change (its only \"policy\" is the manual's own name); nothing is cited", async () => {
    vi.stubEnv("POLICY_CHANGE_RELEVANT_ENABLED", "true");
    const { id, answer } = await theFlow();
    expect(answer).toBeNull();
    expect((await row(id, "policy_language"))?.value ?? "").not.toMatch(/legal retirement age|income taxes|IRA/);
  });

  it("on: \"add that policy to the form too\" after the app's warning-level question never reaches back to **Warning**", async () => {
    vi.stubEnv("POLICY_CHANGE_RELEVANT_ENABLED", "true");
    const { id, history } = await createdForm();
    const answer = await changeActiveFormPolicy({ request: chat(), instanceId: id, question: "add that policy to the form too", history: [...history, answered(ASKS_LEVEL)] });
    expect(answer?.content ?? "").not.toMatch(/\*\*Warning\*\* \(page/);
    expect((await row(id, "policy_language"))?.value ?? "").not.toMatch(/legal retirement age/);
  });

  it("negative, on: \"add the late opening policy\" is added as before", async () => {
    vi.stubEnv("POLICY_CHANGE_RELEVANT_ENABLED", "true");
    const { id, history } = await createdForm();
    const answer = await changeActiveFormPolicy({ request: chat(), instanceId: id, question: "add the late opening policy", history });
    expect(answer?.content).toMatch(/Late Opening/);
    expect(answer?.content ?? "").not.toMatch(/\*\*Warning\*\*/);
  });
});
