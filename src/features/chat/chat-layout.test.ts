import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * ============================================================================
 * THE CHAT WORKSPACE HEIGHT CONTRACT
 * ============================================================================
 *
 * THE DEFECT THESE PIN. `ChatScreen` asked for
 * `h-[calc(100dvh-3.5rem)] lg:h-dvh`, and the `lg:` half was wrong. `AppShell`
 * renders an `h-14` (3.5rem) header ABOVE this in normal flow — a sticky element
 * still occupies its space — so on every laptop the workspace claimed the whole
 * dynamic viewport while sitting 56px down it. The page grew 56px taller than
 * the viewport: a page-level scrollbar with the composer below the fold, under a
 * conversation pane that was already short.
 *
 * The second half is `min-h-0`. A flex child defaults to `min-height: auto`,
 * which lets it grow to fit its content instead of scrolling inside its parent.
 * Without it at EVERY level between the fixed-height root and the scrolling
 * message list, `overflow-y-auto` never engages and a long answer pushes the
 * composer off-screen.
 *
 * ============================================================================
 * WHY THESE ARE STRUCTURAL ASSERTIONS
 * ============================================================================
 *
 * jsdom does not lay out. It reports every height as 0 and every scrollHeight as
 * 0, so a test claiming to measure this viewport would be measuring nothing. The
 * contract IS the class chain, so the class chain is what is asserted — and the
 * pixels are Preview QA on a real laptop and a real phone, which the Phase 1
 * report says out loud rather than implying jsdom covered it.
 */

const SCREEN = readFileSync("src/features/chat/chat-screen.tsx", "utf8");
const SHELL = readFileSync("src/components/shell/app-shell.tsx", "utf8");
const COMPOSER = readFileSync("src/features/chat/composer.tsx", "utf8");

/** Comments stripped — these files explain the rules they must not break. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const SCREEN_CODE = code(SCREEN);
const COMPOSER_CODE = code(COMPOSER);

describe("the workspace is the viewport minus the shell header", () => {
  it("still renders a 3.5rem shell header above it", () => {
    // The number in the calc below is only correct while this is true, so it
    // is checked rather than assumed.
    expect(code(SHELL)).toMatch(/<header[^>]*className="[^"]*\bh-14\b/);
    expect(code(SHELL)).toMatch(/<header[^>]*className="[^"]*\bshrink-0\b/);
  });

  it("subtracts exactly that header height", () => {
    expect(SCREEN_CODE).toContain("h-[calc(100dvh-3.5rem)]");
  });

  it("never claims the whole viewport at any breakpoint", () => {
    // The regression. `lg:h-dvh` below an h-14 header overflows the page by
    // exactly the header's height.
    expect(SCREEN_CODE).not.toMatch(/\b(?:sm|md|lg|xl|2xl):h-dvh\b/);
    expect(SCREEN_CODE).not.toMatch(/\bh-screen\b/);
  });

  it("hardcodes no fixed answer-pane height", () => {
    // "Make the answer window 280px" would satisfy a screenshot and break on
    // every other screen.
    expect(SCREEN_CODE).not.toMatch(/h-\[\d+px\]/);
    expect(SCREEN_CODE).not.toMatch(/max-h-\[\d+px\]/);
  });
});

describe("the conversation is the flexible region and the composer is not", () => {
  it("carries min-h-0 on the root, so its children can scroll inside it", () => {
    const root = SCREEN_CODE.slice(SCREEN_CODE.indexOf("h-[calc(100dvh-3.5rem)]"));
    expect(root.slice(0, 120)).toContain("min-h-0");
  });

  it("carries min-h-0 on the conversation column between root and list", () => {
    /*
     * The column sits in a ROW flex container, where `min-height: auto` is the
     * default and lets it grow past the fixed-height root. This was missing.
     */
    expect(SCREEN_CODE).toMatch(/className="flex min-h-0 min-w-0 flex-1 flex-col"/);
  });

  it("gives the message list flex-1, min-h-0 and its own scroll", () => {
    const list = SCREEN_CODE.slice(SCREEN_CODE.indexOf("ref={scrollRef}"));
    const className = list.slice(0, 160);
    expect(className).toContain("min-h-0");
    expect(className).toContain("flex-1");
    expect(className).toContain("overflow-y-auto");
  });

  it("lets the composer take only its content height", () => {
    // `shrink-0` is what stops a flex sibling from compressing it; without it a
    // long answer would squeeze the input rather than scroll.
    expect(COMPOSER_CODE).toMatch(/className="shrink-0 border-t border-border/);
    // And it never asks to absorb leftover space, which would defeat the point.
    expect(COMPOSER_CODE).not.toMatch(/\bflex-1\b/);
  });
});

describe("the composer's own footprint", () => {
  it("has one control row, not a separate mode row above the input", () => {
    /*
     * The mode control and the send button share a container. A composer that
     * kept a dedicated full-width row above the input would still render three
     * working modes and would still fail the thing Marissa reported.
     */
    const modeRow = COMPOSER_CODE.indexOf("<SegmentedControl");
    const textareaAt = COMPOSER_CODE.indexOf("<textarea");
    expect(textareaAt).toBeGreaterThan(-1);
    expect(modeRow).toBeGreaterThan(textareaAt);
  });

  it("imports no attachment, image or microphone icon", () => {
    // Dormant code is allowed by the brief; a dead control is not. Nothing is
    // left importing one.
    expect(COMPOSER_CODE).not.toMatch(/\bPaperclip\b|\bImagePlus\b|\bMic\b/);
  });

  it("renders no permanently mounted helper paragraph", () => {
    expect(COMPOSER_CODE).not.toContain("ANSWER_MODE_HELPER[mode]");
  });
});

describe("no chat surface renders a dead control or a source block", () => {
  /*
   * H-K, ACROSS THE WHOLE FEATURE rather than in one component. The composer
   * test proves the composer is clean; this proves there is no OTHER chat
   * surface — a mobile variant, an older screen, a second composer — quietly
   * rendering them. That was the first thing to rule out when the controls were
   * reported as still visible in Preview.
   */
  const CHAT_SOURCES = readdirSync("src/features/chat")
    .filter((name) => (name.endsWith(".tsx") || name.endsWith(".ts")) && !name.includes(".test."))
    .map((name) => ({ name, code: code(readFileSync(join("src/features/chat", name), "utf8")) }));

  it("finds the chat feature's files, so an empty sweep cannot pass", () => {
    expect(CHAT_SOURCES.length).toBeGreaterThanOrEqual(5);
    expect(CHAT_SOURCES.map((entry) => entry.name)).toContain("composer.tsx");
    expect(CHAT_SOURCES.map((entry) => entry.name)).toContain("chat-screen.tsx");
  });

  it.each(["Paperclip", "ImagePlus", "Mic", "Coming later", "Attach a file", "Voice input"])(
    "renders no %s anywhere in chat",
    (token) => {
      for (const entry of CHAT_SOURCES) {
        expect(entry.code, `${entry.name} renders "${token}"`).not.toContain(token);
      }
    },
  );

  it("renders no source card or source heading anywhere in chat", () => {
    for (const entry of CHAT_SOURCES) {
      expect(entry.code, entry.name).not.toContain("SourceCardList");
      expect(entry.code, entry.name).not.toContain("SourceCard");
      expect(entry.code, entry.name).not.toMatch(/Sources for this answer/);
    }
  });

  it("still carries citations on the message model, untouched", () => {
    /*
     * THE HALF THAT MUST NOT HAVE CHANGED. Removing the block was a rendering
     * decision; if grounding had been switched off instead, every assertion
     * above would still pass and the product would be broken.
     */
    const types = readFileSync("src/types/index.ts", "utf8");
    expect(types).toMatch(/citations\?: SourceCitation\[\]/);

    const chatRoute = readFileSync("src/app/api/chat/route.ts", "utf8");
    expect(chatRoute).toContain("answerQuestion");
  });
});
