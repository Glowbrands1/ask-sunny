"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogActions,
  DialogClose,
  DialogContent,
  Tooltip,
} from "@/components/ui/overlays";
import { cn } from "@/lib/utils/cn";
import { formatTime, historyBucket, relativeTime } from "@/lib/utils/date";
import type { ChatConversation } from "@/types";

const BUCKET_ORDER = [
  "Today",
  "Yesterday",
  "Previous 7 days",
  "Previous 30 days",
  "Earlier",
];

export function ConversationList({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onClearAll,
  showHeading = true,
}: {
  conversations: ChatConversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
  /**
   * The rail owns its own "History" heading. The mobile drawer already has a
   * titled header bar above this component, so it opts out rather than
   * stacking two headings on top of each other.
   */
  showHeading?: boolean;
}) {
  const [clearOpen, setClearOpen] = useState(false);

  const grouped = useMemo(() => {
    const buckets = new Map<string, ChatConversation[]>();
    [...conversations]
      .sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )
      .forEach((conversation) => {
        const bucket = historyBucket(conversation.updatedAt);
        const list = buckets.get(bucket) ?? [];
        list.push(conversation);
        buckets.set(bucket, list);
      });
    return BUCKET_ORDER.filter((bucket) => buckets.has(bucket)).map((bucket) => ({
      bucket,
      items: buckets.get(bucket) ?? [],
    }));
  }, [conversations]);

  return (
    /*
     * ==========================================================================
     * THE HISTORY PANEL TAKES THE PEACH GROUND
     * ==========================================================================
     *
     * The Marquee Chat artifact's fourth item, and it is a structural argument
     * rather than a preference: "The rail stays grey, the history panel takes
     * the peach ground with white thread cards, and the open thread gets a
     * yellow left edge. Two neutral panels side by side need different grounds
     * or they read as one."
     *
     * That is exactly what was wrong. The panel was `bg-sidebar` — the same
     * grey as the navigation rail immediately to its left — so at a glance the
     * chat tab had one 400px grey column rather than a rail and a history.
     *
     * SO THE INKS MOVE BACK TO THE CANVAS TOKENS. An earlier note here warned
     * that the canvas inks measured 1.26:1 and 1.92:1 in this list and had to
     * be the rail's. That was correct WHILE the panel was grey; the ground is
     * peach now, which is what those tokens are contrast-checked against, and
     * the rail's darker inks would be the wrong ones here instead.
     *
     * THE OPEN THREAD IS A YELLOW LEFT EDGE, not a navy fill. Yellow is the
     * direction's "where you are" marker — the rail pill and the active report
     * tab — and a thread card is exactly that: which of these am I reading. It
     * also stays a white card, so the selected row does not change shape.
     */
    <div className="flex h-full flex-col bg-background">
      <div className="shrink-0 p-3.5 pb-2.5">
        {/* The near-black pill the artifact draws, not a full-width button. */}
        <button
          type="button"
          onClick={onNew}
          className="pill-action w-full justify-center bg-selected text-selected-foreground transition-colors hover:bg-selected-hover"
        >
          <Plus className="size-3" />
          New chat
        </button>
      </div>

      {/*
        NO VISIBLE "HISTORY" HEADING. The artifact's panel is labelled by its
        own bucket rows — Today, Yesterday, Previous 7 days — and a heading
        above them would be a fourth label saying what the three already say.
        The region keeps an accessible name so a screen reader still hears what
        this list is, and the drawer supplies its own visible title instead.
      */}
      <div
        {...(showHeading ? { role: "region", "aria-label": "Chat history" } : {})}
        className="scroll-slim flex-1 overflow-y-auto px-3.5 pb-2"
      >
        {conversations.length === 0 ? (
          <p className="px-1 py-6 text-center text-[11px] leading-relaxed text-muted-foreground">
            No conversations yet. Your chat history is private to your account.
          </p>
        ) : (
          grouped.map((group) => (
            <div key={group.bucket} className="mb-3 last:mb-0">
              <p className="eyebrow pb-1.5 tracking-[0.16em]">{group.bucket}</p>
              <ul className="space-y-1.5">
                {group.items.map((conversation) => {
                  const active = conversation.id === activeId;
                  return (
                    <li key={conversation.id} className="group/item relative">
                      <button
                        type="button"
                        onClick={() => onSelect(conversation.id)}
                        aria-current={active ? "true" : undefined}
                        className={cn(
                          "flex w-full items-start gap-2 rounded-[10px] border border-border bg-surface px-2.5 py-2 pr-8 text-left leading-tight transition-shadow",
                          active
                            ? "border-l-[3px] border-l-brand-yellow shadow-raised"
                            : "shadow-soft hover:shadow-raised",
                        )}
                      >
                        {/*
                          NO ICON ON A THREAD CARD. `MessageSquare` at 12px
                          rendered as a small empty square — it read as an
                          unticked checkbox down the left of every row, which is
                          worse than no icon. The artifact's cards are the title
                          and the time, and the card itself already says what it
                          is.
                        */}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[11.5px] font-bold text-foreground">
                            {conversation.title}
                          </span>
                          <span className="mt-0.5 block text-[9.5px] text-muted-foreground">
                            {historyBucket(conversation.updatedAt) === "Today"
                              ? formatTime(conversation.updatedAt)
                              : relativeTime(conversation.updatedAt)}
                          </span>
                        </span>
                      </button>
                      <Tooltip content="Delete conversation">
                        <button
                          type="button"
                          onClick={() => onDelete(conversation.id)}
                          aria-label={`Delete conversation: ${conversation.title}`}
                          className="absolute top-1/2 right-1 -translate-y-1/2 rounded-[var(--radius-xs)] p-1.5 text-muted-foreground opacity-0 transition-opacity group-hover/item:opacity-100 hover:bg-surface-muted hover:text-status-failed focus-visible:opacity-100"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </Tooltip>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>

      {/*
        THE FOOTER IS ONE LINE, on a hairline rather than a panel edge — the
        artifact's `.ft`: "Clear history · History is private to your account."
      */}
      <div className="mt-auto shrink-0 border-t border-border px-3.5 py-3">
        <button
          type="button"
          onClick={() => setClearOpen(true)}
          disabled={conversations.length === 0}
          className="text-[9.5px] font-black tracking-[0.1em] uppercase text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-muted-foreground"
        >
          Clear history
        </button>
        <p className="mt-1 text-[9.5px] leading-relaxed text-muted-foreground">
          History is private to your account.
        </p>
      </div>

      <Dialog open={clearOpen} onOpenChange={setClearOpen}>
        <DialogContent
          title="Clear chat history?"
          description="Removes every conversation stored in this browser."
        >
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            This permanently deletes all {conversations.length} conversations from
            your history. Documents, forms, and everything else in Ask Sunny are
            unaffected.
          </p>
          <DialogActions>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                onClearAll();
                setClearOpen(false);
              }}
            >
              Clear history
            </Button>
          </DialogActions>
        </DialogContent>
      </Dialog>
    </div>
  );
}
