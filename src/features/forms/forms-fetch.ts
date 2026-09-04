"use client";

import type { Role } from "@/types";

/**
 * THE HEADERS A FORMS REQUEST CARRIES, AND WHAT THEY ARE NOT.
 *
 * These headers are a DEMO-MODE CONVENIENCE and have never been a credential.
 * The browser names the preview role it is using; the server treats it as
 * unverified and stamps every record it creates as `demo:<role>`.
 *
 * THEY DO NOTHING UNDER REAL AUTHENTICATION. `authorizeForms` takes the live
 * branch there, where `authorizeRequest` reads the identity from a validated
 * session cookie and the role from `app_users` — so a request carrying these
 * headers is authorized exactly as one without them. They are still sent
 * because the same client code serves both modes, and sending a header the
 * server ignores is harmless in a way that branching on the mode in every
 * screen would not be.
 *
 * They live in one function so no screen can invent its own way of claiming to
 * be somebody, and so there is a single place to delete them when demo mode
 * itself goes.
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

/**
 * Opening the PDF preview of a template version.
 *
 * Same reason `downloadFormPdf` exists: a plain link carries none of the Forms
 * headers, so the preview route would answer 401 and open a tab full of JSON.
 * The bytes are fetched, turned into a blob URL and opened, and the URL is
 * revoked once the new tab has had a chance to take it.
 */
export async function previewTemplatePdf(
  templateKey: string,
  variantKey: string | null,
  role: Role,
  name: string,
): Promise<void> {
  const query = variantKey ? `?variant=${encodeURIComponent(variantKey)}` : "";
  const response = await fetch(`/api/forms/templates/${templateKey}/preview${query}`, {
    headers: formsHeaders(role, name),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? "That preview could not be produced.");
  }

  const url = URL.createObjectURL(await response.blob());
  const opened = window.open(url, "_blank");
  if (!opened) {
    URL.revokeObjectURL(url);
    throw new Error("Allow pop-ups for this site to open the PDF preview.");
  }
  // Revoking immediately can race the new tab's own load, so give it a beat.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
