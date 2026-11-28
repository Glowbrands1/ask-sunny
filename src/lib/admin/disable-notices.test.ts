import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Owner, 28 Nov 2026: "can we get notifications too in the app when we disable log ins please? when someone is
 * terminated". Every active administrator gets one bell item per person, linking to Users.
 *
 * Pau, 28 Nov 2026: "Can we add the reason like terminated X date, position X location X , then sign in in X app
 * disabled" — in that order, each part only when Woven has it. Invented people and salons.
 */
const state = vi.hoisted(() => ({
  admins: [] as { email: string }[],
  directory: [] as Record<string, unknown>[],
  directoryError: null as { message: string } | null,
  filters: [] as string[],
  saved: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      state.filters.push(`from:${table}`);
      const chain = {
        select: () => chain,
        in: (column: string, values: string[]) => {
          state.filters.push(`in:${column}:${values.join(",")}`);
          if (table === "employee_access_directory") return Promise.resolve({ data: state.directory, error: state.directoryError });
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

const { calendarDateWords, disabledNotice, notifyAdminsOfDisabled, ACCOUNT_DISABLED_TERMINATED_KIND } = await import("./disable-notices");

beforeEach(() => {
  state.admins = [{ email: "Admin.One@example.test" }, { email: "admin.two@example.test" }];
  state.directory = [];
  state.directoryError = null;
  state.filters = [];
  state.saved = [];
});

describe("sign-in turned off: the administrators' bell", () => {
  it("says when Woven terminated them, the position and salons, then the sign-in turned off, and links to Users", () => {
    const notice = disabledNotice({
      name: "Juniper Brandvold",
      terminationDate: "2026-11-20",
      lastDayWorked: "2026-11-18",
      position: "Salon Director",
      primaryLocation: "Maple Grove",
      additionalLocations: ["Cedar Point"],
    });
    expect(notice.kind).toBe(ACCOUNT_DISABLED_TERMINATED_KIND);
    expect(notice.title).toBe("Sign-in turned off: Juniper Brandvold");
    expect(notice.body).toBe(
      "Juniper Brandvold was terminated in Woven on Nov 20, 2026 (last day worked Nov 18, 2026). Position: Salon Director. " +
        "Salon: Maple Grove. Additional salons: Cedar Point. Ask Sunny sign-in: disabled, and their sessions were ended. " +
        "If this is a mistake, turn the account back on in Users.",
    );
    expect(notice.href).toBe("/admin/users");
  });

  it("leaves out what Woven does not have, never guessing it", () => {
    const notice = disabledNotice({ name: "Corin Bellweather", terminationDate: null, position: null, primaryLocation: "Maple Grove" });
    expect(notice.body).toBe(
      "Corin Bellweather was terminated in Woven. Salon: Maple Grove. Ask Sunny sign-in: disabled, and their sessions were ended. " +
        "If this is a mistake, turn the account back on in Users.",
    );
    expect(notice.body).not.toMatch(/Position|last day|Additional/);
  });

  it("does not repeat the primary salon among the additional ones", () => {
    const notice = disabledNotice({ name: "Corin Bellweather", primaryLocation: "Maple Grove", additionalLocations: ["Maple Grove", "Cedar Point", "Cedar Point"] });
    expect(notice.body).toContain("Salon: Maple Grove. Additional salons: Cedar Point.");
  });

  it("reads a calendar date without a time zone shifting it", () => {
    expect(calendarDateWords("2026-11-24")).toBe("Nov 24, 2026");
    expect(calendarDateWords("2026-01-01T00:00:00Z")).toBe("Jan 1, 2026");
    expect(calendarDateWords("11/24/2026")).toBeNull();
    expect(calendarDateWords(null)).toBeNull();
  });

  it("rings every active administrator, one item per person, with the dates Woven gave", async () => {
    state.directory = [{ external_employee_id: "emp-1", termination_date: "2026-11-24", termination_last_day_worked: null }];
    await notifyAdminsOfDisabled([
      { name: "Juniper Brandvold", externalEmployeeId: "emp-1", position: "Assistant Salon Director", primaryLocation: "Maple Grove" },
      { name: "Corin Bellweather" },
    ]);
    expect(state.filters).toContain("eq:status:active");
    expect(state.filters.some((f) => f.startsWith("in:role:") && f.includes("admin"))).toBe(true);
    expect(state.filters).toContain("in:external_employee_id:emp-1");
    expect(state.saved.map((row) => [row.recipientEmail, row.title])).toEqual([
      ["admin.one@example.test", "Sign-in turned off: Juniper Brandvold"],
      ["admin.one@example.test", "Sign-in turned off: Corin Bellweather"],
      ["admin.two@example.test", "Sign-in turned off: Juniper Brandvold"],
      ["admin.two@example.test", "Sign-in turned off: Corin Bellweather"],
    ]);
    expect(state.saved[0]!.body).toMatch(/^Juniper Brandvold was terminated in Woven on Nov 24, 2026\. Position: Assistant Salon Director\. Salon: Maple Grove\./);
  });

  it("the directory unreadable: the notice still goes, without the dates", async () => {
    state.directoryError = { message: "down" };
    await notifyAdminsOfDisabled([{ name: "Juniper Brandvold", externalEmployeeId: "emp-1" }]);
    expect(state.saved).toHaveLength(2);
    expect(state.saved[0]!.body).toMatch(/^Juniper Brandvold was terminated in Woven\. Ask Sunny sign-in: disabled/);
  });

  it("nobody disabled, nothing read or rung", async () => {
    await notifyAdminsOfDisabled([]);
    expect(state.filters).toEqual([]);
    expect(state.saved).toEqual([]);
  });
});
