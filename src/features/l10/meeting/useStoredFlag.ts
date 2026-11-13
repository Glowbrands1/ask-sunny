"use client";
// Copied from the Leadership Hub (src/app/meetings/useStoredFlag.ts); keep in step with it. See src/features/l10/README.md.

import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
const read = (key: string) => {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false; // private window, blocked storage: the page works without remembering
  }
};

/** A true/false choice remembered in this browser only (a convenience, never needed for the page to work). */
export function useStoredFlag(key: string): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      window.addEventListener("storage", cb);
      return () => {
        listeners.delete(cb);
        window.removeEventListener("storage", cb);
      };
    },
    () => read(key),
    () => false,
  );
  const set = (next: boolean) => {
    try {
      window.localStorage.setItem(key, next ? "1" : "0");
    } catch {
      /* not remembered */
    }
    listeners.forEach((l) => l());
  };
  return [value, set];
}
