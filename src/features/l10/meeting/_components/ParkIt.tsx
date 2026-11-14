"use client";
// Copied from the Leadership Hub (src/app/meetings/_components/ParkIt.tsx); keep in step with it. See src/features/l10/README.md.

import { useState } from "react";
import { Button, Modal, inputClass } from "@/features/l10/ui/ui";

/** Floating "Add to IDS": park an issue from any section. */
export function ParkIt({ onPark, open, setOpen }: { onPark: (title: string) => void; open: boolean; setOpen: (open: boolean) => void }) {
  const [title, setTitle] = useState("");
  const [notice, setNotice] = useState("");
  const submit = () => {
    const t = title.trim();
    if (!t) return;
    onPark(t);
    setNotice(`Added to IDS: ${t}`);
    setTitle("");
    setOpen(false);
  };
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)} data-page-fab className="fixed right-(--fab-right) bottom-(--fab-bottom) z-40 min-h-(--fab-h) rounded-full shadow-card print:hidden" title="Add an issue to IDS">
        Add to IDS
      </Button>
      <p role="status" aria-live="polite" className="sr-only">
        {notice}
      </p>
      <Modal
        open={open}
        title="Park an issue"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={!title.trim()} onClick={submit}>
              Add to IDS
            </Button>
          </>
        }
      >
        <input aria-label="Short issue title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Short issue title…" className={inputClass} />
      </Modal>
    </>
  );
}
