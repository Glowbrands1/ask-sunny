import { describe, expect, it } from "vitest";

import { contentRows, effectiveInventory } from "../inventory";
import { MemoryKnowledgeSink, MemoryKnowledgeSyncStore } from "../memory-store";
import type { WovenKnowledgeConfig } from "./config";
import { WovenKnowledgeConnector } from "./connector";
import { WovenTeamClient } from "./http";
import { readWovenKnowledgeContent, readWovenKnowledgeStatus } from "./status";
import { runWovenKnowledgeSync } from "./sync";
import { COMPANY, FakeWoven, PASSWORD, USERNAME, noSleep, uuid } from "./test-support";

/**
 * ============================================================================
 * AUDIENCE CHOICES ARE MADE AFTER THE SCAN, BEFORE THE INITIAL SYNC
 * ============================================================================
 *
 * The live bug: the Production screen said "29 wait for an audience choice
 * above" and showed no choices. A dry run writes no manifest, and the choices
 * were built from the manifest only. The dry run now saves an inventory of
 * what it found (display metadata only), and the choices are built from it.
 */

const CONFIG: WovenKnowledgeConfig = {
  enabled: true,
  baseUrl: "https://app.woven.team",
  company: COMPANY,
  credentials: { username: USERNAME, password: PASSWORD },
  missingCredentials: [],
  problems: [],
  previewTestModeAllowed: false,
};

const TARGETED = "all teams 8 positions";
const NONE = "(none stated)";

class Harness {
  readonly fake = new FakeWoven();
  readonly store: MemoryKnowledgeSyncStore;
  readonly sink = new MemoryKnowledgeSink();
  clock = new Date("2026-09-29T12:00:00Z");

  constructor() {
    this.store = new MemoryKnowledgeSyncStore({ now: () => this.clock });
  }

  run(mode: "preview" | "sync") {
    const connector = new WovenKnowledgeConnector({
      client: new WovenTeamClient({ baseUrl: CONFIG.baseUrl, fetch: this.fake.fetch, sleep: noSleep, transport: { minIntervalMs: 0, baseBackoffMs: 0 } }),
      credentials: CONFIG.credentials!,
      company: COMPANY,
    });
    return runWovenKnowledgeSync({ mode, trigger: "manual", requestedBy: "admin:test" }, { config: CONFIG, store: this.store, sink: this.sink, connector, now: () => this.clock });
  }

  status() {
    return readWovenKnowledgeStatus({ config: CONFIG, store: this.store });
  }

  decide(audienceKey: string, decision: "company_wide" | "excluded") {
    return this.store.saveDecision({ source: "woven", audienceKey, decision, decidedBy: "admin:test", decidedAt: this.clock.toISOString() });
  }
}

describe("the dry run's audience choices", () => {
  it("a preview with targeted policies renders visible audience groups, with labels and counts, and writes no manifest", async () => {
    const h = new Harness();
    const outcome = await h.run("preview");
    expect(outcome.status).toMatch(/^succeeded/);
    expect(h.store.items.size).toBe(0);
    expect(h.sink.ingestCalls).toBe(0);

    const status = await h.status();
    expect(status.setupStep).toBe("initial_sync");
    expect(status.audienceReviews).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ audienceKey: TARGETED, label: "All Teams 8 Positions", items: 2, decision: null }),
        expect.objectContaining({ audienceKey: NONE, label: "No audience stated", items: 4, decision: null }),
      ]),
    );
    /* Every group names what it affects, by title, type, Woven status and sync state — no text, no locator. */
    const targeted = status.audienceReviews.find((a) => a.audienceKey === TARGETED)!;
    expect(targeted.members!.map((m) => [m.title, m.contentType, m.wovenStatus, m.syncState])).toEqual([["Manager Bonus Policy", "policy", "current", "waiting_for_audience"]]);
    const none = status.audienceReviews.find((a) => a.audienceKey === NONE)!;
    expect(none.members!.map((m) => m.title).sort()).toEqual(["Bed Cleaning", "Opening the Salon", "Spray Tan Basics"]);
    expect(none.membersTotal).toBe(3);
    expect(JSON.stringify(status.audienceReviews)).not.toMatch(/locator|Arrive on time|a1b2c3d4|https?:/);
    expect(status.attention.map((a) => a.code)).toContain("audience_review");
  });

  it("needsReview > 0 never coexists with an empty audience panel", async () => {
    const h = new Harness();
    await h.run("preview");
    const status = await h.status();
    const needsReview = status.latestPreview!.totals.needsReview;
    expect(needsReview).toBeGreaterThan(0);
    expect(status.audienceReviews.filter((a) => a.decision === null && a.items > 0).length).toBeGreaterThan(0);
    /* Every held part is in a group: the panel's counts add up to the scan's. */
    expect(status.awaitingAudience).toBe(needsReview);
  });

  it("a decision updates exactly its own group, and the waiting count falls by that group's items", async () => {
    const h = new Harness();
    await h.run("preview");
    const before = await h.status();

    await h.decide(TARGETED, "company_wide");
    const after = await h.status();

    expect(after.audienceReviews.find((a) => a.audienceKey === TARGETED)).toMatchObject({ decision: "company_wide", items: 2 });
    expect(after.audienceReviews.find((a) => a.audienceKey === NONE)).toMatchObject({ decision: null, items: 4 });
    expect(after.awaitingAudience).toBe(before.awaitingAudience - 2);
  });

  it("Initial Sync follows the choices: shared groups are added, kept-out groups are not, undecided groups wait", async () => {
    const h = new Harness();
    await h.run("preview");
    await h.decide(TARGETED, "company_wide");
    await h.decide(NONE, "excluded");

    const outcome = await h.run("sync");
    expect(outcome.status).toMatch(/^succeeded/);

    const items = [...h.store.items.values()];
    const bonus = items.filter((i) => i.entityId === uuid(103));
    expect(bonus.every((i) => i.inAskSunny)).toBe(true);
    const noAudience = items.filter((i) => i.reason === "audience_excluded");
    /* Two procedures' step text, one step attachment, one Knowledge Element. */
    expect(noAudience.length).toBe(4);
    expect(noAudience.every((i) => !i.inAskSunny && i.state === "EXCLUDED")).toBe(true);
    /* Nothing kept out reached Ask Sunny. */
    const synced = new Set(h.sink.searchable().map((d) => d.id));
    expect(noAudience.some((i) => i.knowledgeDocumentId && synced.has(i.knowledgeDocumentId))).toBe(false);
  });

  it("an undecided group is held through the Initial Sync and added once shared", async () => {
    const h = new Harness();
    await h.run("preview");
    await h.run("sync");
    const held = [...h.store.items.values()].filter((i) => i.audience?.includes("All Teams 8 Positions"));
    expect(held.every((i) => i.state === "NEEDS_REVIEW" && !i.inAskSunny)).toBe(true);

    await h.decide(TARGETED, "company_wide");
    h.clock = new Date(h.clock.getTime() + 60_000);
    await h.run("sync");
    expect([...h.store.items.values()].filter((i) => i.audience?.includes("All Teams 8 Positions")).every((i) => i.inAskSunny)).toBe(true);
  });

  it("the inventory is display metadata only: no locator, no body text, no URL, no credential", async () => {
    const h = new Harness();
    await h.run("preview");
    expect(h.store.preview.length).toBeGreaterThan(0);
    const saved = JSON.stringify(h.store.preview);
    for (const secret of ["locator", "Fingerprint", "contentHash", "sig=", "blob.core.windows.net", "https://", PASSWORD, "WovenSession", "login-token", "Arrive on time"]) {
      expect(saved, secret).not.toContain(secret);
    }
  });
});

describe("the Content view", () => {
  it("before the initial sync, lists what the scan found: one row per Woven item, parts expandable", async () => {
    const h = new Harness();
    await h.run("preview");
    const content = await readWovenKnowledgeContent({ store: h.store });

    expect(content.basis).toBe("latest_scan");
    const attendance = content.rows.find((r) => r.title === "Attendance Policy")!;
    expect(attendance).toMatchObject({ contentType: "policy", wovenStatus: "current", audience: "Public", audienceDecision: "public", version: "Version 2", syncState: "new", lastSyncedAt: null, askSunny: [] });
    expect(attendance.parts.map((p) => [p.kind, p.syncState])).toEqual([
      ["body", "new"],
      ["attachment", "new"],
    ]);
    /* One row per record, not per part. */
    expect(content.rows.filter((r) => r.title === "Attendance Policy")).toHaveLength(1);

    expect(content.rows.find((r) => r.title === "Manager Bonus Policy")).toMatchObject({ syncState: "waiting_for_audience", audienceDecision: null });
    expect(content.rows.find((r) => r.title === "Draft Handbook")).toMatchObject({ syncState: "unpublished", published: false });
    expect(content.rows.find((r) => r.title === "Welcome Video")).toMatchObject({ syncState: "not_supported" });
    expect(content.rows.find((r) => r.title === "Lotion Guide")).toMatchObject({ syncState: "new", published: true });
    /* A procedure's parts: its step text, and each attachment by the name people see — never the stored name. */
    const opening = content.rows.find((r) => r.title === "Opening the Salon")!;
    expect(opening.parts.map((p) => [p.kind, p.fileName ?? p.title])).toEqual([
      ["body", "Opening the Salon"],
      ["attachment", "Opening Checklist.pdf"],
    ]);
    expect(JSON.stringify(opening)).not.toContain("a1b2c3d4-0000");
  });

  it("a decision shows at once: the waiting item reads as new, before any sync", async () => {
    const h = new Harness();
    await h.run("preview");
    await h.decide(TARGETED, "company_wide");
    const content = await readWovenKnowledgeContent({ store: h.store });
    expect(content.rows.find((r) => r.title === "Manager Bonus Policy")).toMatchObject({ syncState: "new", audienceDecision: "company_wide" });
  });

  it("after the initial sync, reads the manifest: synced items are up to date and link their Ask Sunny documents", async () => {
    const h = new Harness();
    await h.run("preview");
    await h.run("sync");
    const content = await readWovenKnowledgeContent({
      store: h.store,
      documentTitles: async (ids) => new Map(ids.map((id) => [id, `Doc ${id.slice(0, 4)}`])),
    });
    expect(content.basis).toBe("manifest");
    const attendance = content.rows.find((r) => r.title === "Attendance Policy")!;
    expect(attendance.syncState).toBe("up_to_date");
    expect(attendance.lastSyncedAt).not.toBeNull();
    expect(attendance.askSunny).toHaveLength(2);
    expect(attendance.askSunny[0]!.title).toMatch(/^Doc /);
  });

  it("never invents a Woven date", () => {
    const [row] = contentRows(
      effectiveInventory(
        [],
        [
          {
            contentType: "procedure",
            entityId: "p1",
            partKey: "content",
            recordTitle: "Opening the salon",
            title: "Opening the salon",
            status: "Listed",
            audience: null,
            version: null,
            sourceUpdatedAt: null,
            fileName: null,
            state: "BLOCKED",
            reason: "procedure_content",
            pendingAction: "none",
            knowledgeDocumentId: null,
            inAskSunny: false,
            errorCategory: null,
            retryCount: 0,
            firstSeenAt: "2026-09-29T12:00:00Z",
            lastSeenAt: "2026-09-29T12:00:00Z",
            lastSyncedAt: null,
          },
        ],
        false,
      ),
      [],
    );
    expect(row!.wovenUpdatedAt).toBeNull();
    expect(row!.syncState).toBe("not_supported");
  });
});

describe("Scan Woven after setup: a preview that changes nothing", () => {
  async function setUp() {
    const h = new Harness();
    await h.run("preview");
    await h.decide(NONE, "company_wide");
    h.clock = new Date(h.clock.getTime() + 60_000);
    await h.run("sync");
    await h.store.saveSettings({ ...h.store.settings, autoSyncEnabled: true });
    h.clock = new Date(h.clock.getTime() + 86_400_000);
    return h;
  }

  it("reads Woven, classifies, shows what Sync Now would do — and writes nothing to Ask Sunny, the manifest or the schedule", async () => {
    const h = await setUp();
    const manifestBefore = JSON.stringify([...h.store.items.values()]);
    const settingsBefore = { ...h.store.settings };
    const calls = h.sink.ingestCalls + h.sink.metadataCalls + h.sink.retireCalls;

    /* Woven changes: a new policy, an unpublished one, an updated handbook. */
    h.fake.state.policies.push({ id: uuid(120), title: "Phone Policy", status: "current", audience: "Public", updated: "10/1/2026", body: "Phones stay in the break room.", version: "Version 1", attachments: [] });
    h.fake.state.policies[1]!.status = "draft";
    Object.assign(h.fake.state.handbooks[0]!, { currentVersionId: uuid(2199), updatedOn: "2026-10-01T08:00:00" });

    const outcome = await h.run("preview");
    expect(outcome.status).toMatch(/^succeeded/);
    /* Nothing applied. */
    expect(h.sink.ingestCalls + h.sink.metadataCalls + h.sink.retireCalls).toBe(calls);
    expect(JSON.stringify([...h.store.items.values()])).toBe(manifestBefore);
    expect(h.store.settings).toEqual(settingsBefore);

    const status = await h.status();
    expect(status.latestPreview?.totals).toMatchObject({ new: 1, updated: 1, unpublished: 1 });
    expect(status.nextSyncAt).toBe(settingsBefore.lastFullScanAt ? new Date(Date.parse(settingsBefore.lastFullScanAt) + 30 * 86_400_000).toISOString() : null);

    /* The Content view shows the items under the scan: the new policy, and the handbook as updated. */
    const content = await readWovenKnowledgeContent({ store: h.store });
    expect(content.basis).toBe("latest_scan");
    expect(content.rows.find((r) => r.title === "Phone Policy")).toMatchObject({ syncState: "new" });
    expect(content.rows.find((r) => r.title === "Team Member Handbook")).toMatchObject({ syncState: "updated" });

    /* Sync Now then applies it, and the scan is no longer "newer". */
    h.clock = new Date(h.clock.getTime() + 60_000);
    await h.run("sync");
    expect((await h.status()).latestPreview).toBeNull();
    expect((await readWovenKnowledgeContent({ store: h.store })).basis).toBe("manifest");
  });

  it("reports what it could not read, in plain words", async () => {
    const h = await setUp();
    h.fake.failures.set("/Policy", 500);
    await h.run("preview");
    const status = await h.status();
    expect(status.scanProblems).toContain("Policies could not be read from Woven this time; Policies will be left as they are.");
    expect(status.scanProblems.join(" ")).not.toMatch(/\/Policy|woven_|http/);
  });
});

describe("Needs attention says exactly what it is about", () => {
  it("unfinished work: counted from the manifest now, as items, continued at the next hourly check", async () => {
    const h = new Harness();
    await h.run("preview");
    await h.run("sync");
    await h.store.saveSettings({ ...h.store.settings, autoSyncEnabled: true });
    const pending = [...h.store.items.values()].filter((i) => i.pendingAction === "none" && i.inAskSunny).slice(0, 2);
    for (const item of pending) h.store.items.set(`woven\u0000${item.contentType}\u0000${item.entityId}\u0000${item.partKey}`, { ...item, pendingAction: "ingest" });
    const status = await h.status();
    expect(status.attention.find((a) => a.code === "work_continues")).toMatchObject({
      message: "2 items are still being processed. Ask Sunny continues them automatically at the next hourly check.",
      count: 2,
    });
    await h.store.saveSettings({ ...h.store.settings, autoSyncEnabled: false });
    expect((await h.status()).attention.find((a) => a.code === "work_continues")!.message).toMatch(/Automatic sync is off, so they continue when you press Sync Now/);
  });

  it("a document that keeps failing is named, with its type, a plain reason and its retry status", async () => {
    const h = new Harness();
    await h.run("preview");
    await h.run("sync");
    const item = [...h.store.items.values()].find((i) => i.contentType === "handbook" && i.inAskSunny)!;
    h.store.items.set(`woven\u0000${item.contentType}\u0000${item.entityId}\u0000${item.partKey}`, {
      ...item,
      state: "ERROR",
      errorCategory: "ingest_no_text",
      lastError: "No text could be extracted from this PDF.",
      retryCount: 5,
      nextRetryAt: null,
    });
    const failing = (await h.status()).attention.find((a) => a.code === "items_failing")!;
    expect(failing.items).toEqual([
      {
        title: "Team Member Handbook",
        contentType: "handbook",
        reason: "No text could be read from this file — it looks like a scanned image. A searchable PDF (or a text version) in Woven would fix it.",
        retry: "stopped",
        nextRetryAt: null,
        rowKey: `handbook:${item.entityId}`,
      },
    ]);
    expect(JSON.stringify(failing)).not.toMatch(/ingest_no_text|stack|Error:/);
  });
});
