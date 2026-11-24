import { afterEach, describe, expect, it, vi } from "vitest";

import { bubblesHrApprovalsUrl, switchableApps } from "./app-switcher";

afterEach(() => vi.unstubAllEnvs());

describe("app switcher config", () => {
  it("defaults to the production addresses", () => {
    const urls = Object.fromEntries(
      switchableApps({ showLeadershipHub: true }).map((a) => [a.id, a.url]),
    );
    expect(urls["ask-bubbles"]).toBe("https://askbubbles.vercel.app");
    expect(urls["leadership-hub"]).toBe(
      "https://leadership-hub-beta.vercel.app",
    );
  });

  it("lets environment variables override the addresses; blank falls back", () => {
    vi.stubEnv("NEXT_PUBLIC_ASK_BUBBLES_URL", "https://bubbles.example.test");
    vi.stubEnv("NEXT_PUBLIC_LEADERSHIP_HUB_URL", "  ");
    const urls = Object.fromEntries(
      switchableApps({ showLeadershipHub: true }).map((a) => [a.id, a.url]),
    );
    expect(urls["ask-bubbles"]).toBe("https://bubbles.example.test");
    expect(urls["leadership-hub"]).toBe(
      "https://leadership-hub-beta.vercel.app",
    );
  });

  it("omits Leadership Hub unless the server said yes", () => {
    expect(switchableApps().map((a) => a.id)).not.toContain("leadership-hub");
    expect(
      switchableApps({ showLeadershipHub: false }).map((a) => a.id),
    ).toEqual(["ask-sunny", "ask-bubbles"]);
  });

  it("\"Bubbles approvals ↗\" opens Ask Bubbles' own Pending HR approval view (Pau, 23 Nov 2026)", () => {
    expect(bubblesHrApprovalsUrl()).toBe("https://askbubbles.vercel.app/forms/monitoring?view=hr");
    vi.stubEnv("NEXT_PUBLIC_ASK_BUBBLES_URL", "https://bubbles.example.test/");
    expect(bubblesHrApprovalsUrl()).toBe("https://bubbles.example.test/forms/monitoring?view=hr");
  });
});
