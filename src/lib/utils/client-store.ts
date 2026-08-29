"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Small external stores for browser-only values.
 *
 * These exist so the app can read `localStorage` / `sessionStorage` without
 * copying them into React state inside an effect — which causes a cascading
 * render on every mount and is what `react-hooks/set-state-in-effect` warns
 * about. `useSyncExternalStore` is the sanctioned way to read an external
 * system during render while staying hydration-safe.
 */

const noopSubscribe = () => () => {};
const returnTrue = () => true;
const returnFalse = () => false;

/** True only after hydration. Lets a component wait before reading storage. */
export function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, returnTrue, returnFalse);
}

type StoreKind = "local" | "session";

const listeners = new Set<() => void>();
const cache = new Map<string, string | null>();

function emit() {
  listeners.forEach((listener) => listener());
}

function backing(kind: StoreKind): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function cacheKey(kind: StoreKind, key: string) {
  return `${kind}:${key}`;
}

function read(kind: StoreKind, key: string): string | null {
  const composite = cacheKey(kind, key);
  if (cache.has(composite)) return cache.get(composite) ?? null;
  let value: string | null = null;
  try {
    value = backing(kind)?.getItem(key) ?? null;
  } catch {
    value = null;
  }
  cache.set(composite, value);
  return value;
}

/** Writes through to storage and notifies every subscribed component. */
export function writePreference(kind: StoreKind, key: string, value: string): void {
  cache.set(cacheKey(kind, key), value);
  try {
    backing(kind)?.setItem(key, value);
  } catch {
    /* Storage unavailable — the value still applies for this session. */
  }
  emit();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** Reads a persisted string, falling back until hydration completes. */
export function usePreference(
  kind: StoreKind,
  key: string,
  fallback: string,
): string {
  const getSnapshot = useCallback(() => read(kind, key) ?? fallback, [kind, key, fallback]);
  const getServerSnapshot = useCallback(() => fallback, [fallback]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
