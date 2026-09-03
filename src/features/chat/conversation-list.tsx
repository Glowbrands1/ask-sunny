"use client";

import { useMemo, useState } from "react";
import { MessageSquare, Plus, Trash2 } from "lucide-react";

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
}: {
  conversations: ChatConversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
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
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-border p-3">
        <Button className="w-full" onClick={onNew}>
          <Plus />
          New chat
        </Button>
      </div>

      <div className="scroll-slim flex-1 overflow-y-auto p-2">
        {conversations.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs leading-relaxed text-muted-foreground">
            No conversations yet. Your chat history is private to your account.
          </p>
        ) : (
          grouped.map((group) => (
            <div key={group.bucket} className="mb-3 last:mb-0">
              <p className="eyebrow px-2.5 pb-1.5">{group.bucket}</p>
              <ul className="space-y-0.5">
                {group.items.map((conversation) => {
                  const active = conversation.id === activeId;
                  return (
                    <li key={conversation.id} className="group/item relative">
                      <button
                        type="button"
                        onClick={() => onSelect(conversation.id)}
                        aria-current={active ? "true" : undefined}
                        className={cn(
                          "flex w-full items-start gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-2 pr-9 text-left transition-colors",
                          /*
                           * ITS OWN TOKEN, not the rail's. This borrowed
                           * `--sidebar-active`, which is now the pale canvas
                           * pill that reads against the grey rail — and would
                           * be invisible here on white. A selected row is
                           * generic selected UI, so it reads navy like every
                           * other one.
                           */
                          active
                            ? "bg-selected-soft text-selected-soft-foreground"
                            : "text-muted-foreground hover:bg-hover-surface hover:text-foreground",
                        )}
                      >
                        <MessageSquare
                          className={cn(
                            "mt-0.5 size-3.5 shrink-0",
                            active ? "text-selected" : "text-subtle-foreground",
                          )}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] leading-snug font-medium">
                            {conversation.title}
                          </span>
                          <span className="mt-0.5 block text-[11px] text-subtle-foreground">
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
                          className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-[var(--radius-xs)] p-1.5 text-subtle-foreground opacity-0 transition-opacity group-hover/item:opacity-100 hover:bg-surface hover:text-status-failed focus-visible:opacity-100"
                        >
                          <Trash2 className="size-3.5" />
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

      <div className="shrink-0 border-t border-border p-3">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          onClick={() => setClearOpen(true)}
          disabled={conversations.length === 0}
        >
          <Trash2 />
          Clear history
        </Button>
        <p className="mt-2 px-2.5 text-[11px] leading-relaxed text-subtle-foreground">
          Chat history is private to your account.
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
