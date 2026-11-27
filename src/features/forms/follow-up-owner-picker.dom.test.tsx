// @vitest-environment jsdom
import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FollowUpOwnerPicker } from "./follow-up-owner-picker";

/**
 * Picking and changing a follow-up's owner (the owner, 27 Nov 2026: "assign a form's follow-up to someone else", from
 * Form Monitoring and from the form). The list is the server's (only people with access to the form's salon); the save
 * goes back through the same route, and a refusal is shown in the server's words. Invented people only.
 */
afterEach(() => cleanup());

const READ = {
  owner: null,
  creator: { id: "acct-creator", name: "Quinby Hale" },
  choices: [
    { id: "acct-admin", name: "Odile Ferris" },
    { id: "acct-dm", name: "Tobin Marsh" },
  ],
};

function server(reply: (url: string, init?: RequestInit) => unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const send = async <T,>(url: string, init?: RequestInit): Promise<T> => {
    calls.push({ url, init });
    const out = reply(url, init);
    if (out instanceof Error) throw out;
    return out as T;
  };
  return { send, calls };
}

describe("the follow-up's owner on Form Monitoring and the form", () => {
  it("says the creator owns it until someone else is named", () => {
    render(<FollowUpOwnerPicker formId="form-1" ownerName={null} send={server(() => READ).send} />);
    expect(screen.getByText("Owner: the form's creator")).toBeTruthy();
  });

  it("offers only the server's choices, saves the one picked, and shows the new owner", async () => {
    const { send, calls } = server((_url, init) => (init?.method === "PUT" ? { owner: { id: "acct-dm", name: "Tobin Marsh" } } : READ));
    const changed: (string | null)[] = [];
    render(<FollowUpOwnerPicker formId="form-1" ownerName={null} send={send} onChanged={(name) => changed.push(name)} />);
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    const select = (await screen.findByRole("combobox", { name: "Who owns this follow-up" })) as HTMLSelectElement;
    await waitFor(() => expect(select.options).toHaveLength(3));
    expect([...select.options].map((option) => option.text)).toEqual(["Quinby Hale (created the form)", "Odile Ferris", "Tobin Marsh"]);
    fireEvent.change(select, { target: { value: "acct-dm" } });
    fireEvent.click(screen.getByRole("button", { name: /Save owner/ }));
    await screen.findByText("Owner: Tobin Marsh");
    expect(changed).toEqual(["Tobin Marsh"]);
    expect(calls.at(-1)).toMatchObject({ url: "/api/forms/instances/form-1/follow-up/owner", init: { method: "PUT", body: JSON.stringify({ ownerId: "acct-dm" }) } });
  });

  it("changes it back to the creator", async () => {
    const { send, calls } = server((_url, init) => (init?.method === "PUT" ? { owner: null } : { ...READ, owner: { id: "acct-dm", name: "Tobin Marsh" } }));
    render(<FollowUpOwnerPicker formId="form-1" ownerName="Tobin Marsh" send={send} />);
    expect(screen.getByText("Owner: Tobin Marsh")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    const select = (await screen.findByRole("combobox")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("acct-dm"));
    fireEvent.change(select, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /Save owner/ }));
    await screen.findByText("Owner: the form's creator");
    expect(calls.at(-1)?.init?.body).toBe(JSON.stringify({ ownerId: null }));
  });

  it("shows the server's refusal and keeps the owner as it was", async () => {
    const refusal = new Error("That person cannot own this follow-up: they do not have access to this form's location and its forms.");
    const { send } = server((_url, init) => (init?.method === "PUT" ? refusal : READ));
    render(<FollowUpOwnerPicker formId="form-1" ownerName={null} send={send} />);
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    const select = (await screen.findByRole("combobox")) as HTMLSelectElement;
    await waitFor(() => expect(select.options).toHaveLength(3));
    fireEvent.change(select, { target: { value: "acct-dm" } });
    fireEvent.click(screen.getByRole("button", { name: /Save owner/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("do not have access");
  });

  it("the form itself reads the owner's name once when it only knows the account", async () => {
    const { send } = server(() => ({ ...READ, owner: { id: "acct-dm", name: "Tobin Marsh" } }));
    render(<FollowUpOwnerPicker formId="form-1" ownerName={null} ownerId="acct-dm" send={send} />);
    await screen.findByText("Owner: Tobin Marsh");
  });

  it("offers no Change to someone who may not change the follow-up", () => {
    render(<FollowUpOwnerPicker formId="form-1" ownerName={null} send={server(() => READ).send} disabled />);
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
  });
});
