// Copied from the Leadership Hub (src/app/meetings/recaps/DeleteRecapButton.tsx); keep in step with it. See src/features/l10/README.md.
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Modal } from "@/features/l10/ui/ui";
import type { DeleteOutcome } from "@/features/l10/data.server";
import { deleteRecapAction } from "@/features/l10/actions";

export type DeleteFn = (id: string) => Promise<DeleteOutcome>;

/**
 * Hub admins only (the page renders it only for them; the database refuses anyone else). Asks first, with Cancel
 * focused and Escape cancelling; the recap is soft-deleted, so an admin can restore it.
 */
export function DeleteRecapButton({ id, label, remove = deleteRecapAction }: { id: string; /** e.g. "Leadership L10 recap from Nov 2, 2026" */ label: string; remove?: DeleteFn }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await remove(id);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setOpen(false);
      // Stay on the meeting the list was filtered to (?meeting=…), and say it was deleted.
      const params = new URLSearchParams(window.location.search);
      params.set("deleted", "1");
      // Ask Sunny: the recaps page is /meetings/<key>/recaps (one meeting here), so stay on this page.
      router.replace(`${window.location.pathname}?${params}`, { scroll: false });
      router.refresh();
    } catch {
      setError("The recap was not deleted. Nothing changed: try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="outline" className="text-[#8a1c1c] print:hidden" aria-label={`Delete the ${label}`} onClick={() => setOpen(true)}>
        Delete
      </Button>
      <Modal
        open={open}
        title={`Delete the ${label}?`}
        onClose={() => {
          setOpen(false);
          setError("");
        }}
        footer={
          <>
            <Button
              onClick={() => {
                setOpen(false);
                setError("");
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" className="bg-[#8a1c1c] hover:bg-[#6f1616]" disabled={busy} onClick={() => void confirm()}>
              {busy ? "Deleting…" : "Delete recap"}
            </Button>
          </>
        }
      >
        <p className="m-0 text-sm">It disappears from the recaps list for everyone. An admin can restore it.</p>
        {error && (
          <p role="alert" className="m-0 text-sm font-semibold text-[#8a1c1c]">
            {error}
          </p>
        )}
      </Modal>
    </>
  );
}
