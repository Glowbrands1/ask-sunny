import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const demo = vi.hoisted(() => ({ on: false }));
vi.mock("@/lib/config/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config/runtime")>()),
  isDemoMode: () => demo.on,
}));

import { voiceInputEnabledFor } from "./voice-config";

/* VOICE_INPUT_ENABLED and the pilot list VOICE_INPUT_USERS (invented addresses only). */

beforeEach(() => {
  demo.on = false;
  vi.stubEnv("VOICE_INPUT_ENABLED", "1");
  vi.stubEnv("ASSEMBLYAI_API_KEY", "test-key-not-real");
  vi.stubEnv("VOICE_INPUT_USERS", "ada@example.test,bea@example.test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("voiceInputEnabledFor", () => {
  it("on for a listed email when the flag, the key and live mode are all there", () => {
    expect(voiceInputEnabledFor({ email: "ada@example.test" })).toBe(true);
  });

  it("flag off: nobody", () => {
    vi.stubEnv("VOICE_INPUT_ENABLED", "");
    expect(voiceInputEnabledFor({ email: "ada@example.test" })).toBe(false);
    vi.stubEnv("VOICE_INPUT_ENABLED", "0");
    expect(voiceInputEnabledFor({ email: "ada@example.test" })).toBe(false);
  });

  it("demo mode: nobody", () => {
    demo.on = true;
    expect(voiceInputEnabledFor({ email: "ada@example.test" })).toBe(false);
  });

  it("no AssemblyAI key: nobody", () => {
    vi.stubEnv("ASSEMBLYAI_API_KEY", "");
    expect(voiceInputEnabledFor({ email: "ada@example.test" })).toBe(false);
    delete process.env.ASSEMBLYAI_API_KEY;
    expect(voiceInputEnabledFor({ email: "ada@example.test" })).toBe(false);
  });

  it("VOICE_INPUT_USERS unset or empty: nobody", () => {
    vi.stubEnv("VOICE_INPUT_USERS", "");
    expect(voiceInputEnabledFor({ email: "ada@example.test" })).toBe(false);
    delete process.env.VOICE_INPUT_USERS;
    expect(voiceInputEnabledFor({ email: "ada@example.test" })).toBe(false);
    vi.stubEnv("VOICE_INPUT_USERS", " , ,");
    expect(voiceInputEnabledFor({ email: "" })).toBe(false);
  });

  it("an email not on the list: off", () => {
    expect(voiceInputEnabledFor({ email: "cy@example.test" })).toBe(false);
    expect(voiceInputEnabledFor({ email: null })).toBe(false);
    expect(voiceInputEnabledFor({ email: undefined })).toBe(false);
  });

  it("letter case does not matter, either side", () => {
    vi.stubEnv("VOICE_INPUT_USERS", "Ada@Example.Test");
    expect(voiceInputEnabledFor({ email: "ADA@example.TEST" })).toBe(true);
  });

  it("spaces around entries do not matter", () => {
    vi.stubEnv("VOICE_INPUT_USERS", "  ada@example.test ,   bea@example.test  ");
    expect(voiceInputEnabledFor({ email: "bea@example.test" })).toBe(true);
    expect(voiceInputEnabledFor({ email: "  ada@example.test " })).toBe(true);
  });
});
