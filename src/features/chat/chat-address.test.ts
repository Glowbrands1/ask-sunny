import { describe, expect, it } from "vitest";

import { chatAddressFor } from "./chat-address";

describe("chatAddressFor", () => {
  it("writes the open conversation into the address", () => {
    expect(chatAddressFor("", "conv-1")).toBe("c=conv-1");
  });

  it("returns null when the address already names it", () => {
    expect(chatAddressFor("?c=conv-1", "conv-1")).toBeNull();
  });

  it("replaces the conversation when another one is opened", () => {
    expect(chatAddressFor("?c=conv-1", "conv-2")).toBe("c=conv-2");
  });

  it("drops the conversation for a new chat", () => {
    expect(chatAddressFor("?c=conv-1", null)).toBe("");
    expect(chatAddressFor("", null)).toBeNull();
  });

  it("drops ?q= once a conversation is open, so a reload does not ask it again", () => {
    expect(chatAddressFor("?q=hello", "conv-1")).toBe("c=conv-1");
    expect(chatAddressFor("?c=conv-1&q=hello", "conv-1")).toBe("c=conv-1");
  });

  it("keeps the report context parameters", () => {
    expect(chatAddressFor("?report=salon-sales&location=salon-66", "conv-1")).toBe(
      "report=salon-sales&location=salon-66&c=conv-1",
    );
    expect(chatAddressFor("?report=salon-sales&c=conv-1", null)).toBe("report=salon-sales");
  });
});
