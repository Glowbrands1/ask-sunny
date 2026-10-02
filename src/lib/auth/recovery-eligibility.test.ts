import { describe, expect, it, vi } from "vitest";

/**
 * Who may be sent a recovery email: an `active` or `invited` profile only.
 * Fails closed. The address is matched case-insensitively and LITERALLY —
 * `_` and `%` in an address are not wildcards.
 */

function fakeAdmin(result: { data?: unknown; error?: unknown; throws?: boolean }) {
  const seen: { table?: string; column?: string; pattern?: string; limit?: number } = {};
  const client = {
    from(table: string) {
      seen.table = table;
      return {
        select: () => ({
          ilike: (column: string, pattern: string) => {
            seen.column = column;
            seen.pattern = pattern;
            return {
              limit: async (n: number) => {
                seen.limit = n;
                if (result.throws) throw new Error("down");
                return { data: result.data ?? null, error: result.error ?? null };
              },
            };
          },
        }),
      };
    },
  };
  return { client, seen };
}

async function load(fake: ReturnType<typeof fakeAdmin>) {
  vi.resetModules();
  vi.doMock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => fake.client, KNOWLEDGE_BUCKET: "knowledge-documents" }));
  return import("./recovery-eligibility");
}

describe("recoveryEligibility", () => {
  it.each([
    ["active", "allowed"],
    ["invited", "allowed"],
    ["disabled", "not_allowed"],
    ["something_new", "not_allowed"],
  ] as const)("a %s profile → %s", async (status, expected) => {
    const { recoveryEligibility } = await load(fakeAdmin({ data: [{ status }] }));
    expect(await recoveryEligibility("manager@suntancity.com")).toBe(expected);
  });

  it("no profile → no_account", async () => {
    const { recoveryEligibility } = await load(fakeAdmin({ data: [] }));
    expect(await recoveryEligibility("nobody@suntancity.com")).toBe("no_account");
  });

  it("two profiles for one address → not_allowed", async () => {
    const { recoveryEligibility } = await load(fakeAdmin({ data: [{ status: "active" }, { status: "active" }] }));
    expect(await recoveryEligibility("manager@suntancity.com")).toBe("not_allowed");
  });

  it("a read error or a throw → lookup_failed (fail closed)", async () => {
    expect(await (await load(fakeAdmin({ error: { message: "x" } }))).recoveryEligibility("a@b.co")).toBe("lookup_failed");
    expect(await (await load(fakeAdmin({ throws: true }))).recoveryEligibility("a@b.co")).toBe("lookup_failed");
  });

  it("reads only app_users.status, by a literal case-insensitive email match", async () => {
    const fake = fakeAdmin({ data: [] });
    const { recoveryEligibility } = await load(fake);
    await recoveryEligibility("first_last%x@suntancity.com");
    expect(fake.seen).toEqual({ table: "app_users", column: "email", pattern: "first\\_last\\%x@suntancity.com", limit: 2 });
  });
});
