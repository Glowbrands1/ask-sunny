"use client";

import { useId, useState } from "react";

import { CheckboxField } from "@/components/ui/controls";

/**
 * "ALSO PUBLISH TO <OTHER APP>": the opt-in box on the AI Training editing
 * screens. Starts unticked; the editor's last choice is remembered in this
 * browser only (a convenience, so storage failing just means it starts
 * unticked). Hidden when publishing to the other app is not set up.
 */

const STORAGE_KEY = "ai-training:publish-to-other";

function readRemembered(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function usePublishToOther(): [boolean, (value: boolean) => void] {
  const [checked, setChecked] = useState<boolean>(() => (typeof window === "undefined" ? false : readRemembered()));
  function update(value: boolean) {
    setChecked(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
    } catch {
      // storage blocked: the choice lasts for this screen only
    }
  }
  return [checked, update];
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
