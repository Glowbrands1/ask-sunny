import { afterEach, describe, expect, it, vi } from "vitest";

import { escapeLike } from "@/lib/supabase/like";

/**
 * The invite's duplicate check compares the WHOLE address, ignoring case.
 *
 * It used `ilike(email)` unescaped, so `_` and `%` were wildcards: inviting
 * `jane_doe@gmail.com` was refused as a duplicate of an existing
 * `jane.doe@gmail.com` — a real risk with personal addresses.
 */

describe("escapeLike", () => {
  it("escapes the LIKE wildcards and the escape character, and nothing else", () => {
    expect(escapeLike("jane_doe@gmail.com")).toBe("jane\\_doe@gmail.com");
    expect(escapeLike("50%off@x.test")).toBe("50\\%off@x.test");
    expect(escapeLike("a\\b@x.test")).toBe("a\\\\b@x.test");
    expect(escapeLike("plain.name@x.test")).toBe("plain.name@x.test");
  });

  it("an escaped pattern matches only the identical address (case-insensitively), as Postgres ILIKE would", () => {
    const ilike = (value: string, pattern: string) => {
      let re = "";
      for (let i = 0; i < pattern.length; i += 1) {
        const c = pattern[i]!;
        if (c === "\\") re += pattern[++i]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        else if (c === "_") re += ".";
        else if (c === "%") re += ".*";
        else re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }
      return new RegExp(`^${re}$`, "i").test(value);
    };
    expect(ilike("jane.doe@gmail.com", "jane_doe@gmail.com")).toBe(true); // the bug
    expect(ilike("jane.doe@gmail.com", escapeLike("jane_doe@gmail.com"))).toBe(false); // the fix
    expect(ilike("Jane_Doe@Gmail.com", escapeLike("jane_doe@gmail.com"))).toBe(true);
  });
});

describe("inviteUser's duplicate check", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/supabase/server");
  });

  it("looks the address up with the escaped pattern", async () => {
    const patterns: string[] = [];
    const chain: Record<string, unknown> = {
      select: () => chain,
      ilike: (_column: string, pattern: string) => {
        patterns.push(pattern);
        return chain;
      },
      limit: async () => ({ data: [{ id: "existing" }], error: null }),
    };
    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => ({ from: () => chain }), KNOWLEDGE_BUCKET: "knowledge-documents" }));
    const { inviteUser } = await import("./user-directory");
    await expect(
      inviteUser(
        {
          email: "jane_doe@gmail.com",
          displayName: "Jane",
          role: "employee",
          scope: { level: "salon", primaryAreaId: "loc-0307", alsoCoversAreaIds: [] },
          redirectTo: "http://127.0.0.1/auth/accept",
        },
        { id: "admin-1", email: "admin@x.test", role: "admin" },
      ),
    ).rejects.toMatchObject({ code: "duplicate_email" });
    expect(patterns).toEqual(["jane\\_doe@gmail.com"]);
  });
});
