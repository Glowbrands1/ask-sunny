import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { recordingKey, replayTransport } from "./replay";

/** AI_READS_CODE_CHECKS_ENABLED: the recorded replies the gate runs offline. */

const call = {
  model: "claude-haiku-4-5",
  system: "system",
  maxTokens: 600,
  timeoutMs: 2_000,
  tool: { name: "record_form_reading", description: "d", input_schema: { type: "object" as const } },
  messages: [{ role: "user" as const, content: "create a ca for quinn marlowe" }],
};
const usage = { inputTokens: 5000, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 };

describe("replayTransport", () => {
  it("keys a call by model, system, tool and the user content", () => {
    expect(recordingKey(call)).toBe(recordingKey({ ...call, maxTokens: 10 }));
    expect(recordingKey(call)).not.toBe(recordingKey({ ...call, messages: [{ role: "user", content: "create a ca for dale ferris" }] }));
  });

  it("replays a recording, and fails a missing or slow one so the turn runs as flag off", async () => {
    const dir = mkdtempSync(join(tmpdir(), "reader-"));
    const transport = replayTransport(dir, "replay");
    await expect(transport.call(call)).rejects.toThrow("no recording");
    const key = recordingKey(call);
    writeFileSync(join(dir, `${key}.json`), JSON.stringify({ key, model: call.model, reply: { employee: null }, usage, ms: 900 }));
    expect(await transport.call(call)).toEqual({ input: { employee: null }, usage });
    writeFileSync(join(dir, `${key}.json`), JSON.stringify({ key, model: call.model, reply: { employee: null }, usage, ms: 2_400 }));
    await expect(transport.call(call)).rejects.toThrow("slower than the limit");
    expect(transport.stats).toMatchObject({ calls: 3, missing: 1, slow: 1, inputTokens: 10_000 });
  });
});
