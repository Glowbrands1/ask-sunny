import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { collectModelResult } from "./call-claude";

/**
 * THE EXTRACTION, PINNED.
 *
 * `callClaude` was private to `server-ask.ts` until the Sales Totals analyser
 * needed it. The risk in moving it is not that it stops working — that shows up
 * immediately — but that it gets COPIED instead of shared, leaving two model
 * ids, two effort settings and two error contracts to drift apart.
 *
 * So this asserts the shape of the arrangement rather than the behaviour: one
 * module constructs a Claude request, both callers go through it, and neither
 * caller reads a credential.
 */

const CALL_CLAUDE = readFileSync("src/lib/ai/call-claude.ts", "utf8");
const SERVER_ASK = readFileSync("src/lib/ai/server-ask.ts", "utf8");
const ANALYZER = readFileSync(
  "src/lib/reporting/analysis/analyze-sales-totals.ts",
  "utf8",
);

describe("one module builds the Claude request", () => {
  it("is the only place messages.create is called", () => {
    expect(CALL_CLAUDE).toContain("client.messages.create");
    expect(SERVER_ASK).not.toContain("messages.create");
    expect(ANALYZER).not.toContain("messages.create");
  });

  it("is the only place the model and effort settings are read", () => {
    expect(CALL_CLAUDE).toMatch(/model: CLAUDE_MODEL/);
    expect(CALL_CLAUDE).toMatch(/effort: CLAUDE_EFFORT/);
    for (const caller of [SERVER_ASK, ANALYZER]) {
      expect(caller).not.toMatch(/CLAUDE_MODEL/);
      expect(caller).not.toMatch(/CLAUDE_EFFORT/);
    }
  });

  it("is the only place the Anthropic client is constructed", () => {
    expect(CALL_CLAUDE).toContain("getAnthropicClient");
    expect(SERVER_ASK).not.toContain("getAnthropicClient");
    expect(ANALYZER).not.toContain("getAnthropicClient");
  });

  it("is reached through an import by both callers", () => {
    expect(SERVER_ASK).toMatch(/import \{ callClaude \} from "\.\/call-claude"/);
    expect(ANALYZER).toMatch(/import \{ callClaude \} from "@\/lib\/ai\/call-claude"/);
  });
});

describe("the key never leaves the server and never reaches a message", () => {
  it("is server-only", () => {
    expect(CALL_CLAUDE.startsWith('import "server-only";')).toBe(true);
  });

  it("never reads the API key variable", () => {
    // Comments stripped first: these files EXPLAIN the key rule they must not
    // break, so matching the raw text would fail on the explanation.
    for (const source of [CALL_CLAUDE, SERVER_ASK, ANALYZER]) {
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code).not.toContain("ANTHROPIC_API_KEY");
      expect(code).not.toContain("process.env");
    }
  });
});

describe("a streamed reply records cache tokens and the first text token", () => {
  it("keeps cache reads from a later event and ignores a thinking delta", async () => {
    const started = Date.now();
    const result = await collectModelResult(
      {
        async *[Symbol.asyncIterator]() {
          yield {
            type: "message_start",
            message: {
              usage: {
                input_tokens: 10,
                cache_creation_input_tokens: 4,
                cache_read_input_tokens: 0,
                output_tokens: 0,
              },
            },
          };
          yield { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "hmm" } };
          yield { type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } };
          yield { type: "content_block_delta", delta: { type: "text_delta", text: " there" } };
          yield {
            type: "message_delta",
            delta: { stop_reason: "end_turn" },
            usage: { output_tokens: 3, cache_creation_input_tokens: null, cache_read_input_tokens: 8 },
          };
        },
      },
      started,
    );
    expect(result.text).toBe("Hello there");
    expect(result.stopReason).toBe("end_turn");
    expect(result.firstTokenMs).not.toBeNull();
    expect(result.usage).toMatchObject({
      input_tokens: 10,
      cache_creation_input_tokens: 4,
      cache_read_input_tokens: 8,
      output_tokens: 3,
    });
  });

  it("leaves first-token time empty when the caller returns a finished message", async () => {
    const result = await collectModelResult(
      {
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Hi" }],
        usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 2 },
      },
      Date.now(),
    );
    expect(result.text).toBe("Hi");
    expect(result.firstTokenMs).toBeNull();
    expect(result.usage).toMatchObject({ cache_read_input_tokens: 2 });
  });
});

describe("an SDK failure cannot echo the request back", () => {
  it("throws its own wording rather than the caught error's message", () => {
    const code = CALL_CLAUDE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const handler = code.slice(code.indexOf("} catch (error) {"));

    // The only message re-used is MissingConfigurationError's, which names
    // environment VARIABLES and never their values.
    const rethrown = handler.match(/error\.message/g) ?? [];
    expect(rethrown).toHaveLength(1);
    expect(handler).toMatch(/MissingConfigurationError/);
    expect(handler).toMatch(/Sunny could not reach the language model/);
  });
});
