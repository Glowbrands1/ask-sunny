import { beforeEach, vi } from "vitest";

/**
 * FORM_EDIT_SINGLE_WRITER_ENABLED ON: every test of `sdit-epp-draft-route.test.ts` again,
 * with the flag pinned on (ported from Ask Bubbles 44856eb0). That file runs
 * with the flag as the environment sets it (off in CI: today's behaviour,
 * unchanged); its `instances.ts` mock keeps what the writers saved and returns
 * it from `loadInstance` (`src/test/forms/saved-form-instances.ts`), so here
 * each test asserts the form as the one writer saved it (step 2b).
 */
beforeEach(() => {
  vi.stubEnv("FORM_EDIT_SINGLE_WRITER_ENABLED", "true");
});

await import("./sdit-epp-draft-route.test");
