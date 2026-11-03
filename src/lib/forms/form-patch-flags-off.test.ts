import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Step B, the no-import tests (FORM_PATCH_REDUCER_ENABLED,
 * FORM_REPLY_FROM_DIFF_ENABLED). The AI SDK is imported in one module only,
 * and with both flags unset the chat and draft routes never load it.
 */

const loaded = vi.hoisted(() => ({ call: false }));

vi.mock("@/lib/forms/form-patch-call", () => {
  loaded.call = true;
  return { callFormPatchModel: vi.fn(async () => ({ fallback: "error" })) };
});

const FLAGS = ["FORM_PATCH_REDUCER_ENABLED", "FORM_REPLY_FROM_DIFF_ENABLED"] as const;
const saved = new Map<string, string | undefined>();

beforeAll(() => {
  for (const name of FLAGS) {
    saved.set(name, process.env[name]);
    delete process.env[name];
  }
});

afterAll(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const ONLY = "src/lib/forms/form-patch-call.ts";

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if ((name.endsWith(".ts") || name.endsWith(".tsx")) && !name.endsWith(".test.ts") && !name.endsWith(".test.tsx")) out.push(path);
  }
  return out;
}

describe("the AI SDK is imported only by the form-patch call module", () => {
  it("no other production source imports it", () => {
    const needles = ['from "ai"', "from 'ai'", 'import("ai")', "import('ai')", "@ai-sdk/anthropic"];
    const offenders = sources("src").filter((path) => path !== ONLY && needles.some((needle) => readFileSync(path, "utf8").includes(needle)));
    expect(offenders).toEqual([]);
  });

  it("the call module imports it only dynamically", () => {
    const source = readFileSync(ONLY, "utf8");
    expect(source).toContain('await import("ai")');
    expect(source).toContain('await import("@ai-sdk/anthropic")');
    expect(source).not.toContain('from "ai"');
    expect(source).not.toContain('from "@ai-sdk/anthropic"');
  });
});

describe("with both flags unset", () => {
  it("both flags read false", async () => {
    const { formPatchReducerEnabled, formReplyFromDiffEnabled } = await import("@/lib/config/chat-quality-flags");
    expect(formPatchReducerEnabled()).toBe(false);
    expect(formReplyFromDiffEnabled()).toBe(false);
  });

  it("loading the chat route and the draft route does not load the call module", async () => {
    const chat = await import("@/app/api/chat/route");
    const draft = await import("@/app/api/forms/instances/[id]/draft/route");
    expect(typeof chat.POST).toBe("function");
    expect(typeof draft.POST).toBe("function");
    expect(loaded.call).toBe(false);
  }, 60_000);

  it("the mock does record a load (the check above can fail)", async () => {
    await import("@/lib/forms/form-patch-model");
    expect(loaded.call).toBe(true);
  });
});
