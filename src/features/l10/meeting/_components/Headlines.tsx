"use client";
// Copied from the Leadership Hub (src/app/meetings/_components/Headlines.tsx); keep in step with it. See src/features/l10/README.md.

import { useState } from "react";
import { Button } from "@/features/l10/ui/ui";
import { MentionField, MentionText, useMentionPlain } from "@/features/l10/ui/Mentions";
import { newItemId } from "@/features/l10/lib/doc";
import type { Headline } from "@/features/l10/lib/types";

function Column({ title, kind, items, author, onAdd, onRemove }: { title: string; kind: Headline["kind"]; items: Headline[]; author: string; onAdd: (h: Headline) => void; onRemove: (id: string) => void }) {
  const plain = useMentionPlain();
  const [text, setText] = useState("");
  const submit = () => {
    if (!text.trim()) return;
    onAdd({ id: newItemId(), kind, text: text.trim(), author });
    setText("");
  };
  return (
    <section aria-label={`${title} headlines`} className="rounded-[10px] border border-line bg-white p-4 shadow-card">
      <h3 className="m-0 text-base font-bold">{title}</h3>
      <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
        {items.map((h) => (
          <li key={h.id} className="flex items-start justify-between gap-2 rounded-lg bg-cream px-3 py-2 text-sm">
            <span>
              <MentionText text={h.text} /> <span className="text-xs text-muted">· {h.author}</span>
            </span>
            <button type="button" aria-label={`Remove headline ${plain(h.text)}`} className="text-xs text-muted hover:text-[#8a1c1c]" onClick={() => onRemove(h.id)}>
              ✕
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="rounded-lg border border-dashed border-line px-3 py-2 text-xs text-muted">No {title.toLowerCase()} headlines yet.</li>}
      </ul>
      <div className="mt-3 flex gap-2">
        <MentionField aria-label={`New ${title.toLowerCase()} headline`} value={text} onChange={setText} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Add a headline…" className="flex-1" />
        <Button variant="primary" disabled={!text.trim()} onClick={submit}>
          Add
        </Button>
      </div>
    </section>
  );
}

export function Headlines({ headlines, onChange, author }: { headlines: Headline[]; onChange: (next: Headline[]) => void; author: string }) {
  const add = (h: Headline) => onChange([...headlines, h]);
  const remove = (id: string) => onChange(headlines.filter((h) => h.id !== id));
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Column title="Customer" kind="customer" items={headlines.filter((h) => h.kind === "customer")} author={author} onAdd={add} onRemove={remove} />
      <Column title="Employee" kind="employee" items={headlines.filter((h) => h.kind === "employee")} author={author} onAdd={add} onRemove={remove} />
    </div>
  );
}
