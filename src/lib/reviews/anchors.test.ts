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
    ).toEqual([
      { storeCode: "306", externalReviewId: "FIXTURE-ANCHOR-0001", replace: false },
    ]);
  });

  it("accepts a baseline, which names no review", () => {
    expect(normaliseAnchorRequests([{ storeCode: "143", fromNewestHeld: true }])).toEqual([
      { storeCode: "143", fromNewestHeld: true, replace: false },
    ]);
  });

  it("carries `replace` only when the caller said so, in those words", () => {
    /*
     * MOVING AN ANCHOR IS A DIFFERENT REQUEST FROM SETTING ONE, and the
     * difference is one flag. Anything other than a literal `true` — absent,
     * "true", 1, null — means "only if this listing has none", because a bulk
     * baseline that coerced a stray value into consent would silently move
     * fourteen settled boundaries.
     */
    const [asked] = normaliseAnchorRequests([
      { storeCode: "306", fromNewestHeld: true, replace: true },
    ]);
    expect(asked.replace).toBe(true);

    for (const replace of [undefined, false, "true", 1, null, {}]) {
      const [entry] = normaliseAnchorRequests([
        { storeCode: "306", fromNewestHeld: true, replace },
      ]);
      expect(entry.replace, JSON.stringify(replace)).toBe(false);
    }
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
  function fakeAdmin(
    results: Record<string, unknown>[],
    /** The anchors the listings already carry, as the pre-read would find them. */
    anchored: Record<string, string | null> = {},
  ) {
    let call = 0;
    const rpc = vi.fn(async (...args: [name: string, params: unknown]) => {
      void args;
      return { data: results[call++] ?? {}, error: null };
    });
    /*
     * `applyAnchors` READS THE CURRENT ANCHORS BEFORE IT WRITES ANYTHING, so
     * the fake has to answer that too. Scripting it here is what lets the tests
     * below distinguish "this listing was unconfigured" from "this listing was
     * already set up and must be left alone".
     */
    const from = vi.fn((table: string) => {
      expect(table).toBe("google_review_locations");
      return {
        select: () => ({
          in: async (_column: string, codes: string[]) => ({
            data: codes.map((store_code) => ({
              store_code,
              counted_through_external_review_id: anchored[store_code] ?? null,
            })),
            error: null,
          }),
        }),
      };
    });
    __setSupabaseAdmin({ rpc, from } as unknown as SupabaseClient);
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

  it("refuses a listing that already has an anchor, and leaves it where it was", async () => {
    /*
     * NEVER SILENTLY REPLACED. This is the rule the bulk baseline button rests
     * on and the reason the refusal lives here rather than in the screen: a UI
     * is not a boundary, and a stale tab clicking "baseline all" must not move
     * a line somebody set an hour ago.
     */
    const rpc = fakeAdmin([], { "306": "FIXTURE-EXISTING-0001" });

    const [outcome] = await applyAnchors([{ storeCode: "306", fromNewestHeld: true }], {
      credentialId: "admin:qa@example.test",
    });

    expect(outcome).toMatchObject({
      storeCode: "306",
      status: "anchor_exists",
      anchorReviewId: "FIXTURE-EXISTING-0001",
      assignedAbove: 0,
    });
    /* Nothing was written. Not a no-op write — no call at all. */
    expect(rpc).not.toHaveBeenCalled();
  });

  it("moves an existing anchor only when the caller explicitly asked to replace it", async () => {
    /*
     * The separate administrative action. The screen shows the current anchor,
     * says what moving it does, and makes somebody tick a box before it sends
     * this flag — but the flag is what the server acts on.
     */
    const rpc = fakeAdmin(
      [{ status: "anchor_set", anchorReviewId: "FIXTURE-CHOSEN-0009", assignedAbove: 4 }],
      { "306": "FIXTURE-EXISTING-0001" },
    );

    const [outcome] = await applyAnchors(
      [{ storeCode: "306", externalReviewId: "FIXTURE-CHOSEN-0009", replace: true }],
      { credentialId: "admin:qa@example.test" },
    );

    expect(outcome).toMatchObject({ status: "anchor_set", assignedAbove: 4 });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe("google_review_set_anchor");
  });

  it("a bulk baseline touches the unconfigured listings and only those", async () => {
    /*
     * THE WHOLE POINT OF THE BULK BUTTON, and its whole risk. Three listings
     * are asked for; one is already counting. It comes back `anchor_exists`
     * with its original anchor, and only the other two reach the database.
     */
    const rpc = fakeAdmin(
      [
        { status: "baseline_set", anchorReviewId: "FIXTURE-NEWEST-0306", assignedAbove: 0 },
        { status: "baseline_set", anchorReviewId: "FIXTURE-NEWEST-0140", assignedAbove: 0 },
      ],
      { "143": "FIXTURE-SETTLED-0143" },
    );

    const outcomes = await applyAnchors(
      [
        { storeCode: "306", fromNewestHeld: true },
        { storeCode: "143", fromNewestHeld: true },
        { storeCode: "140", fromNewestHeld: true },
      ],
      { credentialId: "admin:qa@example.test" },
    );

    expect(outcomes.map((entry) => [entry.storeCode, entry.status])).toEqual([
      ["306", "baseline_set"],
      ["143", "anchor_exists"],
      ["140", "baseline_set"],
    ]);

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(
      rpc.mock.calls.map((call) => (call[1] as { p_store_code: string }).p_store_code),
    ).toEqual(["306", "140"]);

    /* And the settled listing's own anchor is reported back unchanged. */
    expect(outcomes[1].anchorReviewId).toBe("FIXTURE-SETTLED-0143");
  });

  it("stamps the person who moved the boundary, from the session and not the body", async () => {
    /*
     * `counted_through_set_by` is the audit trail. The admin route derives it
     * from the verified session, so there is no field a caller could put
     * somebody else's name in — which is the only thing that makes it worth
     * reading later.
     */
    const rpc = fakeAdmin([{ status: "baseline_set", assignedAbove: 0 }]);

    await applyAnchors([{ storeCode: "306", fromNewestHeld: true }], {
      credentialId: "admin:paulyne@example.test",
    });

    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_credential_id: "admin:paulyne@example.test",
    });
  });

  it("does not reflect a database error message back to the caller", async () => {
    __setSupabaseAdmin({
      from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }),
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
