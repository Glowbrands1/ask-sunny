import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toChatTurnError } from "@/features/chat/chat-error";
import { AiError } from "@/lib/ai/errors";
import { ClaudeProvider } from "@/lib/ai/claude-provider";
import { isEmptyReply } from "@/lib/ai/empty-reply";

/**
 * QA, full chat history (Ask Sunny): 11 assistant turns with no text, in five
 * conversations — four policy questions, a pasted prescreen summary, "Which
 * salons need attention today?", "create a coaching document for <name>"
 * twice, and an incident pasted four times.
 *
 * Every one of those rows stored `content: ""` beside `metadata.error`, which
 * the thread renders as an error card ("No answer was produced"). None was a
 * blank answer. What the history could not say was WHY: the client folded the
 * server's 401s, 500s and non-JSON platform errors into the same
 * "model_failed" card and dropped the code and status.
 *
 * The rule these tests pin: a turn never saves or shows an empty assistant
 * reply. A blank answer becomes an honest error, and the stored error keeps
 * what the server said.
 */

const ORIGINAL = { ...process.env };

interface Seen {
  updates: Record<string, unknown>[];
}

async function loadRoute(answer: Record<string, unknown>) {
  vi.resetModules();
  const seen: Seen = { updates: [] };
  vi.doMock("@/lib/auth/server", () => ({
    authorizeRequest: async (_request: Request, permission: string) => ({
      identity: {
        subject: "user-1",
        email: "manager@example.com",
        displayName: "Manager",
        role: "admin",
        scope: { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] },
        verified: true,
      },
      permission,
      provider: "supabase",
    }),
  }));
  vi.doMock("@/lib/ai/server-ask", () => ({
    answerQuestion: async () => answer,
  }));
  vi.doMock("@/lib/supabase/server", () => ({
    getSupabaseAdmin: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
        }),
        insert: async () => ({ error: null }),
        update: (values: Record<string, unknown>) => ({
          eq: async () => {
            seen.updates.push(values);
            return { error: null };
          },
        }),
      }),
    }),
  }));
  const route = await import("./route");
  return { route, seen };
}

function ask(question: string): Request {
  return new Request("https://app.test/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question, surface: "main_chat" }),
  });
}

beforeEach(() => {
  vi.resetModules();
  process.env.NEXT_PUBLIC_DEMO_MODE = "false";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  process.env.SUPABASE_SECRET_KEY = ["sb", "secret", "TESTFIXTURE"].join("_");
  process.env.ANTHROPIC_API_KEY = "test";
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.doUnmock("@/lib/auth/server");
  vi.doUnmock("@/lib/ai/server-ask");
  vi.doUnmock("@/lib/supabase/server");
  vi.unstubAllGlobals();
  vi.resetModules();
});

const BLANK = { content: "", citations: [], recommendedVideoIds: [] };

describe("a blank answer is returned as an honest failure (EMPTY_REPLY_GUARD_ENABLED)", () => {
  it("'Which salons need attention today?' with no prose and no card is a failed turn, not a 200", async () => {
    process.env.EMPTY_REPLY_GUARD_ENABLED = "true";
    const { route, seen } = await loadRoute(BLANK);
    const response = await route.POST(ask("Which salons need attention today?"));
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload.code).toBe("model_failed");
    expect(payload.content).toBeUndefined();
    // The turn is closed as failed, so the answer rate stays honest.
    expect(seen.updates.some((values) => values.succeeded === false)).toBe(true);
  });

  it("whitespace is blank too", async () => {
    process.env.EMPTY_REPLY_GUARD_ENABLED = "true";
    const { route } = await loadRoute({ ...BLANK, content: " \n\n " });
    const response = await route.POST(ask("whats policy about smoke breaks"));
    expect(response.status).toBe(502);
  });

  it("a form card with a short line is an answer and is returned as it is", async () => {
    process.env.EMPTY_REPLY_GUARD_ENABLED = "true";
    const formProposal = { status: "needs_location", templateKey: "coaching", templateName: "Coaching Form" };
    const { route } = await loadRoute({ ...BLANK, formProposal });
    const response = await route.POST(ask("create a coaching document for Test Employee"));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.formProposal.templateKey).toBe("coaching");
  });

  it("off, the route returns the answer exactly as before", async () => {
    delete process.env.EMPTY_REPLY_GUARD_ENABLED;
    const { route } = await loadRoute(BLANK);
    const response = await route.POST(ask("Which salons need attention today?"));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.content).toBe("");
  });

  it("reads blank the same way everywhere", () => {
    expect(isEmptyReply(BLANK)).toBe(true);
    expect(isEmptyReply({ ...BLANK, content: "The waiver is required." })).toBe(false);
    expect(isEmptyReply({ ...BLANK, formSelection: { options: [] } as never })).toBe(false);
    expect(isEmptyReply(null)).toBe(true);
  });
});

describe("the browser never renders a 200 without an answer as a blank bubble", () => {
  it("a 200 whose body is not an answer becomes a failed turn with an error card", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>gateway</html>", { status: 200, headers: { "content-type": "text/html" } })),
    );
    const question = "create a coaching document for Test Employee";
    const caught = await new ClaudeProvider()
      .ask({ question, mode: "standard", history: [] } as never)
      .catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(AiError);
    const turn = toChatTurnError(caught, question);
    expect(turn.kind).toBe("model_failed");
    expect(turn.message.length).toBeGreaterThan(0);
    expect(turn.retryable).toBe(true);
  });

  it("a real answer passes through untouched", async () => {
    const body = { content: "Bereavement leave is in the manual.", citations: [], recommendedVideoIds: [] };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
    const answer = await new ClaudeProvider().ask({ question: "what's policy on bereavement" } as never);
    expect(answer.content).toBe(body.content);
  });
});

describe("the stored error says what the server said", () => {
  it("an expired session reads as signed out, not as 'could not produce an answer… try again'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "You are not signed in.", code: "unauthenticated" }), { status: 401 }),
      ),
    );
    const question = "create a coaching document for Test Employee";
    const caught = await new ClaudeProvider().ask({ question } as never).catch((error: unknown) => error);
    const turn = toChatTurnError(caught, question);

    expect(turn.kind).toBe("unauthenticated");
    expect(turn.message).toBe("You are not signed in.");
    expect(turn.retryable).toBe(false);
    expect(turn.status).toBe(401);
    expect(turn.code).toBe("unauthenticated");
  });

  it("a platform error with no JSON body keeps its status on the stored turn", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("An error occurred", { status: 504 })));
    const question = "Which salons need attention today?";
    const caught = await new ClaudeProvider().ask({ question } as never).catch((error: unknown) => error);
    const turn = toChatTurnError(caught, question);

    expect(turn.kind).toBe("model_failed");
    expect(turn.status).toBe(504);
    expect(turn.code).toBe("model_failed");
  });
});
