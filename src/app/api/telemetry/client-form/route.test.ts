import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/*
 * QA, f073 (20 Nov 2026): the card's create events reach the server log through this route. Signed-in only, a
 * per-user rate limit, a 1 KB body, an allow-listed shape with no free text, and one log line per event.
 */

let signedIn: string | null = "user-a";
vi.mock("@/lib/auth/server", async () => {
  const { AuthError } = await import("@/lib/auth/types");
  return {
    authorizeRequest: vi.fn(async () => {
      if (!signedIn) throw new AuthError("unauthenticated", "You are not signed in.");
      return { identity: { subject: signedIn }, permission: "ask_questions", provider: "test" };
    }),
  };
});

import { InMemoryRateLimiter, __setRateLimiter } from "@/lib/api/rate-limit";
import { POST } from "./route";

const post = (body: unknown, raw?: string) =>
  POST(new Request("http://localhost/api/telemetry/client-form", { method: "POST", headers: { "content-type": "application/json" }, body: raw ?? JSON.stringify(body) }));

const CLICK = { event: "form.create.clicked", proposalId: "prop-f073", deploymentId: "dpl_7hB9old" };
let lines: string[] = [];

beforeEach(() => {
  signedIn = "user-a";
  lines = [];
  __setRateLimiter(new InMemoryRateLimiter());
  vi.spyOn(console, "info").mockImplementation((line: unknown) => {
    lines.push(String(line));
  });
  vi.stubEnv("VERCEL_DEPLOYMENT_ID", "dpl_Cg1gnew");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("POST /api/telemetry/client-form", () => {
  it("writes one log line with the event, the ids, the timing and both deploys", async () => {
    const response = await post({ event: "form.create.failed", proposalId: "prop-f073", deploymentId: "dpl_7hB9old", elapsedMs: 30_002, failure: "no_answer" });
    expect(response.status).toBe(204);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[client\.form\] /);
    expect(JSON.parse(lines[0]!.replace("[client.form] ", ""))).toEqual({
      event: "form.create.failed",
      proposalId: "prop-f073",
      deploymentId: "dpl_7hB9old",
      elapsedMs: 30_002,
      failure: "no_answer",
      serverDeploymentId: "dpl_Cg1gnew",
    });
    // Who sent it is not logged.
    expect(lines[0]).not.toContain("user-a");
  });

  it("refuses a caller who is not signed in, and logs nothing", async () => {
    signedIn = null;
    const response = await post(CLICK);
    expect(response.status).toBe(401);
    expect(lines).toHaveLength(0);
  });

  it.each([
    ["an event not on the list", { ...CLICK, event: "form.create.anything" }],
    ["free text in an extra key", { ...CLICK, note: "Corin Vale was late" }],
    ["a name in the proposal id", { ...CLICK, proposalId: "Corin Vale" }],
    ["a reason not on the list", { ...CLICK, ignored: "the manager gave up" }],
    ["a failure kind not on the list", { ...CLICK, failure: "TypeError: Load failed" }],
    ["a timing that is not a whole number", { ...CLICK, elapsedMs: 1.5 }],
    ["not an object", ["form.create.clicked"]],
  ])("refuses %s, and logs nothing", async (_name, body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(lines).toHaveLength(0);
  });

  it("refuses a body over 1 KB", async () => {
    const response = await post(null, JSON.stringify({ ...CLICK, pad: "x".repeat(2_000) }));
    expect(response.status).toBe(413);
    expect(lines).toHaveLength(0);
  });

  it("limits each signed-in user to 60 events a minute, separately", async () => {
    for (let index = 0; index < 60; index += 1) expect((await post(CLICK)).status).toBe(204);
    expect((await post(CLICK)).status).toBe(429);
    signedIn = "user-b";
    expect((await post(CLICK)).status).toBe(204);
  });
});
