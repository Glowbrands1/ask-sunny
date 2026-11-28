import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Owner, 28 Nov 2026: "can we get notifications too in the app when we disable log ins please? when someone is
 * terminated". Every active administrator gets one bell item per person, linking to Users. Invented people.
 */
const state = vi.hoisted(() => ({ admins: [] as { email: string }[], filters: [] as string[], saved: [] as Record<string, unknown>[] }));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      state.filters.push(`from:${table}`);
      const chain = {
        select: () => chain,
        in: (column: string, values: string[]) => {
          state.filters.push(`in:${column}:${values.join(",")}`);
          return chain;
        },
        eq: async (column: string, value: string) => {
          state.filters.push(`eq:${column}:${value}`);
          return { data: state.admins, error: null };
        },
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/notifications/repository", () => ({
  createNotifications: async (rows: Record<string, unknown>[]) => {
    state.saved.push(...rows);
  },
}));

const { disabledNotice, notifyAdminsOfDisabled, ACCOUNT_DISABLED_TERMINATED_KIND } = await import("./disable-notices");

beforeEach(() => {
  state.admins = [{ email: "Admin.One@example.test" }, { email: "admin.two@example.test" }];
  state.filters = [];
  state.saved = [];
});

describe("sign-in turned off: the administrators' bell", () => {
  it("names the person, says why and what to do, and links to Users", () => {
    const notice = disabledNotice({ name: "Juniper Brandvold" });
    expect(notice.kind).toBe(ACCOUNT_DISABLED_TERMINATED_KIND);
    expect(notice.title).toBe("Sign-in turned off: Juniper Brandvold");
    expect(notice.body).toMatch(/^Woven marks Juniper Brandvold as terminated, so their sign-in to Ask \w+ was turned off automatically/);
    expect(notice.body).toMatch(/turn the account back on in Users\.$/);
    expect(notice.href).toBe("/admin/users");
  });

  it("rings every active administrator, one item per person", async () => {
    await notifyAdminsOfDisabled([{ name: "Juniper Brandvold" }, { name: "Corin Bellweather" }]);
    expect(state.filters).toContain("eq:status:active");
    expect(state.filters.some((f) => f.startsWith("in:role:") && f.includes("admin"))).toBe(true);
    expect(state.saved.map((row) => [row.recipientEmail, row.title])).toEqual([
      ["admin.one@example.test", "Sign-in turned off: Juniper Brandvold"],
      ["admin.one@example.test", "Sign-in turned off: Corin Bellweather"],
      ["admin.two@example.test", "Sign-in turned off: Juniper Brandvold"],
      ["admin.two@example.test", "Sign-in turned off: Corin Bellweather"],
    ]);
  });

  it("nobody disabled, nothing read or rung", async () => {
    await notifyAdminsOfDisabled([]);
    expect(state.filters).toEqual([]);
    expect(state.saved).toEqual([]);
  });
});
