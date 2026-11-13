// Copied from the Leadership Hub (src/app/meetings/_components/RestoreButton.tsx); keep in step with it. See src/features/l10/README.md.
"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/features/l10/ui/ui";
import type { RestoreOutcome } from "@/features/l10/data.server";

export type RestoreFn = (key: string, version: number) => Promise<RestoreOutcome>;

/**
 * "Restore this version" with a confirm step that says exactly what will be replaced. The old document is saved as a
 * new version (nothing is deleted), so the restore itself appears in the history.
 */
export function RestoreButton({ meetingKey, meetingName, version, savedAtLabel, currentVersion, restore }: { meetingKey: string; meetingName: string; version: number; savedAtLabel: string; currentVersion: number; restore: RestoreFn }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const opener = useRef<HTMLButtonElement>(null);

  const close = () => {
    setOpen(false);
    opener.current?.focus();
  };
  const confirm = () =>
    start(async () => {
      const r = await restore(meetingKey, version);
      if (r.ok) {
        setOpen(false);
        setMessage(`Restored. It is now version ${r.version}.`);
        router.refresh();
      } else setMessage(r.message);
    });

  return (
    <>
      <button ref={opener} type="button" onClick={() => setOpen(true)} className="inline-flex min-h-11 items-center rounded-lg border border-line bg-white px-3 text-sm font-semibold text-[#7a1717] hover:bg-cream" aria-label={`Restore version ${version}`}>
        Restore this version
      </button>
      {message && (
        <span role="status" className="text-sm font-semibold">
          {message}
        </span>
      )}
      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onKeyDown={(e) => e.key === "Escape" && close()}>
          <div role="dialog" aria-modal="true" aria-labelledby={`restore-title-${version}`} className="flex w-full max-w-md flex-col gap-4 rounded-2xl bg-white p-6 shadow-xl">
            <h2 id={`restore-title-${version}`} className="m-0 text-lg font-bold">
              Restore version {version}?
            </h2>
            <p className="m-0 text-sm">
              This replaces everything in the {meetingName} (currently version {currentVersion}) with how it was in version {version}, saved {savedAtLabel}. Version {currentVersion} is not deleted: it stays in the history, and the restore is saved as a new version.
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button autoFocus onClick={close} disabled={pending}>
                Cancel
              </Button>
              <Button variant="primary" onClick={confirm} disabled={pending}>
                {pending ? "Restoring…" : `Yes, restore version ${version}`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
