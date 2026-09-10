import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  UploadRateLimited,
  uploadManyToKnowledgeBase,
  type BulkUploadEvent,
  type BulkUploadFile,
  type BulkUploadShared,
} from "./upload-service";
import type { KnowledgeDocument } from "@/types";

/**
 * ============================================================================
 * A BATCH IS A QUEUE, NOT A PILE
 * ============================================================================
 *
 * Three properties, and each of them is the difference between bulk upload
 * being usable and being a worse version of uploading one at a time:
 *
 *   1. ONE FILE PER REQUEST, IN ORDER. Each file runs
 *      extract -> chunk -> embed -> index server-side, so a parallel batch is N
 *      concurrent embedding jobs against a budget of ten a minute.
 *
 *   2. ONE FAILURE DOES NOT ABORT THE BATCH. A corrupt PDF in position two must
 *      not cost the reader files three through twenty — that is the whole
 *      reason somebody would go back to uploading singly.
 *
 *   3. A RATE LIMIT IS WAITED OUT AND THE SAME FILE RETRIED. The cap bounds
 *      real spend at the embeddings vendor and must not be raised to make bulk
 *      work; the client respects it instead.
 *
 * The fetch boundary is stubbed rather than the service, so `uploadToKnowledge-
 * Base`'s own response handling — the 429 branch, the `Retry-After` reading —
 * is exercised too.
 */

const SHARED: BulkUploadShared = {
  description: "",
  category: "policies_compliance",
  tags: ["attendance"],
  uploadedBy: "Paulyne Camacho",
};

function file(name: string): BulkUploadFile {
  return {
    key: `k-${name}`,
    file: new File(["x"], name, { type: "text/plain" }),
    title: name.replace(/\.[^.]+$/, ""),
  };
}

function document(title: string): KnowledgeDocument {
  return { id: `kb-${title}`, title } as KnowledgeDocument;
}

/** A JSON response, with the status and headers a route would really send. */
function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Never actually waits: a sixty-second window is not a sixty-second test. */
const waited: number[] = [];
const wait = async (seconds: number) => {
  waited.push(seconds);
};

describe("a batch uploads one file at a time, in order", () => {
  it("sends one request per file and reports each as it lands", async () => {
    const sent: string[] = [];
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const form = init.body as FormData;
      const title = String(form.get("title"));
      sent.push(title);
      return json({ document: document(title), chunkCount: 3 });
    });

    const events: BulkUploadEvent[] = [];
    await uploadManyToKnowledgeBase(
      [file("a.txt"), file("b.txt"), file("c.txt")],
      SHARED,
      (event) => events.push(event),
      wait,
    );

    // In order, and one request each — never a single batched request.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sent).toEqual(["a", "b", "c"]);

    expect(events.map((event) => `${event.kind}:${event.key}`)).toEqual([
      "started:k-a.txt",
      "done:k-a.txt",
      "started:k-b.txt",
      "done:k-b.txt",
      "started:k-c.txt",
      "done:k-c.txt",
    ]);
  });

  it("carries the batch's shared category and tags on every file", async () => {
    const categories: string[] = [];
    const tags: string[] = [];
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const form = init.body as FormData;
      categories.push(String(form.get("category")));
      tags.push(String(form.get("tags")));
      return json({ document: document("d"), chunkCount: 1 });
    });

    await uploadManyToKnowledgeBase(
      [file("a.txt"), file("b.txt")],
      SHARED,
      () => {},
      wait,
    );

    expect(categories).toEqual(["policies_compliance", "policies_compliance"]);
    expect(tags).toEqual(["attendance", "attendance"]);
  });

  it("gives each file its OWN title, because a title supersedes a document", async () => {
    /*
     * THE ONE THAT WOULD DESTROY DATA IF IT REGRESSED. Uploading a document
     * whose title already exists creates a new version and supersedes the old
     * one, so a batch that reused one title for every file would file eight
     * documents on top of each other.
     */
    const titles: string[] = [];
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const form = init.body as FormData;
      titles.push(String(form.get("title")));
      return json({ document: document("d"), chunkCount: 1 });
    });

    await uploadManyToKnowledgeBase(
      [file("attendance.txt"), file("dress-code.txt")],
      SHARED,
      () => {},
      wait,
    );

    expect(titles).toEqual(["attendance", "dress-code"]);
    expect(new Set(titles).size).toBe(2);
  });
});

describe("one failure does not abort the batch", () => {
  it("reports the failure and still uploads everything after it", async () => {
    let call = 0;
    fetchMock.mockImplementation(async () => {
      call += 1;
      if (call === 2) {
        return json({ error: "That PDF could not be read." }, { status: 400 });
      }
      return json({ document: document("ok"), chunkCount: 2 });
    });

    const events: BulkUploadEvent[] = [];
    await uploadManyToKnowledgeBase(
      [file("a.txt"), file("b.txt"), file("c.txt")],
      SHARED,
      (event) => events.push(event),
      wait,
    );

    // All three were attempted; the middle one failed and said why.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const failure = events.find((event) => event.kind === "failed");
    expect(failure).toMatchObject({
      kind: "failed",
      key: "k-b.txt",
      message: "That PDF could not be read.",
    });
    // And the file AFTER the failure still succeeded.
    expect(
      events.some((event) => event.kind === "done" && event.key === "k-c.txt"),
    ).toBe(true);
  });

  it("does not throw, so a caller's own loop cannot be broken by one file", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    await expect(
      uploadManyToKnowledgeBase([file("a.txt")], SHARED, () => {}, wait),
    ).resolves.toBeUndefined();
  });
});

describe("a rate limit is waited out, not treated as a failure", () => {
  beforeEach(() => {
    waited.length = 0;
  });

  it("waits the header's Retry-After and retries the SAME file", async () => {
    let call = 0;
    fetchMock.mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        return json(
          { error: "Too many requests. Try again in 37 seconds." },
          { status: 429, headers: { "Retry-After": "37" } },
        );
      }
      return json({ document: document("a"), chunkCount: 1 });
    });

    const events: BulkUploadEvent[] = [];
    await uploadManyToKnowledgeBase(
      [file("a.txt")],
      SHARED,
      (event) => events.push(event),
      wait,
    );

    expect(waited).toEqual([37]);
    // The reader is told it is WAITING, not that anything failed.
    expect(events.map((event) => event.kind)).toEqual([
      "started",
      "waiting",
      "done",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to the body's field when no header is present", async () => {
    let call = 0;
    fetchMock.mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        return json({ error: "Too many", retryAfterSeconds: 12 }, { status: 429 });
      }
      return json({ document: document("a"), chunkCount: 1 });
    });

    await uploadManyToKnowledgeBase([file("a.txt")], SHARED, () => {}, wait);
    expect(waited).toEqual([12]);
  });

  it("clamps an absurd Retry-After rather than stranding the batch", async () => {
    /*
     * The value decides how long the UI sits still, and it arrives from the
     * network. A proxy that rewrote it to a day must not park the dialog for a
     * day.
     */
    let call = 0;
    fetchMock.mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        return json({ error: "Too many" }, {
          status: 429,
          headers: { "Retry-After": "86400" },
        });
      }
      return json({ document: document("a"), chunkCount: 1 });
    });

    await uploadManyToKnowledgeBase([file("a.txt")], SHARED, () => {}, wait);
    expect(waited).toEqual([90]);
  });

  it("gives up on the file after ONE wait, rather than looping", async () => {
    /*
     * A second limit on the same file means something other than this batch is
     * consuming the budget. Retrying forever would hold the dialog open with no
     * end, so it is reported as a failure the reader can retry deliberately —
     * and the rest of the batch still runs.
     */
    fetchMock.mockImplementation(async () =>
      json({ error: "Too many requests." }, {
        status: 429,
        headers: { "Retry-After": "20" },
      }),
    );

    const events: BulkUploadEvent[] = [];
    await uploadManyToKnowledgeBase(
      [file("a.txt"), file("b.txt")],
      SHARED,
      (event) => events.push(event),
      wait,
    );

    expect(events.filter((event) => event.kind === "failed")).toHaveLength(2);
    // Two attempts per file: the first and the one after the wait.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("throws UploadRateLimited from the single-file path too", async () => {
    // So any other caller can tell "wait" from "no" as well.
    fetchMock.mockResolvedValue(
      json({ error: "Too many" }, { status: 429, headers: { "Retry-After": "9" } }),
    );
    const { uploadToKnowledgeBase } = await import("./upload-service");
    await expect(
      uploadToKnowledgeBase({
        file: new File(["x"], "a.txt"),
        title: "a",
        description: "",
        category: "policies_compliance",
        tags: [],
        uploadedBy: "PC",
      }),
    ).rejects.toBeInstanceOf(UploadRateLimited);
  });
});
