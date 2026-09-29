import { describe, expect, it } from "vitest";

import { parseSyncRequest, SAVE_CONFIRMATION_FIELD, STORED_SYNC_REQUEST } from "./sync-request";

describe("parseSyncRequest: a save needs dryRun === false AND confirmSave === true", () => {
  it("the one stored-sync body is exactly { dryRun: false, confirmSave: true }", () => {
    expect(STORED_SYNC_REQUEST).toEqual({ dryRun: false, confirmSave: true });
    expect(SAVE_CONFIRMATION_FIELD).toBe("confirmSave");
    expect(parseSyncRequest(STORED_SYNC_REQUEST)).toEqual({ kind: "save" });
  });

  it.each([
    {},
    { dryRun: true },
    { dryRun: "false" },
    { dryRun: 0 },
    { dryRun: null },
    { confirmSave: true },
    { dryRun: true, confirmSave: true },
    { dryRun: "false", confirmSave: true },
  ])("%j is a dry run", (body) => {
    expect(parseSyncRequest(body)).toEqual({ kind: "dry_run" });
  });

  it.each([
    { dryRun: false },
    { dryRun: false, confirmSave: false },
    { dryRun: false, confirmSave: "true" },
    { dryRun: false, confirmSave: 1 },
    { dryRun: false, confirmSave: null },
    { dryRun: false, confirm: true },
  ])("%j is refused, not downgraded", (body) => {
    const result = parseSyncRequest(body);
    expect(result.kind).toBe("confirmation_required");
    if (result.kind === "confirmation_required") expect(result.reason).toContain("confirmSave");
  });
});
