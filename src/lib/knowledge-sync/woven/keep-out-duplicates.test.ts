import { afterEach, describe, expect, it, vi } from "vitest";

import { plainErrorReason } from "../error-reasons";
import { contentRows } from "../inventory";
import { keepOutKey } from "../inventory";
import { MemoryKnowledgeSink, MemoryKnowledgeSyncStore } from "../memory-store";
import { SinkError } from "../ports";
import type { ManifestItem } from "../types";
import type { WovenKnowledgeConfig } from "./config";
import { WovenKnowledgeConnector } from "./connector";
import { WovenTeamClient } from "./http";
import { runWovenKnowledgeSync } from "./sync";
import { COMPANY, FakeWoven, PASSWORD, USERNAME, noSleep } from "./test-support";

/**
 * QA, 10 Nov 2026 (Pau: "hide the duplicates"; the sync must never create duplicate live sources). The live library had
 * "14K Gold Rush" holding the Nothing But Bronze sheet, and three schematic titles that were one file; an administrator
 * could only keep out a whole audience.
 *
 *   WOVEN_DOCUMENT_KEEP_OUT_ENABLED       one document kept out, by the Content view's ref; undoable.
 *   WOVEN_DUPLICATE_CONTENT_HOLD_ENABLED  a file the pipeline refuses as "Same file as <title>" is listed by name under
 *                                         Needs attention and not retried (the pipeline check: pipeline-duplicate test).
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

  live(): ManifestItem[] {
    return [...this.store.items.values()].filter((item) => item.inAskSunny && item.knowledgeDocumentId);
  }

  keepOut(item: ManifestItem) {
    return this.store.saveDecision({ source: "woven", audienceKey: keepOutKey(item), decision: "excluded", decidedBy: "admin:test", decidedAt: this.clock.toISOString() });
  }

  advanceDays(days: number) {
    this.clock = new Date(this.clock.getTime() + days * 86_400_000);
  }
}

async function synced() {
  const h = new Harness();
  expect((await h.run("preview")).status).toMatch(/^succeeded/);
  expect((await h.run("sync")).status).toMatch(/^succeeded/);
  return h;
}

afterEach(() => vi.unstubAllEnvs());

describe("keep one document out of Ask Sunny", () => {
  it("off (production today): a stored choice is ignored; the document stays live", async () => {
    const h = await synced();
    const target = h.live()[0]!;
    await h.keepOut(target);
    h.advanceDays(1);
    await h.run("sync");
    expect(h.store.items.get(`woven\u0000${target.contentType}\u0000${target.entityId}\u0000${target.partKey}`)!.inAskSunny).toBe(true);
  });

  it("on: the next sync retires it; later syncs leave it out; undo brings it back", async () => {
    vi.stubEnv("WOVEN_DOCUMENT_KEEP_OUT_ENABLED", "true");
    const h = await synced();
    const target = h.live()[0]!;
    const key = `woven\u0000${target.contentType}\u0000${target.entityId}\u0000${target.partKey}`;
    const others = h.live().length - 1;
    await h.keepOut(target);

    h.advanceDays(1);
    await h.run("sync");
    expect(h.store.items.get(key)).toMatchObject({ state: "EXCLUDED", reason: "kept_out", inAskSunny: false, pendingAction: "none" });
    expect(h.sink.documents.get(target.knowledgeDocumentId!)!.retired).toBe(true);
    expect(h.live()).toHaveLength(others);

    const ingests = h.sink.ingestCalls;
    h.advanceDays(1);
    await h.run("sync");
    expect(h.store.items.get(key)).toMatchObject({ state: "EXCLUDED", reason: "kept_out", inAskSunny: false });
    expect(h.sink.ingestCalls).toBe(ingests);

    const rows = contentRows([...h.store.items.values()] as never, await h.store.loadDecisions("woven"));
    const part = rows.flatMap((row) => row.parts).find((p) => p.keptOut);
    expect(part).toMatchObject({ syncState: "kept_out", keptOut: true });

    await h.store.removeDecision("woven", keepOutKey(target));
    h.advanceDays(1);
    await h.run("sync");
    expect(h.store.items.get(key)).toMatchObject({ inAskSunny: true });
    expect(h.sink.documents.get(target.knowledgeDocumentId!)!.retired).toBe(false);
  });
});

describe("a file with the same content as another live document", () => {
  it("on: listed by name under Needs attention, and not retried", async () => {
    vi.stubEnv("WOVEN_DUPLICATE_CONTENT_HOLD_ENABLED", "true");
    const h = new Harness();
    await h.run("preview");
    h.sink.failNextIngest = new SinkError("ingest_duplicate_content", 'Same file as "Nothing But Bronze"; not indexed a second time.', false);
    const outcome = await h.run("sync");
    const report = (outcome as { report: { attention: { code: string; message: string }[] } }).report;
    const held = [...h.store.items.values()].find((item) => item.errorCategory === "ingest_duplicate_content")!;
    expect(held).toMatchObject({ state: "ERROR", nextRetryAt: null });
    const attention = report.attention.find((a) => a.code === "duplicate_content")!;
    expect(attention.message).toContain(`"${held.title}": Same file as "Nothing But Bronze"`);
    expect(attention.message).toContain("Resolve in Woven, or keep one out on the Content tab.");
    expect(plainErrorReason(held.errorCategory)).toBe("This file has the same text as another document already in Ask Sunny, so it was not added twice. Resolve it in Woven, or keep one of them out.");
  });
});
