import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The sample-data gate. The build-time boundary (`demo-boundary.test.ts`)
 * proves a production build carries no sample; this proves the runtime gate
 * on top of it: demo mode only, and never on Vercel Production — even with the
 * demo-in-production escape hatch.
 */

afterEach(() => {
  vi.doUnmock("@/lib/config/runtime");
  vi.unstubAllEnvs();
});

async function gate(state: { demo: boolean; production: boolean }) {
  vi.resetModules();
  vi.doMock("@/lib/config/runtime", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/config/runtime")>()),
    isDemoMode: () => state.demo,
    isProductionDeployment: () => state.production,
  }));
  const { wovenSampleForThisDeployment } = await import("./sample");
  return wovenSampleForThisDeployment();
}

/*
 * Every test here re-imports `./sample` after `vi.resetModules()`, and the
 * first one cold-imports the whole demo runtime (about 2s unloaded). Under
 * heavy CPU load that exceeded the 5s default, so the timeout is explicit.
 */
const COLD_IMPORT_TIMEOUT_MS = 20_000;

describe("wovenSampleForThisDeployment", { timeout: COLD_IMPORT_TIMEOUT_MS }, () => {
  it("serves the labelled sample in a demo build that is not Vercel Production", async () => {
    const sample = await gate({ demo: true, production: false });
    expect(sample?.label).toMatch(/^Sample data/);
  });

  it("serves nothing in live mode", async () => {
    expect(await gate({ demo: false, production: false })).toBeNull();
  });

  it("serves nothing on a Vercel Production deployment, even in demo mode", async () => {
    expect(await gate({ demo: true, production: true })).toBeNull();
  });

  it("serves nothing when the server-side VERCEL_ENV says production", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(await gate({ demo: true, production: false })).toBeNull();
  });
});
