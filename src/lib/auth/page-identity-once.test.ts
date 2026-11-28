import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * ONE SIGN-IN CHECK PER PAGE LOAD (audit, 28 Nov 2026).
 *
 * Production, 27 Nov: one `/chat` load logged "AuthApiError: Request rate limit
 * reached" six times. The root layout, the app layout and the page's guard each
 * called `pageIdentity()`, and each call was its own Supabase Auth round trip.
 *
 * In a server render React's `cache()` memoizes per request; under vitest it is a
 * pass-through, so this test stands in a per-request cache for it and counts how
 * often the provider is asked when a page render asks seven times.
 */
describe("pageIdentity asks the auth provider once per server render", () => {
  afterEach(() => {
    vi.doUnmock("react");
    vi.doUnmock("next/headers");
    vi.doUnmock("./index");
    vi.resetModules();
  });

  it("seven asks in one render are one round trip", async () => {
    vi.resetModules();
    let identifyCalls = 0;
    vi.doMock("react", async (importOriginal) => {
      const actual = await importOriginal<typeof import("react")>();
      // The request-scoped memo React gives a Server Component render.
      const cache = <A extends unknown[], R>(fn: (...args: A) => R) => {
        let hit = false;
        let value: R;
        return (...args: A): R => {
          if (!hit) {
            value = fn(...args);
            hit = true;
          }
          return value;
        };
      };
      return { ...actual, cache };
    });
    vi.doMock("next/headers", () => ({ headers: async () => new Headers({ cookie: "sb=1" }) }));
    vi.doMock("./index", () => ({
      getAuthProvider: () => ({
        kind: "supabase",
        name: "Supabase Auth",
        isProductionGrade: true,
        missingConfiguration: [],
        identify: async () => {
          identifyCalls += 1;
          return { subject: "user-1", email: "m@example.test", displayName: "A Manager", role: "admin", scope: { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] }, verified: true };
        },
      }),
    }));
    const { pageIdentity } = await import("./page");

    const answers = await Promise.all(Array.from({ length: 7 }, () => pageIdentity()));

    expect(identifyCalls).toBe(1);
    expect(new Set(answers.map((a) => a?.subject))).toEqual(new Set(["user-1"]));
  });
});
