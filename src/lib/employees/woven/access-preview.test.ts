import { describe, expect, it } from "vitest";

import { accessPreviewRowFromView } from "./access-preview";

/** The preview row carries the view's resolution — override first — and never widens it. */

const base = {
  employee_id: "e1",
  external_employee_id: "700",
  employment_status: "active",
  email_address: "owner.one@suntancity.test",
  email_is_duplicated: false,
  position_mapping_confirmed: true,
  mapped_role: "employee",
  mapped_scope_level: "salon",
  mapped_primary_salon_number: null,
  app_user_id: "u1",
  app_user_role: "admin",
  app_user_status: "active",
  app_user_scope_level: "global",
  app_user_scope_primary_area_id: null,
  would_provision_candidate: false,
  would_deactivate_candidate: false,
  role_differs: false,
  primary_salon_differs: false,
};

describe("accessPreviewRowFromView", () => {
  it("a protected account: the override's role, source 'override', no role difference", () => {
    const row = accessPreviewRowFromView({ ...base, role_override: "admin", effective_role: "admin", effective_scope_level: "global", role_source: "override" }, "Owner One", []);
    expect(row).toMatchObject({ roleOverride: "admin", effectiveRole: "admin", effectiveScopeLevel: "global", roleSource: "override", roleDiffers: false, mappedRole: "employee" });
  });

  it("an unprotected employee: the position's role, source 'position'", () => {
    const row = accessPreviewRowFromView({ ...base, app_user_role: "employee", role_override: null, effective_role: "employee", effective_scope_level: "salon", role_source: "position" }, "Peer", []);
    expect(row).toMatchObject({ roleOverride: null, effectiveRole: "employee", roleSource: "position" });
  });

  it("an unknown or missing role_source reads as 'none', never as an override", () => {
    for (const source of [undefined, null, "", "admin", "OVERRIDE"]) {
      expect(accessPreviewRowFromView({ ...base, role_source: source }, "X", []).roleSource).toBe("none");
    }
  });
});
