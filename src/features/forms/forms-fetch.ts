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
