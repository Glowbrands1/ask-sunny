// @vitest-environment jsdom
import * as React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/overlays";
import type { SpeechRecognitionLike, SpeechRecognitionResultEventLike } from "@/components/dictate-button";
import { Composer } from "./composer";
import { ConversationRating } from "./conversation-rating";
import type { AnswerMode } from "@/types";

/**
 * ============================================================================
 * "DICTATE WITH YOUR VOICE" IN THE CHAT BOX
 * ============================================================================
 *
 * QA's retest, 24 Nov 2026: "No upload or voice". These pin the mic beside
 * Send: the browser's speech recognition (mocked here — jsdom has none), words
 * into the box as they are heard, never sent on their own, a stop button, a
 * friendly line when the microphone is blocked or nothing was heard, and no
 * button at all where the browser cannot dictate.
 */

/* --------------------------------------------- a fake SpeechRecognition --- */

class FakeRecognition implements SpeechRecognitionLike {
  static instances: FakeRecognition[] = [];
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();

  constructor() {
    FakeRecognition.instances.push(this);
  }

  /** The browser's whole result list so far: [text, isFinal] per phrase. */
  hear(...phrases: [string, boolean][]) {
    act(() => {
      this.onresult?.({
        resultIndex: 0,
        results: phrases.map(([transcript, isFinal]) => ({ isFinal, 0: { transcript } })),
      });
    });
  }

  fail(error: string) {
    act(() => {
      this.onerror?.({ error });
      this.onend?.();
    });
  }

  end() {
    act(() => this.onend?.());
  }
}

function latest(): FakeRecognition {
  const r = FakeRecognition.instances.at(-1);
  if (!r) throw new Error("no recognition was started");
  return r;
}

/* ----------------------------------------------------------- the harness --- */

function Harness({ initial = "", onSubmit }: { initial?: string; onSubmit: (text: string) => void }) {
  const [value, setValue] = React.useState(initial);
  const [mode, setMode] = React.useState<AnswerMode>("standard");
  return (
    <TooltipProvider>
      <Composer
        value={value}
        onChange={setValue}
        onSubmit={() => {
          onSubmit(value);
          setValue("");
        }}
        mode={mode}
        onModeChange={setMode}
        busy={false}
      />
    </TooltipProvider>
  );
}

function renderComposer(initial = "") {
  const onSubmit = vi.fn();
  render(<Harness initial={initial} onSubmit={onSubmit} />);
  return { onSubmit };
}

const box = () => screen.getByLabelText("Ask Sunny a question") as HTMLTextAreaElement;
const mic = () => screen.getByRole("button", { name: "Dictate with your voice" });
const stopButton = () => screen.getByRole("button", { name: "Stop dictating" });
const status = () => screen.getByRole("status");

beforeEach(() => {
  FakeRecognition.instances = [];
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/* ------------------------------------------------ unsupported browsers --- */

describe("where the browser cannot dictate (Firefox)", () => {
  it("renders no mic at all, rather than a dead control", () => {
    renderComposer();
    expect(screen.queryByRole("button", { name: /dictate|voice|microphone/i })).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

/* -------------------------------------------------- supported browsers --- */

describe("where the browser can dictate", () => {
  beforeEach(() => {
    // Chrome, Edge and Safari expose the prefixed name.
    vi.stubGlobal("webkitSpeechRecognition", FakeRecognition);
  });

  it("shows the mic on the row with Send, as a real keyboard-operable button", () => {
    renderComposer();
    const button = mic();
    const send = screen.getByRole("button", { name: "Send message" });
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(button.parentElement).toBe(send.parentElement);
    // Directly before Send.
    expect(button.nextElementSibling).toBe(send);
  });

  it("uses the unprefixed SpeechRecognition where the browser has it", () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("SpeechRecognition", FakeRecognition);
    renderComposer();
    fireEvent.click(mic());
    expect(latest().start).toHaveBeenCalledTimes(1);
  });

  it("starts listening in en-US, with interim results, and announces it", () => {
    renderComposer();
    fireEvent.click(mic());

    const r = latest();
    expect(r.start).toHaveBeenCalledTimes(1);
    expect(r.lang).toBe("en-US");
    expect(r.interimResults).toBe(true);
    expect(r.continuous).toBe(true);

    // The listening state is visible, pressed, and in a live region.
    const button = stopButton();
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.getAttribute("data-state")).toBe("listening");
    expect(status().textContent).toMatch(/listening/i);
    expect(status().getAttribute("aria-live")).toBe("polite");
  });

  it("puts interim words in the box as they are heard, then the final words", () => {
    renderComposer();
    fireEvent.click(mic());
    const r = latest();

    r.hear(["how much P", false]);
    expect(box().value).toBe("how much P");

    r.hear(["how much PTO do I get", true]);
    expect(box().value).toBe("how much PTO do I get");

    r.hear(["how much PTO do I get", true], [" after one year", false]);
    expect(box().value).toBe("how much PTO do I get after one year");
  });

  it("keeps what was already typed and adds the dictated words after it", () => {
    renderComposer("Quick question:");
    fireEvent.click(mic());
    latest().hear(["what is the dress code", true]);
    expect(box().value).toBe("Quick question: what is the dress code");
  });

  it("never sends on its own — the manager reviews, edits and presses Send", () => {
    const { onSubmit } = renderComposer();
    fireEvent.click(mic());
    const r = latest();
    r.hear(["what is the call out policy", true]);
    fireEvent.click(stopButton());
    r.end();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(box().value).toBe("what is the call out policy");

    // And the words are editable like typed ones.
    fireEvent.change(box(), { target: { value: "what is the call-out policy?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(onSubmit).toHaveBeenCalledWith("what is the call-out policy?");
  });

  it("the stop button stops listening and keeps the last words", () => {
    renderComposer();
    fireEvent.click(mic());
    const r = latest();
    r.hear(["late for shift", false]);

    fireEvent.click(stopButton());
    expect(r.stop).toHaveBeenCalledTimes(1);
    expect(r.abort).not.toHaveBeenCalled();

    // The browser finalizes what it heard, then ends.
    r.hear(["late for shift twice", true]);
    r.end();
    expect(box().value).toBe("late for shift twice");
    expect(mic().getAttribute("aria-pressed")).toBe("false");
    expect(status().textContent).toBe("");
  });

  it("Send stops listening, and words arriving after Send do not refill the box", () => {
    const { onSubmit } = renderComposer();
    fireEvent.click(mic());
    const r = latest();
    r.hear(["can I swap shifts", true]);

    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(onSubmit).toHaveBeenCalledWith("can I swap shifts");
    expect(r.abort).toHaveBeenCalledTimes(1);
    expect(box().value).toBe("");

    r.hear(["can I swap shifts with a coworker", true]);
    expect(box().value).toBe("");
    expect(mic().getAttribute("aria-pressed")).toBe("false");
  });

  it("Enter to send stops listening too", () => {
    const { onSubmit } = renderComposer();
    fireEvent.click(mic());
    const r = latest();
    r.hear(["what is the uniform policy", true]);
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("what is the uniform policy");
    expect(r.abort).toHaveBeenCalledTimes(1);
  });

  it("typing in the box takes over from dictation", () => {
    renderComposer();
    fireEvent.click(mic());
    const r = latest();
    r.hear(["write up for", true]);
    fireEvent.change(box(), { target: { value: "write up for a no call no show" } });
    expect(r.abort).toHaveBeenCalledTimes(1);
    r.hear(["write up for her", true]);
    expect(box().value).toBe("write up for a no call no show");
  });

  it("says plainly when the microphone is blocked", () => {
    renderComposer();
    fireEvent.click(mic());
    latest().fail("not-allowed");

    expect(mic().getAttribute("aria-pressed")).toBe("false");
    expect(status().textContent).toMatch(/microphone access is off/i);
    expect(status().getAttribute("data-state")).toBe("error");
  });

  it("says plainly when nothing was heard, and the next try clears it", () => {
    renderComposer();
    fireEvent.click(mic());
    latest().fail("no-speech");
    expect(status().textContent).toMatch(/didn't hear anything/i);

    fireEvent.click(mic());
    expect(FakeRecognition.instances).toHaveLength(2);
    expect(status().textContent).toMatch(/listening/i);
  });

  it("is quiet about the abort Send itself asked for", () => {
    renderComposer("hello");
    fireEvent.click(mic());
    const r = latest();
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    // A browser may still report the abort it was given.
    act(() => r.onerror?.({ error: "aborted" }));
    expect(status().textContent).toBe("");
  });

  it("turns the microphone off when the chat is left", () => {
    const { unmount } = render(<Harness onSubmit={vi.fn()} />);
    fireEvent.click(mic());
    const r = latest();
    unmount();
    expect(r.abort).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------- the rating's comment box --- */

describe("the conversation-rating comment box has the same mic", () => {
  beforeEach(() => {
    vi.stubGlobal("webkitSpeechRecognition", FakeRecognition);
  });

  it("puts dictated words in the comment, for Submit to save", () => {
    render(<ConversationRating turnId="11111111-1111-4111-8111-111111111111" conversationId="conv_1" onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /rate this conversation/i }));

    fireEvent.click(mic());
    latest().hear(["it should have cited the policy", true]);

    const comment = screen.getByLabelText(/anything sunny should do better/i) as HTMLTextAreaElement;
    expect(comment.value).toBe("it should have cited the policy");
  });

  it("is not rendered where the browser cannot dictate", () => {
    vi.unstubAllGlobals();
    render(<ConversationRating turnId="11111111-1111-4111-8111-111111111111" conversationId="conv_1" onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /rate this conversation/i }));
    expect(screen.queryByRole("button", { name: /dictate/i })).toBeNull();
  });
});
