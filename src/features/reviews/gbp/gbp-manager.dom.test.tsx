// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { buildOverview } from "@/lib/reviews/gbp/overview";

import { GbpManager } from "./gbp-manager";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(cleanup);

const apify = { enabled: true, scheduleEnabled: true, lastRunAt: null, lastRunStatus: null, lastSuccessAt: null };
const env = (extra: Record<string, string> = {}) => ({ GBP_SYNC_MODE: "dry_run", GOOGLE_GBP_CLIENT_ID: "id", GOOGLE_GBP_CLIENT_SECRET: "SECRET-VALUE", GOOGLE_GBP_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"), NEXT_PUBLIC_SITE_URL: "https://ask-sunny.example", ...extra }) as unknown as NodeJS.ProcessEnv;

describe("GbpManager", () => {
  it("offers a Connect Google link (no typing) and keeps live actions disabled", () => {
    const overview = buildOverview({ listings: [], runs: [], connection: null }, apify, { env: env() });
    const { container } = render(<GbpManager initial={overview} />);
    const link = screen.getByRole("link", { name: "Connect Google" });
    expect(link.getAttribute("href")).toBe("/api/admin/reviews/gbp/connect");
    expect((screen.getByRole("button", { name: /Sync Google Reviews now/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Run live backfill/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(container.innerHTML).not.toContain("SECRET-VALUE");
  });

  it("states which provider is active and which is dry-run", () => {
    const overview = buildOverview({ listings: [], runs: [], connection: null }, apify, { env: env() });
    render(<GbpManager initial={overview} />);
    expect(screen.getByText(/dry-run only/)).toBeTruthy();
    expect(screen.getByText("Apify:")).toBeTruthy();
  });
});
