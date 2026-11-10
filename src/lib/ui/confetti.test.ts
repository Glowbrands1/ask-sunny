// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { burstConfetti } from "./confetti";

afterEach(() => {
  vi.restoreAllMocks();
  // jsdom has no matchMedia of its own; remove the one a test installed.
  delete (window as { matchMedia?: unknown }).matchMedia;
});

describe("burstConfetti", () => {
  it("does nothing under reduced motion", () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
    window.matchMedia = vi.fn(() => ({ matches: true }) as MediaQueryList);
    burstConfetti();
    expect(document.querySelector("canvas[data-confetti]")).toBeNull();
    // It stopped before even asking for a canvas.
    expect(getContext).not.toHaveBeenCalled();
  });

  it("does nothing, and does not throw, without a 2D canvas", () => {
    // jsdom has no canvas implementation: getContext returns null.
    expect(() => burstConfetti()).not.toThrow();
    expect(document.querySelector("canvas[data-confetti]")).toBeNull();
  });
});
