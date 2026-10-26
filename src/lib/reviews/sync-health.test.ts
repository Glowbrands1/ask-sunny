import { afterEach, describe, expect, it } from "vitest";

import { INTEGRATION_PATH, staleBannerEnabled, syncNotice } from "./sync-health";

/**
 * GOOGLE_REVIEWS_STALE_BANNER_ENABLED (QA, 25 Oct 2026): /reviews says so
 * when the review sync is more than two days old. Production's last accepted
 * sync was 25 Oct 11:01 UTC, so on the 26th the page is current and says
 * nothing; three days without a sync is called out.
 */

const LAST_SYNC = "2026-10-25T11:01:00.000Z";

afterEach(() => {
  delete process.env.GOOGLE_REVIEWS_STALE_BANNER_ENABLED;
});

describe("the /reviews sync notice", () => {
  it("is off by default", () => {
    expect(staleBannerEnabled()).toBe(false);
    process.env.GOOGLE_REVIEWS_STALE_BANNER_ENABLED = "true";
    expect(staleBannerEnabled()).toBe(true);
  });

  it("a sync within two days says nothing", () => {
    expect(syncNotice({ lastSyncAt: LAST_SYNC, now: new Date("2026-10-26T09:00:00.000Z"), canManage: true })).toBeNull();
  });

  it("three days without a sync is called out, with the integration screen for an administrator", () => {
    const notice = syncNotice({ lastSyncAt: LAST_SYNC, now: new Date("2026-10-28T12:00:00.000Z"), canManage: true });
    expect(notice?.title).toBe("Google reviews are not up to date");
    expect(notice?.body).toContain("Google reviews have not synced since");
    expect(notice?.body).toContain("(Central time). The figures below are as of then.");
    expect(notice?.body).toContain("Check the Google Reviews integration screen.");
    expect(notice?.href).toBe(INTEGRATION_PATH);
  });

  it("anyone else is told the same, without a link they cannot open", () => {
    const notice = syncNotice({ lastSyncAt: LAST_SYNC, now: new Date("2026-10-28T12:00:00.000Z"), canManage: false });
    expect(notice?.body).toContain("An administrator needs to check the Google review sync.");
    expect(notice?.href).toBeNull();
  });

  it("no sync at all is said plainly", () => {
    expect(syncNotice({ lastSyncAt: null, now: new Date("2026-10-26T09:00:00.000Z"), canManage: false })?.body).toContain(
      "No Google review sync has been recorded yet.",
    );
  });
});
