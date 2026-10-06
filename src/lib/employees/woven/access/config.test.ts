import { describe, expect, it } from "vitest";

import { readWovenAccessConfig } from "./config";

describe("WOVEN_ACCESS_MODE and its apply switches", () => {
  it("defaults to off; shadow applies nothing", () => {
    expect(readWovenAccessConfig({})).toEqual({ mode: "off", applyActions: [], employeeAllowlist: null, problem: null });
    expect(readWovenAccessConfig({ WOVEN_ACCESS_MODE: "shadow" })).toMatchObject({ mode: "shadow", applyActions: [] });
  });

  it("apply with no capabilities listed applies nothing", () => {
    expect(readWovenAccessConfig({ WOVEN_ACCESS_MODE: "apply" })).toEqual({ mode: "apply", applyActions: [], employeeAllowlist: null, problem: null });
  });

  it("apply names the lifecycle capabilities and, optionally, the approved batch", () => {
    expect(
      readWovenAccessConfig({
        WOVEN_ACCESS_MODE: "APPLY",
        WOVEN_ACCESS_APPLY_ACTIONS: "create_user, DISABLE_TERMINATED,CREATE_USER,send_invite",
        WOVEN_ACCESS_APPLY_EMPLOYEE_IDS: "abc-1, def-2",
      }),
    ).toEqual({ mode: "apply", applyActions: ["CREATE_USER", "DISABLE_TERMINATED", "SEND_INVITE"], employeeAllowlist: ["abc-1", "def-2"], problem: null });
  });

  it.each(["UPDATE_ROLE", "UPDATE_PRIMARY_LOCATION", "CREATE_USER,UPDATE_ROLE", "DELETE_USER"])(
    "%s is refused and the whole mode falls back to OFF — a misconfiguration never widens what runs",
    (actions) => {
      const config = readWovenAccessConfig({ WOVEN_ACCESS_MODE: "apply", WOVEN_ACCESS_APPLY_ACTIONS: actions });
      expect(config).toMatchObject({ mode: "off", applyActions: [] });
      expect(config.problem).toMatch(/may name only CREATE_USER, SEND_INVITE, LINK_EXISTING and DISABLE_TERMINATED/);
    },
  );

  it("a malformed batch list, or an unknown mode, is OFF", () => {
    expect(readWovenAccessConfig({ WOVEN_ACCESS_MODE: "apply", WOVEN_ACCESS_APPLY_EMPLOYEE_IDS: "ok-1, not ok!" }).mode).toBe("off");
    expect(readWovenAccessConfig({ WOVEN_ACCESS_MODE: "on" }).mode).toBe("off");
  });
});
