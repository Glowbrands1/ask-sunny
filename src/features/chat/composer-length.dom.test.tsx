// @vitest-environment jsdom
import * as React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/overlays";
import { MESSAGE_LIMIT_COPY } from "@/lib/chat/message-limit";
import { Composer } from "./composer";
import type { AnswerMode } from "@/types";

/**
 * The composer's length line, CHAT_LONG_MESSAGE_ENABLED (QA approved, 25 Oct
 * 2026). Pau's decision: the limit goes up to 12,000 characters, the manager
 * is warned before sending, and text is never cut. From 90% of the limit a
 * line under the field says how many characters are left; over it, the line
 * says how long the message is and send is disabled. Off, the composer is
 * what it was: no line, no new attribute, send as before.
 */

const FLAG = "NEXT_PUBLIC_CHAT_LONG_MESSAGE_ENABLED";
const saved = process.env[FLAG];

function renderComposer(value: string) {
  const props = {
    value,
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    mode: "standard" as AnswerMode,
    onModeChange: vi.fn(),
    busy: false,
  };
  const view = render(
    <TooltipProvider>
      <Composer {...props} />
    </TooltipProvider>,
  );
  return { ...view, props };
}

const field = () => screen.getByLabelText("Ask Sunny a question") as HTMLTextAreaElement;
const send = () => screen.getByRole("button", { name: "Send message" }) as HTMLButtonElement;
const line = (container: HTMLElement) => container.querySelector("#chat-input-length");

beforeEach(() => {
  delete process.env[FLAG];
});

afterEach(() => {
  cleanup();
  if (saved === undefined) delete process.env[FLAG];
  else process.env[FLAG] = saved;
});

describe("flag off: the composer is what it was", () => {
  it("shows no line and keeps send enabled for a 12,001-character message", () => {
    const { container, props } = renderComposer("x".repeat(12_001));
    expect(line(container)).toBeNull();
    expect(field().hasAttribute("aria-describedby")).toBe(false);
    expect(send().disabled).toBe(false);
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });

  it("renders the same markup with the flag 'off' as with it unset", () => {
    const unset = renderComposer("x".repeat(11_000)).container.innerHTML;
    cleanup();
    process.env[FLAG] = "off";
    const off = renderComposer("x".repeat(11_000)).container.innerHTML;
    expect(off).toBe(unset);
  });
});

describe("flag on: warned before sending, never cut", () => {
  beforeEach(() => {
    process.env[FLAG] = "1";
  });

  it("says nothing below 90% of the limit", () => {
    const { container } = renderComposer("x".repeat(10_799));
    expect(line(container)).toBeNull();
    expect(send().disabled).toBe(false);
  });

  it("shows how many characters are left from 90%, and still sends", () => {
    const { container, props } = renderComposer("x".repeat(10_800));
    const notice = line(container)!;
    expect(notice.textContent).toBe("1,200 characters left of 12,000.");
    expect(notice.getAttribute("role")).toBe("status");
    expect(field().getAttribute("aria-describedby")).toBe("chat-input-length");
    expect(send().disabled).toBe(false);
    fireEvent.click(send());
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });

  it("disables send over the limit with a clear message, and leaves the text whole", () => {
    const text = "x".repeat(12_001);
    const { container, props } = renderComposer(text);
    const notice = line(container)!;
    expect(notice.textContent).toBe(MESSAGE_LIMIT_COPY.over(12_001, 12_000));
    expect(notice.textContent).toBe(
      "This message is 12,001 characters. The limit is 12,000. Shorten it or split it into two messages. Nothing was cut.",
    );
    expect(notice.getAttribute("role")).toBe("alert");
    expect(send().disabled).toBe(true);
    fireEvent.keyDown(field(), { key: "Enter" });
    fireEvent.click(send());
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(field().value).toBe(text);
    expect(field().hasAttribute("maxlength")).toBe(false);
  });

  it("sends at exactly the limit", () => {
    const { props } = renderComposer("x".repeat(12_000));
    expect(send().disabled).toBe(false);
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });
});
