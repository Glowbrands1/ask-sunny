import { readFileSync } from "node:fs";

import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

/**
 * The Continue page is what a scanner lands on after following the
 * `/auth/invite-start` redirect. Rendering it must never spend the token —
 * it only reports whether one is held.
 */

const TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef01234567";

async function renderPage(held: string | undefined, retry?: string, enabled = true) {
  vi.resetModules();
  process.env.INVITE_LINK_HOLD_ENABLED = enabled ? "true" : "";
  vi.doMock("next/headers", () => ({
    cookies: async () => ({
      get: (name: string) =>
        name === "sunny_invite_token" && held ? { name, value: held } : undefined,
    }),
  }));
  const { default: Page } = await import("./page");
  const tree = (await Page({
    searchParams: Promise.resolve(retry ? { retry } : {}),
  })) as ReactElement<{ children: ReactElement<{ hasLink: boolean; retry: boolean }> }>;
  return tree.props.children.props;
}

describe("/auth/invite-continue", () => {
  it("shows Continue when a token is held", async () => {
    expect(await renderPage(TOKEN)).toEqual({ hasLink: true, retry: false });
  });

  it("shows the no-link message when none is held, and ignores ?retry then", async () => {
    expect(await renderPage(undefined, "1")).toEqual({ hasLink: false, retry: false });
  });

  it("passes the retry notice through only alongside a held token", async () => {
    expect(await renderPage(TOKEN, "1")).toEqual({ hasLink: true, retry: true });
  });

  it("off (INVITE_LINK_HOLD_ENABLED): never reports a held link", async () => {
    expect(await renderPage(TOKEN, "1", false)).toEqual({ hasLink: false, retry: false });
  });

  it("imports no Supabase client and calls no auth method", () => {
    const source = readFileSync("src/app/auth/invite-continue/page.tsx", "utf8");
    expect(source).not.toMatch(
      /supabase\/(auth-clients|browser-client|server)|verifyOtp|exchangeCodeForSession|setSession|updateUser|verifyInviteToken/,
    );
  });
});
