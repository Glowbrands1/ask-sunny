import { describe, expect, it } from "vitest";

import type { AccessScope } from "@/types";

import { passwordResetHelp } from "./app-help";
import { storeCodesForSalonNumbers } from "./chat-data-plan";
import { loadChatDataBlock } from "./chat-data-tools";

const WORNALL: AccessScope = {
  level: "salon",
  primaryAreaId: "loc-0306",
  alsoCoversAreaIds: [],
};

describe("chat data tools", () => {
  it("reads nothing while the flag is off", async () => {
    const result = await loadChatDataBlock({
      enabled: false,
      question: "how are our google reviews and what was revenue",
      role: "salon_director",
      scope: WORNALL,
      briefedFamilies: [],
      choose: async () => {
        throw new Error("should not choose");
      },
      readReviews: async () => {
        throw new Error("should not read reviews");
      },
      readSales: async () => {
        throw new Error("should not read sales");
      },
    });
    expect(result).toEqual({ help: null, data: null });
  });

  it("does not give an employee review counts or sales", async () => {
    let reads = 0;
    const result = await loadChatDataBlock({
      enabled: true,
      question: "how are our google reviews",
      role: "employee",
      scope: WORNALL,
      briefedFamilies: [],
      choose: async () => "reviews",
      readReviews: async () => {
        reads += 1;
        return "should not be used";
      },
    });
    expect(reads).toBe(0);
    expect(result.data).toBeNull();
  });

  it("asks for the Wornall listing by its Google store code, not its salon number", async () => {
    expect(storeCodesForSalonNumbers(["0306"])).toEqual(["140"]);
    expect(storeCodesForSalonNumbers(["0306"])).not.toContain("306");
    const seen: string[][] = [];
    const result = await loadChatDataBlock({
      enabled: true,
      question: "how are our google reviews",
      role: "salon_director",
      scope: WORNALL,
      briefedFamilies: [],
      choose: async () => "reviews",
      readReviews: async (storeCodes) => {
        seen.push([...storeCodes]);
        return "GOOGLE REVIEWS\n\n- Wornall (store 140): 2 qualifying this week, 0 unanswered, average 4.5.";
      },
    });
    expect(seen).toEqual([["140"]]);
    expect(result.data).toContain("store 140");
  });

  it("does not load sales again when the report briefing already has them", async () => {
    let salesReads = 0;
    const result = await loadChatDataBlock({
      enabled: true,
      question: "what was revenue yesterday",
      role: "salon_director",
      scope: WORNALL,
      briefedFamilies: ["sales-totals"],
      choose: async () => "sales",
      readSales: async () => {
        salesReads += 1;
        return "sales";
      },
    });
    expect(salesReads).toBe(0);
    expect(result.data).toBeNull();
  });

  it("loads sales when the briefing did not and the role may view reports", async () => {
    const result = await loadChatDataBlock({
      enabled: true,
      question: "what was revenue yesterday",
      role: "salon_director",
      scope: WORNALL,
      briefedFamilies: [],
      choose: async () => "sales",
      readSales: async () => "SALES TOTALS\n\nGrand total 10.",
    });
    expect(result.data).toContain("SALES TOTALS");
  });

  it("answers a password reset from the auth routes", async () => {
    let chose = 0;
    const result = await loadChatDataBlock({
      enabled: true,
      question: "how do I reset my password",
      role: "employee",
      scope: WORNALL,
      briefedFamilies: [],
      choose: async () => {
        chose += 1;
        return "reviews";
      },
    });
    expect(chose).toBe(0);
    expect(result.help).toContain("/api/auth/forgot-password");
    expect(result.help).toContain("/reset-password");
    expect(result.help).toContain("resetPasswordForEmail");
    expect(passwordResetHelp("what is the password policy")).toBeNull();
  });
});
