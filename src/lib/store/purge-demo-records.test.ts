import { describe, expect, it, vi } from "vitest";

import {
  DEMO_CONVERSATIONS,
  DEMO_FORM_TEMPLATES,
  DEMO_GENERATED_FORMS,
} from "@/data/demo";
import { createId } from "@/lib/utils/id";

import {
  demoRecordIds,
  isDemoRecordId,
  purgeDemoRecords,
  withoutDemoRecords,
  type PurgeableStore,
} from "./purge-demo-records";

/**
 * ============================================================================
 * TAKING SEEDED RECORDS OUT OF A REAL BROWSER WITHOUT TAKING ANYTHING ELSE
 * ============================================================================
 *
 * This is the only destructive operation in the app that runs unasked, on a
 * store that holds work nobody can get back. Two claims have to hold, and the
 * second matters more than the first:
 *
 *   1. THE SEEDED RECORDS GO. Turning the seeds off does nothing for a browser
 *      that already has them, and the hydrate path would read them straight
 *      back.
 *   2. NOTHING ELSE GOES. Not a real conversation about Daily Stats, not a
 *      real coaching record for somebody who shares a name with a seeded one,
 *      not a record with a similar id.
 */

/** An in-memory store with the two methods the purge is allowed to use. */
function fakeStore(initial: Record<string, { id: string }[]>) {
  const data: Record<string, { id: string }[]> = structuredClone(initial);
  const store: PurgeableStore & { data: typeof data } = {
    data,
    async list<T>(collection: string) {
      return (data[collection] ?? []) as T[];
    },
    async replace<T extends { id: string }>(collection: string, records: T[]) {
      data[collection] = records;
    },
  } as PurgeableStore & { data: typeof data };
  return store;
}

/** A conversation a real person actually had, named the way the app names it. */
function realConversation(title: string) {
  return { id: createId("conv"), title };
}

describe("the seeded records are removed", () => {
  it("removes every seeded conversation from a store that holds them", async () => {
    const store = fakeStore({
      chat_conversations: DEMO_CONVERSATIONS.map((entry) => ({ id: entry.id })),
    });

    const report = await purgeDemoRecords(store);

    expect(store.data.chat_conversations).toEqual([]);
    expect(report.changed).toBe(true);
    expect(report.removed.chat_conversations).toEqual(
      DEMO_CONVERSATIONS.map((entry) => entry.id),
    );
  });

  it("removes seeded generated forms and form templates too", async () => {
    const store = fakeStore({
      generated_forms: DEMO_GENERATED_FORMS.map((entry) => ({ id: entry.id })),
      form_templates: DEMO_FORM_TEMPLATES.map((entry) => ({ id: entry.id })),
    });

    await purgeDemoRecords(store);

    expect(store.data.generated_forms).toEqual([]);
    expect(store.data.form_templates).toEqual([]);
  });

  /**
   * THE ONE THAT NAMES THE ACTUAL DEFECT. `conv-seed-1` is the seeded thread
   * whose first message is the retired "What should I focus on in today's
   * Daily Stats?" chip, answered with invented figures — 486 guests, 24.6%
   * conversion. It was written into real browsers and read back as history.
   */
  it("removes the seeded Daily Stats conversation by id", async () => {
    const seeded = DEMO_CONVERSATIONS.find((entry) => entry.id === "conv-seed-1");
    expect(seeded, "the seeded conversation this was written for").toBeDefined();

    const store = fakeStore({ chat_conversations: [{ id: "conv-seed-1" }] });
    await purgeDemoRecords(store);

    expect(store.data.chat_conversations).toEqual([]);
  });
});

/* ===================================================== what must survive == */

describe("real records are never touched", () => {
  it("keeps genuine conversations alongside the seeded ones it removes", async () => {
    const mine = realConversation("Attendance write-up for a late shift");
    const alsoMine = realConversation("Daily Stats — what to coach");

    const store = fakeStore({
      chat_conversations: [
        { id: DEMO_CONVERSATIONS[0].id },
        mine,
        { id: DEMO_CONVERSATIONS[1].id },
        alsoMine,
      ],
    });

    await purgeDemoRecords(store);

    expect(store.data.chat_conversations).toEqual([mine, alsoMine]);
  });

  /**
   * COLLISION IS STRUCTURALLY IMPOSSIBLE, and this asserts the property rather
   * than a sample of it. Seeded ids are hand-written and hyphenated;
   * `createId` joins with an UNDERSCORE and appends a timestamp and a random
   * suffix. No value the app generates can equal a value the demo ships.
   */
  it("cannot generate a real id that collides with a seeded one", () => {
    const seeded = new Set(
      demoRecordIds().flatMap((target) => [...target.ids]),
    );
    expect(seeded.size).toBeGreaterThan(0);

    for (const prefix of ["conv", "form", "tpl", "doc", "video"]) {
      for (let i = 0; i < 200; i += 1) {
        expect(seeded.has(createId(prefix))).toBe(false);
      }
    }
  });

  it("matches on the id only — never a title, a name or a timestamp", async () => {
    /*
     * A real conversation whose TITLE is byte-identical to a seeded one, and a
     * real form for an employee who shares a seeded record's name. Any rule
     * that reached for text would take both.
     */
    const impostor = { id: createId("conv"), title: "Daily Stats — conversion focus" };
    const namesake = { id: createId("form"), employeeName: "Jane Kowalski" };

    const store = fakeStore({
      chat_conversations: [impostor],
      generated_forms: [namesake],
    });

    const report = await purgeDemoRecords(store);

    expect(report.changed).toBe(false);
    expect(store.data.chat_conversations).toEqual([impostor]);
    expect(store.data.generated_forms).toEqual([namesake]);
  });

  it("leaves a store with nothing seeded in it completely alone", async () => {
    const mine = [realConversation("one"), realConversation("two")];
    const store = fakeStore({ chat_conversations: mine });
    const replace = vi.spyOn(store, "replace");

    const report = await purgeDemoRecords(store);

    expect(report.changed).toBe(false);
    // Not merely unchanged — not written at all, on every subsequent load.
    expect(replace).not.toHaveBeenCalled();
    expect(store.data.chat_conversations).toEqual(mine);
  });
});

/* ============================================================ robustness == */

describe("it is safe to run on every load", () => {
  it("is idempotent", async () => {
    const mine = realConversation("kept");
    const store = fakeStore({
      chat_conversations: [{ id: DEMO_CONVERSATIONS[0].id }, mine],
    });

    await purgeDemoRecords(store);
    const second = await purgeDemoRecords(store);

    expect(second.changed).toBe(false);
    expect(store.data.chat_conversations).toEqual([mine]);
  });

  it("never throws when a collection cannot be read or written", async () => {
    const store: PurgeableStore = {
      async list() {
        throw new Error("IndexedDB is blocked in this context");
      },
      async replace() {
        throw new Error("quota exceeded");
      },
    };

    await expect(purgeDemoRecords(store)).resolves.toEqual({
      removed: {},
      changed: false,
    });
  });

  it("carries on with the other collections when one fails", async () => {
    const store = fakeStore({
      chat_conversations: [{ id: DEMO_CONVERSATIONS[0].id }],
      generated_forms: [{ id: DEMO_GENERATED_FORMS[0].id }],
    });
    const realList = store.list.bind(store);
    store.list = (async <T,>(collection: Parameters<PurgeableStore["list"]>[0]) => {
      if (collection === "chat_conversations") throw new Error("blocked");
      return realList<T>(collection);
    }) as PurgeableStore["list"];

    const report = await purgeDemoRecords(store);

    expect(report.removed.chat_conversations).toBeUndefined();
    expect(report.removed.generated_forms).toEqual([DEMO_GENERATED_FORMS[0].id]);
  });
});

/* ============================================ the in-memory counterpart == */

describe("withoutDemoRecords keeps state and store in step", () => {
  it("drops exactly what the purge would drop", () => {
    const mine = realConversation("kept");
    const filtered = withoutDemoRecords([
      { id: DEMO_CONVERSATIONS[0].id },
      mine,
      { id: DEMO_GENERATED_FORMS[0].id },
    ]);

    expect(filtered).toEqual([mine]);
  });

  it("recognises a seeded id from any collection", () => {
    expect(isDemoRecordId(DEMO_CONVERSATIONS[0].id)).toBe(true);
    expect(isDemoRecordId(DEMO_GENERATED_FORMS[0].id)).toBe(true);
    expect(isDemoRecordId(DEMO_FORM_TEMPLATES[0].id)).toBe(true);
    expect(isDemoRecordId(createId("conv"))).toBe(false);
  });
});
