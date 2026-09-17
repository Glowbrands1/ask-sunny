import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AiError } from "@/lib/ai/errors";
import { __setSupabaseAdmin } from "@/lib/supabase/server";
import { applyAnchors, MAX_ANCHORS_PER_REQUEST, normaliseAnchorRequests } from "./anchors";

/**
 * SETTING A LISTING'S REPORTING ANCHOR.
 *
 * The anchor is the boundary everything else rests on: nothing counts until one
 * exists, and a wrong one either counts reviews that should have stayed
 * historical or fails to count ones that should not. So the validation is
 * strict, and every refusal below is a rule somebody could otherwise loosen.
 *
 * Every review id and store code is invented apart from the real store codes,
 * which are printed on the storefronts.
 */

afterEach(() => {
  __setSupabaseAdmin(null);
});

describe("normaliseAnchorRequests", () => {
  it("accepts an explicit Google review id", () => {
    expect(
      normaliseAnchorRequests([
        { storeCode: "306", externalReviewId: "FIXTURE-ANCHOR-0001" },
      ]),
    ).toEqual([{ storeCode: "306", externalReviewId: "FIXTURE-ANCHOR-0001" }]);
  });

  it("accepts a baseline, which names no review", () => {
    expect(normaliseAnchorRequests([{ storeCode: "143", fromNewestHeld: true }])).toEqual([
      { storeCode: "143", fromNewestHeld: true },
    ]);
  });

  it("refuses a store code that is not one of the fifteen", () => {
    /*
     * REFUSED, NOT IGNORED — unlike an unknown store inside a review batch. A
     * sync carrying Buff City Soap is a normal Tuesday; a person typing a store
     * code that does not exist has made a mistake, and quietly accepting it
     * would leave them believing a salon had been anchored.
     */
    expect(() =>
      normaliseAnchorRequests([{ storeCode: "881", fromNewestHeld: true }]),
    ).toThrow(AiError);
    expect(() =>
      normaliseAnchorRequests([{ storeCode: "0306", fromNewestHeld: true }]),
    ).toThrow(AiError);
  });

  it("refuses a review id that is not Google-shaped", () => {
    for (const externalReviewId of ["", "short", "has spaces", "../../etc/passwd"]) {
      expect(() =>
        normaliseAnchorRequests([{ storeCode: "306", externalReviewId }]),
      ).toThrow(AiError);
    }
  });

  it("refuses a listing named twice in one request", () => {
    /* Two anchors for one salon is a contradiction, not a last-one-wins. */
    expect(() =>
      normaliseAnchorRequests([
        { storeCode: "306", fromNewestHeld: true },
        { storeCode: "306", externalReviewId: "FIXTURE-ANCHOR-0002" },
      ]),
    ).toThrow(AiError);
  });

  it("refuses an empty request and one larger than the estate", () => {
    expect(() => normaliseAnchorRequests([])).toThrow(AiError);
    expect(() =>
      normaliseAnchorRequests(
        Array.from({ length: MAX_ANCHORS_PER_REQUEST + 1 }, () => ({
          storeCode: "306",
          fromNewestHeld: true,
        })),
      ),
    ).toThrow(AiError);
  });

  it("refuses anything that is not a list of objects", () => {
    expect(() => normaliseAnchorRequests({ storeCode: "306" })).toThrow(AiError);
    expect(() => normaliseAnchorRequests(["306"])).toThrow(AiError);
  });
});

describe("applyAnchors", () => {
  /**
   * Answers each call in turn, so a partial-success test can script both.
   *
   * The rest parameter keeps the recorded arguments available through
   * `rpc.mock.calls` — which is how the test below proves an explicit id and a
   * baseline reach two DIFFERENT database functions — without naming
   * parameters the body has no use for.
   */
  function fakeAdmin(results: Record<string, unknown>[]) {
    let call = 0;
    const rpc = vi.fn(async (...args: [name: string, params: unknown]) => {
      void args;
      return { data: results[call++] ?? {}, error: null };
    });
    __setSupabaseAdmin({ rpc } as unknown as SupabaseClient);
    return rpc;
  }

  it("calls the explicit function for an id and the baseline function for a baseline", async () => {
    const rpc = fakeAdmin([
      { status: "anchor_set", anchorReviewId: "FIXTURE-ANCHOR-0001", assignedAbove: 3 },
      { status: "baseline_set", anchorReviewId: "FIXTURE-NEWEST-0001", assignedAbove: 0 },
    ]);

    await applyAnchors(
      [
        { storeCode: "306", externalReviewId: "FIXTURE-ANCHOR-0001" },
        { storeCode: "143", fromNewestHeld: true },
      ],
      { credentialId: "brave-extension" },
    );

    expect(rpc.mock.calls[0][0]).toBe("google_review_set_anchor");
    expect(rpc.mock.calls[1][0]).toBe("google_review_baseline_anchor");
  });

  it("reports each listing's outcome separately, so a partial success is usable", async () => {
    /*
     * Anchoring fourteen listings and reporting that the fifteenth named a
     * review we do not hold is a better answer than refusing all fifteen.
     */
    fakeAdmin([
      { status: "anchor_set", anchorReviewId: "FIXTURE-ANCHOR-0001", assignedAbove: 3 },
      { status: "review_not_held" },
    ]);

    const outcomes = await applyAnchors(
      [
        { storeCode: "306", externalReviewId: "FIXTURE-ANCHOR-0001" },
        { storeCode: "143", externalReviewId: "FIXTURE-MISSING-0001" },
      ],
      { credentialId: "brave-extension" },
    );

    expect(outcomes[0]).toMatchObject({ storeCode: "306", status: "anchor_set", assignedAbove: 3 });
    expect(outcomes[1]).toMatchObject({ storeCode: "143", status: "review_not_held" });
  });

  it("a baseline assigns nothing, which is what makes it the safe way to start", async () => {
    fakeAdmin([
      { status: "baseline_set", anchorReviewId: "FIXTURE-NEWEST-0001", assignedAbove: 0 },
    ]);

    const [outcome] = await applyAnchors([{ storeCode: "306", fromNewestHeld: true }], {
      credentialId: "brave-extension",
    });

    expect(outcome.status).toBe("baseline_set");
    expect(outcome.assignedAbove).toBe(0);
  });

  it("does not reflect a database error message back to the caller", async () => {
    __setSupabaseAdmin({
      rpc: vi.fn(async () => ({
        data: null,
        error: { code: "22P02", message: 'invalid input for "x" (Tamsin Vale)' },
      })),
    } as unknown as SupabaseClient);

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      applyAnchors([{ storeCode: "306", fromNewestHeld: true }], {
        credentialId: "brave-extension",
      }),
    ).rejects.toThrow(/could not be set/i);

    expect(consoleError).toHaveBeenCalledWith(expect.any(String), "22P02");
  });
});
