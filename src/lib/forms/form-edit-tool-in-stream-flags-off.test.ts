import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * ============================================================================
 * FORM_EDIT_TOOL_IN_STREAM_ENABLED OFF: THE MAIN REQUEST, BYTE FOR BYTE
 * ============================================================================
 *
 * Ported from Ask Bubbles (c5534279, Step 3). The answering call
 * (`callClaude`) is given the same input it gets today — every optional
 * block, both history policies, a cached manual block and a full manual or
 * none, with the prompt cache and the truncation retry on and off — and every
 * request body the Anthropic client receives is recorded, with the text each
 * call returned. This app always streams the answering call
 * (`messages.create` with `stream: true`, read by `collectModelResult`), so
 * the double answers both as a finished message and as a stream of events.
 * With the flag off (unset, with only FORM_EDIT_SINGLE_WRITER_ENABLED on, and
 * the tool flag alone, which needs the single writer) the bodies are those of
 * Ask Sunny's main before this flag (66559725), recorded in
 * `form-edit-tool-in-stream-flags-off.main.json` (`RECORD_MAIN_FIXTURE=1` on
 * that commit rewrites it): no `tools`, no `tool_choice`, no DATA block.
 *
 * The chat route's half — the same chats with the flag off reach no tool and
 * never load `form-edit-tool` — is pinned by
 * `form-edit-single-writer-flags-off.test.ts` (its flag-off runs are main's
 * replies, rows and events byte for byte) and by the e2e test's flag-alone
 * case (`form-edit-tool-in-stream-e2e.test.ts`).
 */

const sent = vi.hoisted(() => ({ bodies: [] as string[], toolModule: 0, streamed: false }));

vi.mock("@/lib/forms/form-edit-tool", async (importOriginal) => {
  sent.toolModule += 1;
  return importOriginal();
});

// The fixture names the default model and effort, whatever the shell sets.
vi.mock("@/lib/config/models", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config/models")>()),
  CLAUDE_MODEL: "claude-sonnet-5",
  CLAUDE_EFFORT: "medium",
}));

vi.mock("@/lib/ai/anthropic", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/anthropic")>();
  const message = { stop_reason: "end_turn", content: [{ type: "text", text: "An answer." }], usage: { input_tokens: 1, output_tokens: 1 } };
  async function* events() {
    yield { type: "message_start", message: { usage: { input_tokens: 1, output_tokens: 0 } } };
    yield { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } };
    yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "An " } };
    yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "answer." } };
    yield { type: "content_block_stop", index: 0 };
    yield { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } };
    yield { type: "message_stop" };
  }
  return {
    ...actual,
    getAnthropicClient: () => ({
      messages: {
        create: async (body: unknown) => {
          sent.bodies.push(`create ${JSON.stringify(body)}`);
          return sent.streamed ? events() : message;
        },
      },
    }),
  };
});

const FLAGS = [
  "FORM_EDIT_TOOL_IN_STREAM_ENABLED",
  "FORM_EDIT_SINGLE_WRITER_ENABLED",
  "CHAT_TRACE_ENABLED",
  "PROMPT_CACHE_ENABLED",
  "TRUNCATION_RETRY_ENABLED",
  "FULL_MANUAL_CONTEXT_ENABLED",
] as const;
const saved = new Map<string, string | undefined>();
beforeAll(() => {
  for (const name of FLAGS) saved.set(name, process.env[name]);
});
afterAll(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function setFlags(on: readonly string[]) {
  for (const name of FLAGS) delete process.env[name];
  for (const name of on) process.env[name] = "true";
}

const HISTORY = [
  { role: "user", content: "Create a Corrective Action for Jane Doe, she was late to open on 10-20-26" },
  { role: "assistant", content: "Here is the Corrective Action Form for **Jane Doe**." },
  { role: "user", content: "   " },
];

/** Today's inputs to the answering call: every block, both history policies, a cached manual or none. Each body and each returned text. */
async function bodies(): Promise<string[]> {
  const { callClaude } = await import("@/lib/ai/call-claude");
  sent.bodies.length = 0;
  const texts: string[] = [];
  const base = {
    system: "You are the assistant.",
    grounding: "SOURCES\n\n[S1] JBA Policy Manual — p.4\nArrive on time.",
    reportData: "REPORT DATA\n\nnone",
    employeeData: "CURRENT EMPLOYEE PERFORMANCE DATA\n\nnone",
    personMemory: "WHAT THIS MANAGER SAID BEFORE\n\nnothing",
    formsLibrary: "FORMS LIBRARY\n\nCorrective Action Form",
    formRecords: "FORMS ON FILE\n\nnone",
    history: HISTORY,
    question: "fix her last name, it is Doe-Smith",
    maxTokens: 1200,
  };
  texts.push(await callClaude(base));
  texts.push(await callClaude({ ...base, historyPolicy: "budget", priorSummary: "She was late once before." }));
  texts.push(await callClaude({ ...base, manualBlock: "THE POLICY MANUAL\n\np.4 Arrive on time." }));
  texts.push(await callClaude({ ...base, fullManualBlock: "THE WHOLE POLICY MANUAL\n\np.4 Arrive on time." }));
  texts.push(await callClaude({ system: "plain", grounding: "", history: [], question: "what policy does that fall under?", maxTokens: 400 }));
  return [...sent.bodies, ...texts.map((text) => `text ${text}`)];
}

const FIXTURE = join("src", "lib", "forms", "form-edit-tool-in-stream-flags-off.main.json");
const RECORDING = process.env.RECORD_MAIN_FIXTURE === "1";

async function both(on: readonly string[]): Promise<{ message: string[]; stream: string[] }> {
  setFlags(on);
  sent.streamed = false;
  const message = await bodies();
  sent.streamed = true;
  const stream = await bodies();
  sent.streamed = false;
  return { message, stream };
}

describe("FORM_EDIT_TOOL_IN_STREAM_ENABLED off: the answering request, byte for byte", () => {
  const runs: Record<string, string[]> = {};

  it("plain and with the trace, cache, truncation and manual flags, a finished message and a stream; the flag unset, only the single writer on, and the tool flag alone", async () => {
    const plain = await both([]);
    const flagged = await both(["CHAT_TRACE_ENABLED", "PROMPT_CACHE_ENABLED", "TRUNCATION_RETRY_ENABLED", "FULL_MANUAL_CONTEXT_ENABLED"]);
    runs.plain = plain.message;
    runs.plainStream = plain.stream;
    runs.flagged = flagged.message;
    runs.flaggedStream = flagged.stream;
    if (RECORDING) {
      writeFileSync(FIXTURE, `${JSON.stringify(runs, null, 1)}\n`);
      return;
    }
    const writer = await both(["FORM_EDIT_SINGLE_WRITER_ENABLED"]);
    const writerFlagged = await both(["FORM_EDIT_SINGLE_WRITER_ENABLED", "CHAT_TRACE_ENABLED", "PROMPT_CACHE_ENABLED", "TRUNCATION_RETRY_ENABLED", "FULL_MANUAL_CONTEXT_ENABLED"]);
    // The tool flag alone is off too (it needs the single writer).
    const toolAlone = await both(["FORM_EDIT_TOOL_IN_STREAM_ENABLED", "CHAT_TRACE_ENABLED", "PROMPT_CACHE_ENABLED", "TRUNCATION_RETRY_ENABLED", "FULL_MANUAL_CONTEXT_ENABLED"]);

    expect(existsSync(FIXTURE), `${FIXTURE} is missing`).toBe(true);
    const main = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, string[]>;
    expect(runs.plain).toEqual(main.plain);
    expect(runs.plainStream).toEqual(main.plainStream);
    expect(runs.flagged).toEqual(main.flagged);
    expect(runs.flaggedStream).toEqual(main.flaggedStream);
    expect(writer.message).toEqual(main.plain);
    expect(writer.stream).toEqual(main.plainStream);
    expect(writerFlagged.message).toEqual(main.flagged);
    expect(writerFlagged.stream).toEqual(main.flaggedStream);
    expect(toolAlone.message).toEqual(main.flagged);
    expect(toolAlone.stream).toEqual(main.flaggedStream);
    Object.assign(runs, { writer: writer.message, writerStream: writer.stream, toolAlone: toolAlone.message, toolAloneStream: toolAlone.stream });
  });

  it.skipIf(RECORDING)("no tools, no tool_choice and no DATA block in any of them; form-edit-tool never loaded", () => {
    for (const body of Object.values(runs).flat()) {
      expect(body).not.toContain('"tools"');
      expect(body).not.toContain('"tool_choice"');
      expect(body).not.toContain("OPEN FORM DATA");
    }
    expect(Object.values(runs).flat().length).toBe(80);
    expect(sent.toolModule).toBe(0);
  });
});
