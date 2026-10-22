import { describe, expect, it } from "vitest";

import { TEMPLATE_SEEDS } from "@/lib/forms/library";
import { DEFAULT_PERMISSION_MATRIX, FORM_CREATION_PERMISSIONS } from "./index";

/*
 * "Create a form" is offered only to an account holding one of these, so a
 * template whose permission is missing here would hide the control from the
 * very roles that may create it.
 */
describe("the permissions that create a form", () => {
  it("cover every template's required permission", () => {
    for (const seed of TEMPLATE_SEEDS) {
      if (!seed.requiredPermission) continue;
      expect(FORM_CREATION_PERMISSIONS, seed.key).toContain(seed.requiredPermission);
    }
  });

  it("are held by a Salon Director and not by an Assistant Salon Director or an Employee", () => {
    const holds = (role: keyof typeof DEFAULT_PERMISSION_MATRIX) =>
      FORM_CREATION_PERMISSIONS.some((permission) =>
        DEFAULT_PERMISSION_MATRIX[role].includes(permission),
      );
    expect(holds("salon_director")).toBe(true);
    expect(holds("assistant_salon_director")).toBe(false);
    expect(holds("employee")).toBe(false);
  });
});
