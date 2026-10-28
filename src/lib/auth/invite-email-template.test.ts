import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { INVITE_START_PATH } from "@/lib/auth/routes";

/**
 * The Supabase "Invite user" template lives in the dashboard; this is the copy
 * to paste in WHEN INVITE_LINK_HOLD_ENABLED is turned on (not before: with the
 * flag off the route sends people to sign in). Pin it to the route the app serves.
 */
const template = readFileSync(join(process.cwd(), "docs/supabase-invite-template.html"), "utf8");

describe("docs/supabase-invite-template.html", () => {
  it("links to invite-start with the token hash, not a one-click Supabase /verify link", () => {
    expect(template).toContain(`{{ .SiteURL }}${INVITE_START_PATH}?token_hash={{ .TokenHash }}&type=invite`);
    expect(template).not.toContain("{{ .ConfirmationURL }}");
  });

  it("hard-codes no host", () => {
    expect(template).not.toMatch(/localhost|127\.0\.0\.1/);
    expect(template).not.toMatch(/https?:\/\/(?!\{\{)/);
  });

  it("points at a route that exists", () => {
    expect(INVITE_START_PATH).toBe("/auth/invite-start");
  });
});
