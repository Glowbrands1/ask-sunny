import { describe, expect, it } from "vitest";

import { MAX_AUTOMATIC_RETRIES, type RunOutcome } from "../engine";
import { MemoryKnowledgeSink, MemoryKnowledgeSyncStore } from "../memory-store";
import { MASS_REMOVAL_FLOOR } from "../reconcile";
import { SinkError, type KnowledgeSyncStore } from "../ports";
import { KnowledgeSyncStoreError } from "../store";
import { previewTestModeAllowed } from "./config";
import { readWovenKnowledgeStatus } from "./status";
import type { ManifestItem } from "../types";
import type { WovenKnowledgeConfig } from "./config";
import { WovenKnowledgeConnector } from "./connector";
import { WovenTeamClient } from "./http";
import { decideScheduledWork, nextAutomaticSyncAt, readOnlySink, runScheduledWovenKnowledgeTick, runWovenKnowledgeSync, testWovenConnection, type WovenRunOutcome } from "./sync";
import { COMPANY, FakeWoven, PASSWORD, USERNAME, noSleep, uuid } from "./test-support";

const CONFIG: WovenKnowledgeConfig = {
  enabled: true,
  baseUrl: "https://app.woven.team",
  company: COMPANY,
  credentials: { username: USERNAME, password: PASSWORD },
  missingCredentials: [],
  problems: [],
  previewTestModeAllowed: false,
};

const HANDBOOK = `handbook\u0000${uuid(201)}\u0000current-version`;
const ATTENDANCE = `policy\u0000${uuid(101)}\u0000attachment:${uuid(1101)}`;
const BONUS = `policy\u0000${uuid(103)}\u0000attachment:${uuid(1103)}`;
const ATTENDANCE_BODY = `policy\u0000${uuid(101)}\u0000content`;

class Harness {
  readonly fake = new FakeWoven();
  readonly store: MemoryKnowledgeSyncStore;
  readonly sink = new MemoryKnowledgeSink();
  clock = new Date("2026-09-29T12:00:00Z");
  deadlineAfterItems: number | null = null;

  constructor() {
    this.store = new MemoryKnowledgeSyncStore({ now: () => this.clock });
  }

  connector() {
    return new WovenKnowledgeConnector({
      client: new WovenTeamClient({ baseUrl: CONFIG.baseUrl, fetch: this.fake.fetch, sleep: noSleep, transport: { minIntervalMs: 0, baseBackoffMs: 0 } }),
      credentials: CONFIG.credentials!,
      company: COMPANY,
    });
  }

  overrides() {
    return { config: CONFIG, store: this.store, sink: this.sink, connector: this.connector(), now: () => this.clock };
  }

  run(mode: "preview" | "sync" | "continue", extra: { trigger?: "manual" | "schedule"; confirmLargeRemoval?: boolean } = {}) {
    return runWovenKnowledgeSync({ mode, trigger: extra.trigger ?? "manual", requestedBy: "admin:test", confirmLargeRemoval: extra.confirmLargeRemoval }, this.overrides());
  }

  item(key: string): ManifestItem {
    const found = this.store.items.get(`woven\u0000${key}`);
    if (!found) throw new Error(`no manifest item ${key}`);
    return found;
  }

  advanceDays(days: number) {
    this.clock = new Date(this.clock.getTime() + days * 86_400_000);
  }

  /** Preview then the initial sync: the setup flow. */
  async initial() {
    expect((await this.run("preview")).status).toMatch(/^succeeded/);
    const outcome = await this.run("sync");
    expect(outcome.status).toMatch(/^succeeded/);
    return outcome;
  }
}

function report(outcome: WovenRunOutcome | { status: "skipped"; reason: string }) {
  if (!("report" in outcome)) throw new Error(`no report: ${JSON.stringify(outcome)}`);
  return (outcome as Extract<RunOutcome, { report: unknown }>).report;
}

describe("setup safety", () => {
  it("does nothing at all while switched off or without credentials", async () => {
    const h = new Harness();
    const off = await runWovenKnowledgeSync({ mode: "sync", trigger: "manual", requestedBy: "x" }, { ...h.overrides(), config: { ...CONFIG, enabled: false } });
    expect(off.status).toBe("disabled");
    const missing = await runWovenKnowledgeSync(
      { mode: "sync", trigger: "manual", requestedBy: "x" },
      { ...h.overrides(), config: { ...CONFIG, credentials: null, missingCredentials: ["WOVEN_TEAM_PASSWORD"] } },
    );
    expect(missing).toEqual({ status: "not_configured", missing: ["WOVEN_TEAM_PASSWORD"] });
    expect(h.fake.log).toHaveLength(0);
  });

  it("refuses the initial sync until a preview has been run", async () => {
    const h = new Harness();
    expect(await h.run("sync")).toMatchObject({ status: "refused", code: "preview_required" });
    expect(h.fake.log).toHaveLength(0);
  });

  it("never lets the schedule perform the initial sync", async () => {
    const h = new Harness();
    await h.run("preview");
    expect(await h.run("sync", { trigger: "schedule" })).toMatchObject({ status: "refused", code: "initial_sync_not_done" });
  });

  it("dry run: counts everything, writes nothing to the manifest or Ask Sunny", async () => {
    const h = new Harness();
    const outcome = await h.run("preview");
    const r = report(outcome);

    expect(h.store.items.size).toBe(0);
    expect(h.sink.ingestCalls).toBe(0);
    expect(r.company).toEqual({ companyLabel: COMPANY, companyVerified: true });
    /* Policies: two bodies and one attachment are Public; the Targeted policy's body and attachment wait for review. */
    expect(r.byType.policy).toMatchObject({ discovered: 3, items: 5, eligible: 5, needsReview: 2, blocked: 0, new: 3 });
    expect(r.byType.handbook).toMatchObject({ discovered: 2, new: 1, excludedUnpublished: 1 });
    /* Procedures: step text is readable but states no audience; the attachment file stays blocked. */
    expect(r.byType.procedure).toMatchObject({ discovered: 2, needsReview: 2, blocked: 1, blockedCapabilities: ["procedure_attachment_download"] });
    expect(r.byType.file_library).toMatchObject({ discovered: 3, blocked: 1, excludedUnsupported: 1, excludedUnpublished: 1 });
    expect(r.byType.knowledge_element).toMatchObject({ discovered: 2, needsReview: 1, blocked: 0, excludedUnpublished: 1 });
    expect(r.byType.course).toMatchObject({ blocked: 1, blockedCapabilities: ["course_content"] });
    expect(r.totals).toMatchObject({ discovered: 13, new: 4, needsReview: 5, blocked: 3 });
    expect(r.audiences).toEqual(
      expect.arrayContaining([
        { audienceKey: "public", label: "Public", items: 4, decision: "public" },
        /* The display summary is never read as Public. */
        { audienceKey: "all teams 8 positions", label: "All Teams 8 Positions", items: 2, decision: null },
        { audienceKey: "(none stated)", label: "No audience stated", items: 3, decision: null },
      ]),
    );
    expect(r.attention.map((a) => a.code)).toContain("audience_review");
    expect(h.store.runs[0]).toMatchObject({ mode: "preview", status: "succeeded" });
  });
});

describe("the monthly cycle", () => {
  it("initial discovery ingests only published, company-wide, downloadable content", async () => {
    const h = new Harness();
    const r = report(await h.initial());

    expect(h.sink.searchable().map((d) => d.title).sort()).toEqual(["Attendance Policy", "Attendance Policy (PDF)", "Dress Code", "Team Member Handbook"]);
    expect(r.totals).toMatchObject({ new: 4, inSync: 4, errors: 0 });
    expect(h.item(HANDBOOK)).toMatchObject({ state: "NEW", inAskSunny: true, pendingAction: "none", versionId: uuid(2101) });
    expect(h.item(HANDBOOK).contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(h.item(BONUS)).toMatchObject({ state: "NEEDS_REVIEW", inAskSunny: false });
    const doc = h.sink.documents.get(h.item(HANDBOOK).knowledgeDocumentId!)!;
    expect(doc).toMatchObject({ category: "policies_compliance", tags: ["woven", "woven-handbook"], fileName: "Team Member Handbook.pdf" });
    expect(h.store.settings.initialSyncCompletedAt).not.toBeNull();
    expect(h.store.events.filter((e) => e.action === "ingest" && e.result === "ok")).toHaveLength(4);
    /* A policy body is ingested as its own text document, titled and in reading order. */
    const body = h.sink.documents.get(h.item(ATTENDANCE_BODY).knowledgeDocumentId!)!;
    expect(body).toMatchObject({ mimeType: "text/plain", title: "Attendance Policy", tags: ["woven", "woven-policy"] });
    expect(new TextDecoder().decode(body.bytes)).toBe("Attendance Policy\n\nArrive on time.\n\nCall the salon if you will be late.\n");
  });

  it("a second run with nothing changed downloads and re-indexes nothing", async () => {
    const h = new Harness();
    await h.initial();
    const blobsBefore = h.fake.blobRequests.length;
    const r = report(await h.run("sync"));
    expect(h.sink.ingestCalls).toBe(4);
    expect(h.fake.blobRequests.length).toBe(blobsBefore);
    expect(r.totals).toMatchObject({ new: 0, updated: 0, unchanged: 4, inSync: 4 });
  });

  it("new file: a policy attachment added in Woven is ingested next run", async () => {
    const h = new Harness();
    await h.initial();
    h.fake.state.policies[1]!.attachments.push({ documentId: uuid(1102), name: "Dress Code.pdf", size: 10, contentType: "application/pdf", bytes: "%PDF dress" });
    const r = report(await h.run("sync"));
    expect(r.totals.new).toBe(1);
    expect(h.sink.searchable().map((d) => d.title)).toContain("Dress Code");
  });

  it("updated version: a new handbook version replaces the same Ask Sunny document", async () => {
    const h = new Harness();
    await h.initial();
    const id = h.item(HANDBOOK).knowledgeDocumentId;
    Object.assign(h.fake.state.handbooks[0]!, { currentVersionId: uuid(2102), updatedOn: "2026-10-20T08:00:00", bytes: "%PDF handbook v2" });
    const r = report(await h.run("sync"));
    expect(r.totals.updated).toBe(1);
    expect(h.item(HANDBOOK).knowledgeDocumentId).toBe(id);
    const doc = h.sink.documents.get(id!)!;
    expect(new TextDecoder().decode(doc.bytes)).toBe("%PDF handbook v2");
    expect(doc.version).toBe(2);
    expect(h.sink.documents.size).toBe(4);
  });

  it("changed file contents under the same name are re-indexed", async () => {
    const h = new Harness();
    await h.initial();
    Object.assign(h.fake.state.policies[0]!, { updated: "10/1/2026" });
    h.fake.state.policies[0]!.attachments[0]!.bytes = "%PDF attendance v2";
    const r = report(await h.run("sync"));
    /* The attachment's bytes changed: re-indexed. The body text did not: metadata only. */
    expect(h.sink.ingestCalls).toBe(5);
    expect(r.totals.metadataOnly).toBe(1);
    expect(h.store.events.filter((e) => e.partKey === `attachment:${uuid(1101)}`).at(-1)).toMatchObject({ action: "update", result: "ok" });
  });

  it("filename-only change: same bytes, so metadata is updated and nothing is re-indexed", async () => {
    const h = new Harness();
    await h.initial();
    h.fake.state.handbooks[0]!.name = "Team Member Handbook 2026";
    h.fake.state.handbooks[0]!.fileName = "TMH-2026.pdf";
    const r = report(await h.run("sync"));
    expect(r.totals.metadataOnly).toBe(1);
    expect(h.sink.ingestCalls).toBe(4);
    expect(h.sink.documents.get(h.item(HANDBOOK).knowledgeDocumentId!)!.title).toBe("Team Member Handbook 2026");
  });

  it("permission change: an item narrowed to some teams leaves Ask Sunny, and returns when shared again", async () => {
    const h = new Harness();
    await h.initial();
    h.fake.state.handbooks[0]!.audience = "Salon Directors";
    let r = report(await h.run("sync"));
    expect(r.totals.permissionChanged).toBe(1);
    expect(h.item(HANDBOOK)).toMatchObject({ state: "PERMISSION_CHANGED", inAskSunny: false, reason: "audience_needs_review" });
    expect(h.sink.searchable().map((d) => d.title)).not.toContain("Team Member Handbook");

    /* An administrator decides that audience may be shared with everyone. */
    await h.store.saveDecision({ source: "woven", audienceKey: "salon directors", decision: "company_wide", decidedBy: "admin:test", decidedAt: h.clock.toISOString() });
    r = report(await h.run("sync"));
    expect(h.item(HANDBOOK)).toMatchObject({ state: "PERMISSION_CHANGED", inAskSunny: true });
    /* Restored under the SAME document id: no duplicate. */
    expect(h.sink.documents.size).toBe(4);
    expect(h.sink.searchable()).toHaveLength(4);
  });

  it("an audience decision to share brings a held item in; to exclude keeps it out", async () => {
    const h = new Harness();
    await h.initial();
    /* Woven's display summary for a Targeted policy is the audience label decided on. */
    await h.store.saveDecision({ source: "woven", audienceKey: "all teams 8 positions", decision: "excluded", decidedBy: "admin:test", decidedAt: h.clock.toISOString() });
    await h.run("sync");
    expect(h.item(BONUS)).toMatchObject({ state: "EXCLUDED", reason: "audience_excluded", inAskSunny: false });
    await h.store.saveDecision({ source: "woven", audienceKey: "all teams 8 positions", decision: "company_wide", decidedBy: "admin:test", decidedAt: h.clock.toISOString() });
    await h.run("sync");
    expect(h.item(BONUS)).toMatchObject({ inAskSunny: true });
  });

  it("procedure steps and Knowledge Element text sync once their audience is decided; attachment files stay blocked", async () => {
    const h = new Harness();
    await h.initial();
    expect(h.sink.searchable().map((d) => d.title)).not.toContain("Opening the Salon");
    await h.store.saveDecision({ source: "woven", audienceKey: "(none stated)", decision: "company_wide", decidedBy: "admin:test", decidedAt: h.clock.toISOString() });
    const r = report(await h.run("sync"));
    expect(r.totals.new).toBe(3);
    const titles = h.sink.searchable().map((d) => d.title);
    expect(titles).toEqual(expect.arrayContaining(["Opening the Salon", "Bed Cleaning", "Spray Tan Basics"]));
    const steps = h.sink.documents.get(h.item(`procedure\u0000${uuid(301)}\u0000content`).knowledgeDocumentId!)!;
    expect(steps).toMatchObject({ category: "operations", mimeType: "text/plain" });
    expect(h.item(`procedure\u0000${uuid(301)}\u0000attachment:${uuid(3111)}`)).toMatchObject({ state: "BLOCKED", reason: "procedure_attachment_download", inAskSunny: false });
    /* No procedure attachment download was ever attempted. */
    expect(h.fake.log.some((r) => /DownloadProcedure|procedure\/.*\.pdf/i.test(r.url))).toBe(false);
  });

  it("a Targeted policy is held for review even though its display text says All Teams", async () => {
    const h = new Harness();
    await h.initial();
    expect(h.item(`policy\u0000${uuid(103)}\u0000content`)).toMatchObject({ state: "NEEDS_REVIEW", reason: "audience_needs_review", inAskSunny: false });
  });

  it("unpublished: a document switched to draft is retired, not deleted", async () => {
    const h = new Harness();
    await h.initial();
    h.fake.state.policies[0]!.status = "draft";
    const r = report(await h.run("sync"));
    /* The policy's body and its attachment. */
    expect(r.totals.unpublished).toBe(2);
    expect(h.item(ATTENDANCE)).toMatchObject({ state: "UNPUBLISHED", inAskSunny: false });
    const doc = h.sink.documents.get(h.item(ATTENDANCE).knowledgeDocumentId!)!;
    expect(doc.retired).toBe(true);
  });

  it("removed: a document gone from a complete listing is retired", async () => {
    const h = new Harness();
    await h.initial();
    h.fake.state.policies.splice(0, 1);
    const r = report(await h.run("sync"));
    expect(r.totals.removed).toBe(2);
    expect(h.item(ATTENDANCE)).toMatchObject({ state: "REMOVED", reason: "not_in_source", inAskSunny: false });
    /* It stays removed quietly on later runs. */
    const again = report(await h.run("sync"));
    expect(again.totals.removed).toBe(0);
  });

  it("re-publishing a removed document restores the same Ask Sunny document", async () => {
    const h = new Harness();
    await h.initial();
    const saved = h.fake.state.policies.splice(0, 1);
    await h.run("sync");
    h.fake.state.policies.unshift(...saved);
    await h.run("sync");
    expect(h.item(ATTENDANCE).inAskSunny).toBe(true);
    expect(h.sink.documents.size).toBe(4);
  });
});

describe("protection against accidental mass removal", () => {
  it("a failed listing leaves that type untouched while the others sync", async () => {
    const h = new Harness();
    await h.initial();
    h.advanceDays(1);
    h.fake.failures.set("/Policy", 500);
    h.fake.state.handbooks[0]!.bytes = "%PDF handbook v9";
    h.fake.state.handbooks[0]!.currentVersionId = uuid(2109);
    const outcome = await h.run("sync");
    const r = report(outcome);
    expect(outcome.status).toBe("succeeded_with_warnings");
    expect(r.byType.policy).toMatchObject({ listing: "failed" });
    expect(h.item(ATTENDANCE)).toMatchObject({ inAskSunny: true, state: "NEW" });
    expect(r.totals.updated).toBe(1);
    expect(r.attention.map((a) => a.code)).toContain("listing_failed_policy");
    /* A scan with a failed listing is not a complete scan: the schedule tries again tomorrow. */
    expect(h.store.settings.lastFullScanAt).not.toBe(h.clock.toISOString());
  });

  it("an EMPTY policy list is not believed: nothing is removed", async () => {
    const h = new Harness();
    await h.initial();
    h.fake.state.policies = [];
    const r = report(await h.run("sync"));
    expect(r.byType.policy).toMatchObject({ listing: "not_trusted", listingCode: "empty_listing" });
    expect(h.item(ATTENDANCE).inAskSunny).toBe(true);
    expect(h.sink.retireCalls).toBe(0);
  });

  it("an expired session answered with a login page never becomes an empty dataset", async () => {
    const h = new Harness();
    await h.initial();
    h.fake.loginInstead.add("/KnowledgeCenter/_Handbooks_List_ForDataTable");
    const r = report(await h.run("sync"));
    expect(r.byType.handbook!.listing).toBe("failed");
    expect(h.item(HANDBOOK).inAskSunny).toBe(true);
  });

  it("every listing failing fails the run and changes nothing", async () => {
    const h = new Harness();
    await h.initial();
    for (const p of ["/Policy", "/KnowledgeCenter/_Handbooks_List_ForDataTable", "/KnowledgeCenter/_Search_Procedures", "/FileLibrary/_FileLibrary_Management_List_ForDataTable", "/KnowledgeElement/_KnowledgeElement_List_ForDataTable", "/Course/_Course_List_ForDataTable"]) {
      h.fake.failures.set(p, 503);
    }
    const outcome = await h.run("sync");
    expect(outcome.status).toBe("failed");
    expect(h.sink.searchable()).toHaveLength(4);
  });

  it("an incorrect login response fails the run before anything is read", async () => {
    const h = new Harness();
    await h.initial();
    h.fake.state.otherCompany = "Another Company";
    const outcome = await h.run("sync");
    expect(outcome).toMatchObject({ status: "failed", errorCode: "woven_company_not_verified" });
    expect(report(outcome).attention[0]!.message).toMatch(/needs attention/);
    expect(h.sink.searchable()).toHaveLength(4);
  });

  it("holds a mass removal until an administrator confirms it", async () => {
    const h = new Harness();
    for (let i = 0; i < MASS_REMOVAL_FLOOR + 5; i += 1) {
      h.fake.state.handbooks.push({ ...h.fake.state.handbooks[0]!, id: uuid(900 + i), name: `Handbook ${i}`, currentVersionId: uuid(9900 + i), bytes: `%PDF ${i}` });
    }
    await h.initial();
    const before = h.sink.searchable().length;
    for (const hb of h.fake.state.handbooks) hb.status = "Unpublished";
    const held = report(await h.run("sync"));
    expect(held.totals.removalsHeld).toBeGreaterThan(MASS_REMOVAL_FLOOR);
    expect(h.sink.searchable()).toHaveLength(before);
    expect(held.attention.map((a) => a.code)).toContain("mass_removal_held");

    await h.run("sync", { confirmLargeRemoval: true });
    expect(h.sink.searchable().map((d) => d.title).sort()).toEqual(["Attendance Policy", "Attendance Policy (PDF)", "Dress Code"]);
  });
});

describe("failures stay local, and recover", () => {
  it("one failed download does not stop the rest; it is retried by the next continue run", async () => {
    const h = new Harness();
    await h.run("preview");
    h.fake.expireNextLinks = 2;
    const outcome = await h.run("sync");
    expect(outcome.status).toBe("succeeded_with_warnings");
    const errored = [...h.store.items.values()].filter((i) => i.state === "ERROR");
    expect(errored).toHaveLength(1);
    expect(errored[0]).toMatchObject({ errorCategory: "woven_download_link_expired", retryCount: 1, pendingAction: "ingest" });
    expect(h.sink.searchable()).toHaveLength(3);

    /* Not due yet: the continue run is refused without signing in. */
    const logins = h.fake.logins;
    expect(await h.run("continue")).toMatchObject({ status: "refused", code: "nothing_to_continue" });
    expect(h.fake.logins).toBe(logins);

    h.advanceDays(1);
    const retry = await h.run("continue");
    expect(retry.status).toBe("succeeded");
    expect(h.sink.searchable()).toHaveLength(4);
    /* The items that had already succeeded were not ingested again. */
    expect(h.sink.ingestCalls).toBe(4);
  });

  it("an item that fails twice and then succeeds reports its real classification", async () => {
    const h = new Harness();
    await h.run("preview");
    /* Each failed download spends two links: the first try and one refresh. */
    h.fake.expireNextLinks = 2;
    await h.run("sync");
    h.advanceDays(1);
    h.fake.expireNextLinks = 2;
    await h.run("continue");
    const failing = [...h.store.items.values()].find((i) => i.state === "ERROR")!;
    expect(failing.retryCount).toBe(2);
    h.advanceDays(1);
    await h.run("continue");
    const recovered = h.store.items.get(`woven\u0000${failing.contentType}\u0000${failing.entityId}\u0000${failing.partKey}`)!;
    expect(recovered).toMatchObject({ state: "NEW", inAskSunny: true, retryCount: 0, lastError: null });
  });

  it("retry is idempotent: a crash after the document id was saved reuses it", async () => {
    const h = new Harness();
    await h.run("preview");
    h.sink.failNextIngest = new SinkError("ingest_embedding_failed", "Embedding failed.");
    await h.run("sync");
    const failed = [...h.store.items.values()].find((i) => i.state === "ERROR")!;
    expect(failed.knowledgeDocumentId).not.toBeNull();
    h.advanceDays(1);
    await h.run("continue");
    const after = h.store.items.get(`woven\u0000${failed.contentType}\u0000${failed.entityId}\u0000${failed.partKey}`)!;
    expect(after.knowledgeDocumentId).toBe(failed.knowledgeDocumentId);
    expect(h.sink.documents.size).toBe(4);
  });

  it("stops retrying automatically after repeated failures and says so", async () => {
    const h = new Harness();
    await h.run("preview");
    h.fake.expireNextLinks = 1000;
    await h.run("sync");
    for (let i = 0; i < MAX_AUTOMATIC_RETRIES + 2; i += 1) {
      h.advanceDays(1);
      await h.run("continue");
    }
    const failing = [...h.store.items.values()].filter((i) => i.state === "ERROR");
    expect(failing.every((i) => i.retryCount === MAX_AUTOMATIC_RETRIES)).toBe(true);
    const last = h.store.runs.filter((r) => r.status !== "running").at(-1)!;
    expect(last.report?.attention.map((a) => a.code)).toContain("items_failing");
  });

  it("session expiring mid-download is recovered transparently", async () => {
    const h = new Harness();
    await h.run("preview");
    h.fake.expireSessionAfter = 12;
    const r = report(await h.run("sync"));
    expect(r.totals.errors).toBe(0);
    expect(h.sink.searchable()).toHaveLength(4);
  });

  it("work beyond the time budget is deferred and finished by the next continue run", async () => {
    const h = new Harness();
    await h.run("preview");
    /* A clock that jumps past the item budget as soon as applying starts. */
    let calls = 0;
    const store = h.store;
    const original = store.saveItems.bind(store);
    store.saveItems = async (items) => {
      calls += 1;
      if (calls === 2) h.advanceDays(0.01);
      return original(items);
    };
    const r = report(await h.run("sync"));
    expect(r.totals.deferred).toBeGreaterThan(0);
    store.saveItems = original;
    const done = await h.run("continue");
    expect(done.status).toBe("succeeded");
    expect(h.sink.searchable()).toHaveLength(4);
  });

  it("only one sync runs at a time", async () => {
    const h = new Harness();
    await h.store.claimRun({ source: "woven", mode: "sync", trigger: "manual", requestedBy: "someone" });
    expect(await h.run("preview")).toMatchObject({ status: "busy" });
  });
});

describe("nothing secret is kept", () => {
  it("no signed URL, cookie, token or password reaches the manifest, runs or audit log", async () => {
    const h = new Harness();
    await h.initial();
    Object.assign(h.fake.state.handbooks[0]!, { currentVersionId: uuid(2102), bytes: "%PDF v2" });
    await h.run("sync");
    const persisted = JSON.stringify({ items: [...h.store.items.values()], runs: h.store.runs, events: h.store.events });
    expect(persisted).not.toMatch(/sig=|SECRET|blob\.core|WovenSession|login-token|page-token|RequestVerificationToken/);
    expect(persisted).not.toContain(PASSWORD);
  });
});

describe("scheduling every 30 days", () => {
  it("the daily tick does a full sync only when 30 days have passed", async () => {
    const h = new Harness();
    await h.initial();
    await h.store.saveSettings({ ...h.store.settings, autoSyncEnabled: true });
    expect(nextAutomaticSyncAt(h.store.settings)).toBe("2026-10-29T12:00:00.000Z");

    h.advanceDays(10);
    expect(await runScheduledWovenKnowledgeTick(h.overrides())).toEqual({ status: "skipped", reason: "not_due" });

    h.advanceDays(20);
    h.fake.state.handbooks[0]!.currentVersionId = uuid(2105);
    const outcome = await runScheduledWovenKnowledgeTick(h.overrides());
    expect(outcome.status).toBe("succeeded");
    expect(h.store.runs.at(-1)).toMatchObject({ mode: "sync", trigger: "schedule", requestedBy: "schedule" });
    expect(nextAutomaticSyncAt(h.store.settings)).toBe("2026-11-28T12:00:00.000Z");
  });

  it("does nothing while automatic sync is off, and never before the initial sync", async () => {
    const h = new Harness();
    expect(await runScheduledWovenKnowledgeTick(h.overrides())).toEqual({ status: "skipped", reason: "initial_sync_not_done" });
    await h.initial();
    h.advanceDays(40);
    expect(await runScheduledWovenKnowledgeTick(h.overrides())).toEqual({ status: "skipped", reason: "auto_sync_off" });
  });

  it("between monthly syncs it only continues or retries unfinished work", () => {
    const settings = { source: "woven" as const, autoSyncEnabled: true, intervalDays: 30, initialSyncCompletedAt: "2026-09-01T00:00:00Z", lastFullScanAt: "2026-09-01T00:00:00Z", lastSuccessAt: null };
    const pending = { pendingAction: "ingest", retryCount: 1, nextRetryAt: "2026-09-02T00:00:00Z" } as ManifestItem;
    expect(decideScheduledWork(settings, [pending], new Date("2026-09-03T00:00:00Z"))).toEqual({ run: "continue" });
    expect(decideScheduledWork(settings, [], new Date("2026-09-03T00:00:00Z"))).toEqual({ run: "none", reason: "not_due" });
    expect(decideScheduledWork(settings, [], new Date("2026-10-01T00:00:00Z"))).toEqual({ run: "sync" });
  });

  it("manual Sync Now runs the same engine as the schedule", async () => {
    const h = new Harness();
    await h.initial();
    const manual = await h.run("sync");
    await h.store.saveSettings({ ...h.store.settings, autoSyncEnabled: true, lastFullScanAt: "2026-01-01T00:00:00Z" });
    const scheduled = await runScheduledWovenKnowledgeTick(h.overrides());
    expect(Object.keys(report(manual)).sort()).toEqual(Object.keys(report(scheduled)).sort());
    expect(report(manual).totals).toEqual(report(scheduled).totals);
  });
});

describe("test connection", () => {
  it("signs in, confirms the company, reads one list, writes nothing", async () => {
    const fake = new FakeWoven();
    const client = new WovenTeamClient({ baseUrl: CONFIG.baseUrl, fetch: fake.fetch, sleep: noSleep, transport: { minIntervalMs: 0 } });
    expect(await testWovenConnection({ config: CONFIG, client })).toEqual({ status: "ok", company: COMPANY, handbooksVisible: 2 });
    expect(fake.log.every((r) => r.method === "GET" || r.path === "/Login/Authenticate" || r.path.includes("_List_"))).toBe(true);
  });

  it("names the company-selection gap when Woven asks for it", async () => {
    const fake = new FakeWoven();
    fake.state.requireCompanySelection = true;
    const client = new WovenTeamClient({ baseUrl: CONFIG.baseUrl, fetch: fake.fetch, sleep: noSleep, transport: { minIntervalMs: 0 } });
    expect(await testWovenConnection({ config: CONFIG, client })).toMatchObject({ status: "failed", code: "woven_company_selection_unverified" });
  });
});

/** A Supabase store in a database where the migration has not been applied. */
const missingTables = (): KnowledgeSyncStore =>
  new Proxy({} as KnowledgeSyncStore, {
    get: () => async () => {
      throw new KnowledgeSyncStoreError("sync_tables_missing", "The knowledge sync tables do not exist in this database yet.");
    },
  });

describe("preview test mode (Preview deployments without the sync tables)", () => {
  function overridesWithoutTables(h: Harness, allowed: boolean) {
    const { store: _unused, ...rest } = h.overrides();
    void _unused;
    return { ...rest, config: { ...CONFIG, previewTestModeAllowed: allowed }, supabaseStore: missingTables };
  }

  it("runs a real dry run against Woven, returns the report, and persists nothing", async () => {
    const h = new Harness();
    const outcome = await runWovenKnowledgeSync({ mode: "preview", trigger: "manual", requestedBy: "admin:test" }, overridesWithoutTables(h, true));
    expect(outcome).toMatchObject({ status: "succeeded", previewTestMode: true });
    const r = report(outcome);
    expect(r.company).toEqual({ companyLabel: COMPANY, companyVerified: true });
    expect(r.totals).toMatchObject({ discovered: 13, new: 4 });
    /* Nothing reached the (real) store or Ask Sunny. */
    expect(h.store.runs).toHaveLength(0);
    expect(h.store.items.size).toBe(0);
    expect(h.sink.ingestCalls + h.sink.metadataCalls + h.sink.retireCalls).toBe(0);
  });

  it("is refused in Production: a missing table there is an error, not a fallback", async () => {
    const h = new Harness();
    await expect(
      runWovenKnowledgeSync({ mode: "preview", trigger: "manual", requestedBy: "admin:test" }, overridesWithoutTables(h, false)),
    ).rejects.toMatchObject({ code: "sync_tables_missing" });
    expect(h.fake.log).toHaveLength(0);
  });

  it("never applies to a real sync, even outside Production", async () => {
    const h = new Harness();
    await expect(
      runWovenKnowledgeSync({ mode: "sync", trigger: "manual", requestedBy: "admin:test" }, overridesWithoutTables(h, true)),
    ).rejects.toMatchObject({ code: "sync_tables_missing" });
    expect(h.fake.log).toHaveLength(0);
  });

  it("the test-mode sink refuses every write and still answers the read", async () => {
    const inner = new MemoryKnowledgeSink();
    const sink = readOnlySink(inner);
    await expect(sink.ingest({ documentId: "d", bytes: new Uint8Array([1]), fileName: "a.pdf", mimeType: "application/pdf", title: "t", description: "", category: "other", tags: [] })).rejects.toMatchObject({ category: "preview_test_mode" });
    await expect(sink.updateMetadata("d", { title: "t", description: "", category: "other", tags: [] })).rejects.toMatchObject({ category: "preview_test_mode" });
    await expect(sink.retire("d")).rejects.toMatchObject({ category: "preview_test_mode" });
    await expect(sink.countManualTitleMatches(["x"])).resolves.toBe(0);
    expect(inner.ingestCalls + inner.metadataCalls + inner.retireCalls).toBe(0);
  });

  it("a blocked sign-in in test mode is reported, not hidden", async () => {
    const h = new Harness();
    h.fake.state.requireCompanySelection = true;
    const outcome = await runWovenKnowledgeSync({ mode: "preview", trigger: "manual", requestedBy: "admin:test" }, overridesWithoutTables(h, true));
    expect(outcome).toMatchObject({ status: "failed", errorCode: "woven_company_selection_unverified", previewTestMode: true });
  });
});

describe("the Production gate", () => {
  it("allows test mode on Vercel Preview and in development only", () => {
    expect(previewTestModeAllowed({ VERCEL_ENV: "production", NODE_ENV: "production" })).toBe(false);
    expect(previewTestModeAllowed({ VERCEL_ENV: "preview", NODE_ENV: "production" })).toBe(true);
    expect(previewTestModeAllowed({ VERCEL_ENV: "development" })).toBe(true);
    expect(previewTestModeAllowed({ NODE_ENV: "production" })).toBe(false);
    expect(previewTestModeAllowed({ NODE_ENV: "development" })).toBe(true);
  });

  it("the status reports test mode only where it is allowed and the tables are missing", async () => {
    const missing = missingTables();
    expect((await readWovenKnowledgeStatus({ config: { ...CONFIG, previewTestModeAllowed: true }, store: missing })).previewTestMode).toBe(true);
    expect((await readWovenKnowledgeStatus({ config: { ...CONFIG, previewTestModeAllowed: false }, store: missing })).previewTestMode).toBe(false);
    const h = new Harness();
    expect((await readWovenKnowledgeStatus({ config: { ...CONFIG, previewTestModeAllowed: true }, store: h.store })).previewTestMode).toBe(false);
  });
});
