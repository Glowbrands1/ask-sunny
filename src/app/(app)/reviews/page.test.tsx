import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { REVIEWS_UPDATE_NOTE } from "@/lib/reviews/update-note";

/**
 * Pau, 26 Oct 2026: "API update in progress, syncing 2K reviews in batches"
 * as one fixed note on the Google Reviews page, behind
 * GOOGLE_REVIEWS_UPDATE_NOTE_ENABLED. Off, the page renders exactly as
 * before: the markup with the flag off is the markup with the flag on minus
 * the note.
 */

vi.mock("@/lib/auth/page", () => ({ requirePagePermission: async () => undefined }));
vi.mock("@/components/permission-gate", () => ({
  PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/features/reviews/load", () => ({
  loadReviewsPage: async () => ({ mode: "unconfigured", missing: ["SUPABASE_URL"] }),
}));
vi.mock("@/features/reviews/reviews-screen", () => ({ ReviewsScreen: () => <div data-screen="live" /> }));
vi.mock("@/lib/demo/runtime", () => ({ demoRuntime: { screens: { reviews: () => <div data-screen="demo" /> } } }));
vi.mock("@/lib/config/runtime", () => ({ isDemoMode: () => false }));

async function render(): Promise<string> {
  const { default: ReviewsPage } = await import("./page");
  return renderToStaticMarkup(await ReviewsPage({ searchParams: Promise.resolve({}) }));
}

afterEach(() => {
  delete process.env.GOOGLE_REVIEWS_UPDATE_NOTE_ENABLED;
});

describe("the Google Reviews page's update note", () => {
  it("off (the default): no note", async () => {
    const off = await render();
    expect(off).not.toContain("API update in progress");
    expect(off).toContain('data-screen="demo"');
  });

  it("on: the note at the top, and nothing else changes", async () => {
    const off = await render();
    process.env.GOOGLE_REVIEWS_UPDATE_NOTE_ENABLED = "true";
    const on = await render();
    expect(on).toContain(REVIEWS_UPDATE_NOTE.replace("isn't", "isn&#x27;t"));
    const note = on.slice(0, on.length - off.length);
    expect(on.endsWith(off)).toBe(true);
    expect(note).toContain("API update in progress");
  });
});
