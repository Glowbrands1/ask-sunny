// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * ============================================================================
 * WHAT A REAL ACCOUNT WITH NOTHING IN IT ACTUALLY SEES
 * ============================================================================
 *
 * `production-demo-data.test.ts` proves the gates exist by reading the source.
 * This proves what the gates PRODUCE: a live deployment renders empty states
 * rather than seeded content, and the empty states are honest sentences rather
 * than blank panels.
 *
 * LIVE MODE IS SET BEFORE THE MODULES LOAD. `app-store.tsx` and `runtime.ts`
 * both read the flag once at module scope, so `vi.hoisted` is the only place
 * early enough — a `beforeAll` runs after the imports above have already
 * resolved and would test the wrong mode while appearing to pass.
 *
 * DELETED RATHER THAN SET TO "false", on purpose: an UNSET flag is the state
 * that used to mean demo, and it is the one a misconfigured deployment is
 * actually in. Testing "false" would test the case nobody gets wrong.
 */
vi.hoisted(() => {
  delete process.env.NEXT_PUBLIC_DEMO_MODE;
  delete process.env.NEXT_PUBLIC_VERCEL_ENV;
});

/** jsdom has no Next router; `SessionProvider` calls `useRouter` on mount. */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import { Providers } from "@/app/providers";
import { GlobalSearch } from "@/components/shell/global-search";
import { ConversationList } from "@/features/chat/conversation-list";
import { isDemoMode } from "@/lib/config/runtime";
import { useAppStore } from "@/lib/store/app-store";

beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

afterEach(cleanup);

/** Reads the store from inside the provider and reports what it holds. */
function StoreProbe() {
  const { conversations, forms, templates, documents, videos } = useAppStore();
  return (
    <ul>
      <li data-testid="conversations">{conversations.length}</li>
      <li data-testid="forms">{forms.length}</li>
      <li data-testid="templates">{templates.length}</li>
      <li data-testid="documents">{documents.length}</li>
      <li data-testid="videos">{videos.length}</li>
    </ul>
  );
}

describe("an unconfigured deployment is live, not demo", () => {
  it("resolves to live mode with the flag unset", () => {
    expect(isDemoMode()).toBe(false);
  });
});

describe("the store holds nothing seeded", () => {
  it.each(["conversations", "forms", "templates", "documents", "videos"])(
    "starts with no seeded %s",
    async (collection) => {
      render(
        <Providers>
          <StoreProbe />
        </Providers>,
      );

      /*
       * Asserted after hydration settles rather than on the first frame,
       * because the live knowledge read is async — and the flash it replaces
       * is exactly what this is here to catch. A seeded value would show up
       * either before or after.
       */
      await waitFor(() => {
        expect(screen.getByTestId(collection).textContent).toBe("0");
      });
    },
  );

  /**
   * THE FLASH, SPECIFICALLY. `documents` used to be seeded unconditionally and
   * replaced asynchronously by the live read, so the Knowledge Base and the
   * Ask band's "Reading N documents in your knowledge base" counted a library
   * nobody owned for as long as the request took.
   */
  it("never shows a seeded document count, not even on the first frame", () => {
    render(
      <Providers>
        <StoreProbe />
      </Providers>,
    );
    expect(screen.getByTestId("documents").textContent).toBe("0");
  });
});

describe("empty states are honest sentences", () => {
  it("tells a manager their chat history is empty", () => {
    render(
      <ConversationList
        conversations={[]}
        activeId={null}
        onSelect={() => {}}
        onNew={() => {}}
        onDelete={() => {}}
        onClearAll={() => {}}
      />,
    );

    expect(screen.getByText(/No conversations yet/i)).toBeTruthy();
  });

  /**
   * GLOBAL SEARCH IS WHERE THE WORST OF IT SURFACED. The store's seeded
   * `forms` reached it as hits for coaching and policy-review records about
   * invented employees — Jane Kowalski, Marcus Trent, Sofia Delgado — each
   * linking into the real Form Monitoring route.
   */
  it("offers no fabricated form records", async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <GlobalSearch />
      </Providers>,
    );

    const input = screen.getByPlaceholderText(/Search documents, videos, forms/i);
    await user.type(input, "coaching");

    for (const name of ["Jane Kowalski", "Marcus Trent", "Sofia Delgado"]) {
      expect(screen.queryByText(new RegExp(name, "i")), name).toBeNull();
    }
  });

  /**
   * A SEARCH THAT USED TO RETURN TWELVE FABRICATED RECORDS.
   *
   * What it returns now is NAVIGATION — "Form Monitoring", "Form Templates" —
   * which is correct and is the distinction being pinned. Screens are part of
   * the product; records are claims about people. So the assertion is on the
   * record links rather than on an empty result: every seeded form hit pointed
   * at `/forms/monitoring?form=<id>`, and none of those may appear.
   */
  it("returns screens to navigate to, never fabricated records", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Providers>
        <GlobalSearch />
      </Providers>,
    );

    await user.type(
      screen.getByPlaceholderText(/Search documents, videos, forms/i),
      "form",
    );

    const links = [...container.querySelectorAll("a")].map(
      (anchor) => anchor.getAttribute("href") ?? "",
    );
    expect(links.length, "navigation hits should still be offered").toBeGreaterThan(0);
    expect(links.some((href) => href.includes("?form="))).toBe(false);
  });
});
