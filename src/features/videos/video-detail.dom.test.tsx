// @vitest-environment jsdom
import * as React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VideoPlayer } from "./video-player";
import { VideoTranscript } from "./video-transcript";
import type { TrainingVideo } from "@/lib/videos/types";

/**
 * ============================================================================
 * WHAT A VIEWER SEES, AND WHAT THEY ARE NEVER SHOWN
 * ============================================================================
 *
 * Two rules with consequences beyond the pixels:
 *
 *   A PLAYER APPEARS ONLY WHEN A CLOUD FILE EXISTS. The prototype stored video
 *   bytes in the uploader's own IndexedDB, which no other browser and no other
 *   device can read. A player over one of those records would spin and fail
 *   with nothing to explain why.
 *
 *   TRANSCRIPT TEXT APPEARS ONLY WHEN IT IS READY AND EXISTS. Words under a
 *   "Transcript" heading are words somebody will act on.
 */

function video(overrides: Partial<TrainingVideo> = {}): TrainingVideo {
  return {
    id: "8f14e45f-ceea-4e78-b2a7-1c1b1a2b3c4d",
    title: "Bed sanitising",
    description: "",
    category: "equipment",
    durationSeconds: 300,
    uploadedByName: "Manager",
    uploadedAt: "2026-09-06T00:00:00Z",
    equipment: [],
    keywords: [],
    tags: [],
    status: "ready",
    hasCloudAsset: true,
    mimeType: "video/mp4",
    sizeBytes: 1024,
    transcriptStatus: "not_configured",
    transcriptText: null,
    transcriptErrorSafe: null,
    transcriptProvider: null,
    viewCount: 0,
    thumbnailTone: "sage",
    ...overrides,
  };
}

let requested: string[] = [];

beforeEach(() => {
  requested = [];
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubPlayback(
  reply: { ok?: boolean; payload?: unknown } = {},
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      requested.push(url);
      return {
        ok: reply.ok ?? true,
        status: reply.ok === false ? 404 : 200,
        json: async () =>
          reply.payload ?? {
            url: "https://project.supabase.co/storage/v1/object/sign/training-videos/x?token=t",
            expiresInSeconds: 7200,
            mimeType: "video/mp4",
          },
      } as Response;
    }),
  );
}

/* -------------------------------------------------------------- playback -- */

describe("a ready cloud video plays", () => {
  it("renders a real video element with controls", async () => {
    stubPlayback();
    const { container } = render(<VideoPlayer videoId="vid-1" title="Bed sanitising" />);

    await waitFor(() => expect(container.querySelector("video")).not.toBeNull());
    const player = container.querySelector("video")!;

    expect(player.hasAttribute("controls")).toBe(true);
    expect(player.getAttribute("preload")).toBe("metadata");
  });

  it("plays from the signed URL the server returned", async () => {
    stubPlayback();
    const { container } = render(<VideoPlayer videoId="vid-1" title="Bed sanitising" />);

    await waitFor(() => expect(container.querySelector("source")).not.toBeNull());
    const source = container.querySelector("source")!;

    expect(source.getAttribute("src")).toContain("/storage/v1/object/sign/");
    expect(source.getAttribute("type")).toBe("video/mp4");
  });

  it("asks the server for the link rather than holding one", async () => {
    stubPlayback();
    render(<VideoPlayer videoId="vid-1" title="Bed sanitising" />);

    await waitFor(() => expect(requested).toHaveLength(1));
    expect(requested[0]).toBe("/api/videos/vid-1/playback");
  });

  it("streams straight from storage rather than through this app", async () => {
    stubPlayback();
    const { container } = render(<VideoPlayer videoId="vid-1" title="Bed sanitising" />);

    await waitFor(() => expect(container.querySelector("source")).not.toBeNull());
    // A proxied source would point back at /api/. Range requests and seeking
    // depend on this reaching Supabase directly.
    expect(container.querySelector("source")!.getAttribute("src")).not.toContain("/api/");
  });

  it("shows the server's message when no link can be made", async () => {
    stubPlayback({
      ok: false,
      payload: { error: "That video does not have a playable file." },
    });
    render(<VideoPlayer videoId="vid-1" title="Bed sanitising" />);

    await waitFor(() =>
      expect(screen.getByText(/does not have a playable file/)).toBeTruthy(),
    );
  });

  it("does not expose anything internal on a network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connect ECONNREFUSED 10.0.0.5:443");
      }),
    );
    const { container } = render(<VideoPlayer videoId="vid-1" title="Bed sanitising" />);

    await waitFor(() => expect(screen.getByText(/could not be fetched/)).toBeTruthy());
    expect(container.textContent).not.toContain("ECONNREFUSED");
  });
});

/* ------------------------------------------------------------ transcript -- */

describe("the transcript section says only what is true", () => {
  it("shows the text when the status is ready and text exists", () => {
    render(
      <VideoTranscript
        video={video({
          transcriptStatus: "ready",
          transcriptText: "First paragraph.\n\nSecond paragraph.",
        })}
        canManage={false}
      />,
    );

    expect(screen.getByText("First paragraph.")).toBeTruthy();
    expect(screen.getByText("Second paragraph.")).toBeTruthy();
  });

  it("shows nothing when the status is ready but text is missing", () => {
    render(
      <VideoTranscript
        video={video({ transcriptStatus: "ready", transcriptText: null })}
        canManage={false}
      />,
    );

    expect(screen.getByText(/carries no text, so nothing is shown/)).toBeTruthy();
  });

  it("never shows text carried by a failed run", () => {
    render(
      <VideoTranscript
        video={video({
          transcriptStatus: "failed",
          transcriptText: "half a transcript nobody verified",
          transcriptErrorSafe: "Transcript could not be generated.",
        })}
        canManage={false}
      />,
    );

    expect(screen.queryByText(/half a transcript/)).toBeNull();
    expect(screen.getByText("Transcript could not be generated.")).toBeTruthy();
  });

  it("says a transcript is being generated while it is", () => {
    for (const status of ["queued", "processing"] as const) {
      cleanup();
      render(<VideoTranscript video={video({ transcriptStatus: status })} canManage={false} />);
      expect(screen.getByText("Transcript is being generated.")).toBeTruthy();
    }
  });

  it("tells an administrator what is missing when no provider is configured", () => {
    render(
      <VideoTranscript video={video({ transcriptStatus: "not_configured" })} canManage />,
    );

    expect(screen.getByText(/No speech-to-text provider is configured/)).toBeTruthy();
    expect(screen.getByText(/Playback is unaffected/)).toBeTruthy();
    expect(screen.getByText(/every provider charges per minute/)).toBeTruthy();
  });

  it("tells a viewer the same fact without the configuration detail", () => {
    render(
      <VideoTranscript
        video={video({ transcriptStatus: "not_configured" })}
        canManage={false}
      />,
    );

    expect(screen.getByText(/Transcripts are not available yet/)).toBeTruthy();
    expect(screen.queryByText(/charges per minute/)).toBeNull();
  });

  it("exposes no provider detail in a failure message", () => {
    const { container } = render(
      <VideoTranscript
        video={video({
          transcriptStatus: "failed",
          transcriptErrorSafe: "The transcription service rejected this file.",
        })}
        canManage
      />,
    );

    expect(container.textContent).not.toMatch(/token=|Bearer|sk-|https:\/\//);
  });

  it("bounds a long transcript rather than letting it set the height", () => {
    const { container } = render(
      <VideoTranscript
        video={video({
          transcriptStatus: "ready",
          transcriptText: Array.from({ length: 200 }, (_, i) => `Paragraph ${i}.`).join("\n\n"),
        })}
        canManage={false}
      />,
    );

    const scroller = container.querySelector(".overflow-y-auto");
    expect(scroller).not.toBeNull();
    expect(scroller!.className).toMatch(/max-h-/);
  });
});
