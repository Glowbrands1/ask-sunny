"use client";

import type { Role } from "@/types";

/**
 * THE HEADERS A FORMS REQUEST CARRIES, AND WHAT THEY ARE NOT.
 *
 * Ask Sunny has no identity provider, so the browser tells the server which
 * preview role it is using. That is a CONVENIENCE, not a credential: the server
 * treats it as unverified, stamps every record it creates as `demo:<role>`, and
 * refuses outright in live mode where `authorizeRequest` takes over.
 *
 * It lives in one function so there is a single place to delete when real
 * authentication lands — and so no screen can quietly invent its own way of
 * claiming to be somebody.
 */
export function formsHeaders(role: Role, name: string): HeadersInit {
  return {
    "x-ask-sunny-demo-role": role,
    "x-ask-sunny-demo-name": name.slice(0, 60),
  };
}

/** `fetch` with those headers, and JSON errors turned into thrown messages. */
export async function formsFetch<T>(
  url: string,
  role: Role,
  name: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(formsHeaders(role, name))) {
    headers.set(key, value as string);
  }

  const response = await fetch(url, { ...init, headers });
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    problems?: string[];
  };
  if (!response.ok) {
    throw new Error(payload.problems?.join(" ") ?? payload.error ?? "That did not work.");
  }
  return payload;
}

/**
 * DOWNLOADING A FINALIZED FORM.
 *
 * The obvious implementation — `<a href="/api/forms/instances/…/pdf">` — is
 * wrong here, and quietly so. A plain navigation carries none of the headers
 * above, so the route answers 401 and the manager gets a JSON error where a
 * disciplinary record should be. QA caught it because a request context without
 * the headers received 97 bytes instead of a PDF.
 *
 * So the bytes are fetched with the same headers as every other Forms call and
 * handed to the browser as a blob. The object URL is revoked once the download
 * has started; leaving it alive pins the whole file in memory for the life of
 * the tab.
 */
export async function downloadFormPdf(
  instanceId: string,
  role: Role,
  name: string,
): Promise<void> {
  const response = await fetch(`/api/forms/instances/${instanceId}/pdf`, {
    headers: formsHeaders(role, name),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? "That form could not be downloaded.");
  }

  const disposition = response.headers.get("content-disposition") ?? "";
  const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `form-${instanceId}.pdf`;

  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
