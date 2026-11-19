"use client";

import { useId, useSyncExternalStore } from "react";

import { CheckboxField } from "@/components/ui/controls";

/**
 * "ALSO PUBLISH TO <OTHER APP>": the opt-in box on the AI Training editing
 * screens. Starts unticked; the editor's last choice is remembered in this
 * browser only (a convenience, so storage failing just means it starts
 * unticked). Hidden when publishing to the other app is not set up.
 */

const STORAGE_KEY = "ai-training:publish-to-other";

/*
 * One shared store for every box on the page, read with useSyncExternalStore:
 * the server snapshot is always "unticked", so hydration matches, and the
 * remembered choice shows straight after. When storage is blocked the choice
 * lives in memory for this page only.
 */
let memory: boolean | null = null;
const listeners = new Set<() => void>();

function readRemembered(): boolean {
  if (memory !== null) return memory;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function remember(value: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
    memory = null;
  } catch {
    memory = value;
  }
  listeners.forEach((listener) => listener());
}

export function usePublishToOther(): [boolean, (value: boolean) => void] {
  const checked = useSyncExternalStore(subscribe, readRemembered, () => false);
  return [checked, remember];
}

/** Test seam: forget the in-memory fallback between tests. */
export function resetPublishToOtherForTests() {
  memory = null;
}

export function PublishToOtherBox({
  otherAppName,
  checked,
  onChange,
  className,
}: {
  otherAppName: string | null;
  checked: boolean;
  onChange: (value: boolean) => void;
  className?: string;
}) {
  const id = useId();
  if (!otherAppName) return null;
  return <CheckboxField id={`publish-to-other-${id}`} label={`Also publish to ${otherAppName}`} checked={checked} onCheckedChange={onChange} className={className} />;
}

/** A failed save (an error) or a save that worked here but not in the other app (a warning). */
export function SaveOutcome({ error, warning }: { error: string | null; warning: string | null }) {
  if (error) return <p className="text-sm text-status-failed" role="alert">{error}</p>;
  if (warning) return <p className="text-sm text-status-attention" role="status">{warning}</p>;
  return null;
}
