import { describe, expect, it } from "vitest";

import { readWovenKnowledgeConfig, WOVEN_TEAM_ANTIFORGERY_HEADER_ENV, WOVEN_TEAM_COMPANY_ID_ENV } from "./config";

const BASE = { WOVEN_KNOWLEDGE_SYNC_ENABLED: "true", WOVEN_TEAM_USERNAME: "integration@example.test", WOVEN_TEAM_PASSWORD: "pw" };

describe("company id and anti-forgery header configuration", () => {
  it("are both off by default", () => {
    const config = readWovenKnowledgeConfig(BASE);
    expect(config.companyId).toBeNull();
    expect(config.antiForgeryHeader).toBeNull();
    expect(config.problems).toEqual([]);
  });

  it("reads a UUID company id, lower-cased", () => {
    const config = readWovenKnowledgeConfig({ ...BASE, [WOVEN_TEAM_COMPANY_ID_ENV]: " 0A1B2C3D-0000-4000-8000-000000009001 " });
    expect(config.companyId).toBe("0a1b2c3d-0000-4000-8000-000000009001");
  });

  it("ignores a company id that is not a UUID, and says so by variable name", () => {
    const config = readWovenKnowledgeConfig({ ...BASE, [WOVEN_TEAM_COMPANY_ID_ENV]: "JB & Associates" });
    expect(config.companyId).toBeNull();
    expect(config.problems.join(" ")).toMatch(/WOVEN_TEAM_COMPANY_ID must be the company's Woven id/);
    expect(config.problems.join(" ")).not.toMatch(/JB & Associates/);
  });

  it("reads a header NAME only; anything else is ignored", () => {
    expect(readWovenKnowledgeConfig({ ...BASE, [WOVEN_TEAM_ANTIFORGERY_HEADER_ENV]: "RequestVerificationToken" }).antiForgeryHeader).toBe(
      "RequestVerificationToken",
    );
    const bad = readWovenKnowledgeConfig({ ...BASE, [WOVEN_TEAM_ANTIFORGERY_HEADER_ENV]: "X-Token: abc" });
    expect(bad.antiForgeryHeader).toBeNull();
    expect(bad.problems.join(" ")).toMatch(/WOVEN_TEAM_ANTIFORGERY_HEADER must be a plain header name/);
  });
});
