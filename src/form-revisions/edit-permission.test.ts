import { describe, expect, it } from "vitest";

import { TEMPLATE_SEEDS } from "@/lib/forms/library";

import { EDIT_PERMISSION_BY_TEMPLATE, editPermissionFor } from "./edit-permission";

/*
 * The forms list offers Edit only to a role holding the permission the server
 * checks for editing that form (`authorizeInstance(..., "edit")`: the
 * template's `requiredPermission`, or `manage_form_templates` when the
 * library no longer has it). The browser cannot load the library itself —
 * it is server-sized — so it carries a copy keyed by template name; the seed
 * is the only author of both a template's name and its permission, and this
 * test fails the moment the copy and the library disagree.
 */
describe("the forms list's edit permission, per template", () => {
  it("is the library's requiredPermission for every template", () => {
    for (const seed of TEMPLATE_SEEDS) {
      expect(editPermissionFor(seed.name), seed.name).toBe(seed.requiredPermission);
    }
  });

  it("names no template the library does not have", () => {
    const names = new Set(TEMPLATE_SEEDS.map((seed) => seed.name));
    expect(names.size).toBe(TEMPLATE_SEEDS.length);
    expect(Object.keys(EDIT_PERMISSION_BY_TEMPLATE).filter((name) => !names.has(name))).toEqual([]);
  });

  it("is manage_form_templates for a template the library no longer has, as on the server", () => {
    expect(editPermissionFor("Retired Form")).toBe("manage_form_templates");
  });
});
