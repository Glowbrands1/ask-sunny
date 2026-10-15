import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The automatic-invitation migration is THREE files, applied in order, because
 * the single file timed out repeatedly when applied to Production through the
 * Supabase connector. This pins the shape so history and code cannot drift:
 * no stale single file, unique ordered versions, helpers inert until the last
 * part, and the behaviour change (one door, nine arguments, service_role only)
 * confined to part 3.
 */

const DIR = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const part = (version: string) => files.find((f) => f.startsWith(version))!;
const sql = (name: string) => readFileSync(join(DIR, name), "utf8");
const statements = (name: string) =>
  sql(name)
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\$\$[\s\S]*?\$\$/g, "$$$$")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

describe("automatic-invitation migrations (split in three)", () => {
  const slug = part("20261015001000");
  const area = part("20261015001100");
  const provision = part("20261015001200");

  it("exist in dependency order, with no conflicting or stale version", () => {
    expect([slug, area, provision]).toEqual([
      "20261015001000_woven_auto_invite_roles_area_slug.sql",
      "20261015001100_woven_auto_invite_roles_salon_area.sql",
      "20261015001200_woven_auto_invite_roles_provision.sql",
    ]);
    expect(files).not.toContain("20261015001000_woven_auto_invite_roles.sql");
    const versions = files.map((f) => f.split("_")[0]);
    expect(new Set(versions).size).toBe(versions.length);
    expect(files.filter((f) => f.includes("woven_auto_invite_roles"))).toHaveLength(3);
  });

  it("every part is small (a few statements) so it applies well inside a 60-second tool limit", () => {
    for (const f of [slug, area, provision]) expect(statements(f).length, f).toBeLessThanOrEqual(7);
  });

  it("parts 1 and 2 are additive and inert: they only create read helpers and never touch the provisioning function or any table", () => {
    for (const f of [slug, area]) {
      const text = statements(f).join(";\n").toLowerCase();
      expect(text, f).not.toContain("employee_access_provision_account");
      expect(text, f).not.toMatch(/\b(insert|update|delete|alter table|create table|drop table)\b/);
      expect(text, f).toMatch(/revoke all on function/);
    }
  });

  it("part 3 swaps the function in ONE migration: drops the 7-argument door, creates the 9-argument one, service_role only", () => {
    const text = sql(provision);
    expect(text).toMatch(/drop function if exists public\.employee_access_provision_account\(uuid, text, text, text, text, text, text\)/);
    expect(text).toMatch(/p_also_covers\s+text\[\]/);
    expect(text).toMatch(/revoke all on function public\.employee_access_provision_account\(uuid, text, text, text, text, text, text, text\[\], text\) from public, anon, authenticated, service_role/);
    expect(text).toMatch(/grant execute on function public\.employee_access_provision_account\(uuid, text, text, text, text, text, text, text\[\], text\) to service_role/);
    expect(text).toContain("'assistant_salon_director', 'salon_director', 'district_manager', 'regional_manager'");
  });

  it("the helpers part 3 calls are created by earlier parts", () => {
    expect(sql(provision)).toContain("employee_access_area_slug");
    expect(sql(provision)).toContain("employee_access_salon_area");
    expect(sql(slug)).toContain("function public.employee_access_area_slug");
    expect(sql(area)).toContain("function public.employee_access_salon_area");
  });
});
