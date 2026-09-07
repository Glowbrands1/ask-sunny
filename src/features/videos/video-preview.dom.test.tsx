// @vitest-environment jsdom
import * as React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VideoPreview } from "./video-preview";

/**
 * ============================================================================
 * A REAL FRAME, FROM A PRIVATE BUCKET, WITHOUT COSTING THE GRID
 * ============================================================================
 *
 * The card showed a geometric placeholder, which told a manager nothing about
 * which video they were looking at. This shows an actual frame — and the
 * constraints are the interesting part: no public bucket, no proxy, no
 * autoplay, and no megabytes fetched to draw a grid.
 */

let requested: string[] = [];
const SIGNED =
  "https://project.supabase.co/storage/v1/object/sign/training-videos/x/source.mp4?token=t";

beforeEach(() => {
  requested = [];
  // jsdom has no IntersectionObserver, so the component degrades to eager —
  // which is what makes the fetch observable here at all.
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stub(reply: { ok?: boolean; payload?: unknown } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      requested.push(url);
      return {
        ok: reply.ok ?? true,
        status: reply.ok === false ? 403 : 200,
        json: async () =>
          reply.payload ?? { url: SIGNED, expiresInSeconds: 7200, mimeType: "video/mp4" },
      } as Response;
    }),
  );
}

const FALLBACK = <div data-testid="placeholder">placeholder</div>;

describe("the preview obtains its URL through the authorized route", () => {
  it("asks the playback endpoint, not storage directly", async () => {
    stub();
    render(<VideoPreview videoId="vid-1" fallback={FALLBACK} />);

    await waitFor(() => expect(requested).toHaveLength(1));
    expect(requested[0]).toBe("/api/videos/vid-1/playback");
  });

  it("renders a video element once the signed URL arrives", async () => {
    stub();
    const { container } = render(<VideoPreview videoId="vid-1" fallback={FALLBACK} />);

    await waitFor(() => expect(container.querySelector("video")).not.toBeNull());
    expect(container.querySelector("source")?.getAttribute("src")).toContain(
      "/storage/v1/object/sign/",
    );
  });

  it("introduces no public bucket URL", async () => {
    stub();
    const { container } = render(<VideoPreview videoId="vid-1" fallback={FALLBACK} />);

    await waitFor(() => expect(container.querySelector("source")).not.toBeNull());
    const src = container.querySelector("source")!.getAttribute("src")!;

    // A public object URL has no `/sign/` segment and no token.
    expect(src).not.toContain("/object/public/");
    expect(src).toContain("token=");
  });

  it("does not proxy bytes through this app", async () => {
    stub();
    const { container } = render(<VideoPreview videoId="vid-1" fallback={FALLBACK} />);

    await waitFor(() => expect(container.querySelector("source")).not.toBeNull());
    // The JSON call goes to /api/; the media does not.
    expect(container.querySelector("source")!.getAttribute("src")).not.toContain("/api/");
  });
});

describe("the preview is a still, not a clip", () => {
  it("is muted, not autoplaying and not looping", async () => {
    stub();
    const { container } = render(<VideoPreview videoId="vid-1" fallback={FALLBACK} />);

    await waitFor(() => expect(container.querySelector("video")).not.toBeNull());
    const video = container.querySelector("video")!;

    expect(video.hasAttribute("muted") || video.muted).toBe(true);
    expect(video.hasAttribute("autoplay")).toBe(false);
    expect(video.hasAttribute("loop")).toBe(false);
    expect(video.hasAttribute("controls")).toBe(false);
  });

  it("bounds what it downloads", async () => {
    stub();
    const { container } = render(<VideoPreview videoId="vid-1" fallback={FALLBACK} />);

    await waitFor(() => expect(container.querySelector("video")).not.toBeNull());
    // `auto` would stream whole videos into a grid nobody pressed play on.
    expect(container.querySelector("video")!.getAttribute("preload")).toBe("metadata");
  });

  it("asks for a frame a second in rather than the first", async () => {
    stub();
    const { container } = render(<VideoPreview videoId="vid-1" fallback={FALLBACK} />);

    await waitFor(() => expect(container.querySelector("source")).not.toBeNull());
    // A real recording's first frame is very often black.
    expect(container.querySelector("source")!.getAttribute("src")).toContain("#t=1");
  });

  it("is hidden from assistive tech and out of the tab order", async () => {
    stub();
    const { container } = render(<VideoPreview videoId="vid-1" fallback={FALLBACK} />);

    await waitFor(() => expect(container.querySelector("video")).not.toBeNull());
    const video = container.querySelector("video")!;

    // The card's own button is what opens the video; this is decoration.
    expect(video.getAttribute("aria-hidden")).toBe("true");
    expect(video.getAttribute("tabindex")).toBe("-1");
  });
});

describe("failure keeps the placeholder", () => {
  it("falls back when the playback route refuses", async () => {
    stub({ ok: false, payload: { error: "That video does not have a playable file." } });
    render(<VideoPreview videoId="vid-1" fallback={FALLBACK} />);

    await waitFor(() => expect(requested).toHaveLength(1));
    expect(screen.getByTestId("placeholder")).toBeTruthy();
  });

  it("falls back when the response carries no URL", async () => {
    stub({ payload: {} });
    render(<VideoPreview videoId="vid-1" fallback={FALLBACK} />);

    await waitFor(() => expect(requested).toHaveLength(1));
    expect(screen.getByTestId("placeholder")).toBeTruthy();
  });

  it("falls back on a network failure, silently", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connect ECONNREFUSED 10.0.0.5:443");
      }),
    );
    const { container } = render(<VideoPreview videoId="vid-1" fallback={FALLBACK} />);

    await waitFor(() => expect(screen.getByTestId("placeholder")).toBeTruthy());
    // A card that cannot preview is a card, not an error.
    expect(container.textContent).not.toContain("ECONNREFUSED");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("shows the placeholder before the URL arrives", () => {
    stub();
    render(<VideoPreview videoId="vid-1" fallback={FALLBACK} />);
    // Synchronously, before the fetch resolves.
    expect(screen.getByTestId("placeholder")).toBeTruthy();
  });
});

describe("the signed URL is borrowed, not kept", () => {
  it("is not written to browser storage", async () => {
    stub();
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { getItem: () => null, setItem, removeItem: () => {} });

    render(<VideoPreview videoId="vid-1" fallback={FALLBACK} />);
    await waitFor(() => expect(requested).toHaveLength(1));

    expect(setItem).not.toHaveBeenCalled();
  });

  it("does no caching of its own in source", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const code = require("node:fs")
      .readFileSync("src/features/videos/video-preview.tsx", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    expect(code).not.toContain("localStorage");
    expect(code).not.toContain("sessionStorage");
    expect(code).not.toContain("indexedDB");
  });
});
