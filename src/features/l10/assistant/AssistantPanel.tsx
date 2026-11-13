"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cx } from "@/features/l10/ui/ui";
import { collectCitations, toolLabel } from "./citations";
import { NoteCard } from "./NoteCard";
import { SourceViewer } from "./SourceViewer";
import { isNoteDraft } from "./notes";
import { BrainIcon, CheckIcon, ChevronIcon, CloseIcon, ReportIcon, CollapseIcon, ExpandIcon, HistoryIcon, PlusIcon, SendIcon, SparkleIcon, StopIcon } from "./icons";
import { currentChatId, deleteFromHistory, listHistory, loadConversation, openFromHistory, saveConversation, saveToHistory, startNewChat, type ChatSummary } from "./storage";

/**
 * THE LEADERSHIP ASSISTANT PANEL, IN THE DM L10 TAB.
 *
 * The Leadership Hub's panel (src/components/assistant/LeadershipAssistant.tsx + Thread.tsx + MessageParts.tsx) with
 * its markup and classes, built on the AI SDK's own `useChat` instead of assistant-ui: assistant-ui needs AI SDK 7
 * and a newer Radix than Ask Sunny's, and upgrading those would change Ask Sunny's other screens.
 *
 * Same as the Hub: header (title, New chat, Expand/Shrink, Close), empty state with the Hub's L10 suggestions,
 * streamed answers in Markdown with the model's "Thinking" summary, tool status chips, Deep think, Stop.
 * Chat history works as in the Hub (this browser only; per Ask Sunny user and meeting; not shared with the Hub's).
 * Only in the Hub: attachments, @-mentions in the chat box, web sources, "Open as document".
 */

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze";
const headerButton = cx("inline-flex size-11 items-center justify-center rounded-xl text-ink hover:bg-white/70", focusRing);
const DEEP_KEY = "lh-assistant:deep";
const WIDE_KEY = "lh-assistant:wide";
const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** The Hub's suggestions for its L10 pages (src/lib/assistant/suggestions.ts, "/l10"). */
export const L10_SUGGESTIONS = [
  "Which scorecard measurables were off track in the last four weeks?",
  "Help me run a sharper IDS on our top issue.",
  "Which rocks are at risk, and how would you recover them?",
];

const chipBase = "inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold";

/** The AI SDK's tool part as the Hub's citation helpers read it ({ type: "tool-call", toolName, result }). */
function toolParts(message: UIMessage) {
  return message.parts.flatMap((p) => {
    if (!p.type.startsWith("tool-")) return [];
    const o = p as { output?: unknown; state?: string };
    return o.state === "output-available" ? [{ type: "tool-call", toolName: p.type.slice(5), result: o.output }] : [];
  });
}

/** The Hub's "Sources" row (MessageParts.tsx Citations): one pill per meeting source the answer read, opening what it read. */
function Citations({ message }: { message: UIMessage }) {
  const [openSource, setOpenSource] = useState<string | null>(null);
  const { reports } = collectCitations(toolParts(message));
  if (!reports.length) return null;
  const opened = reports.find((r) => r.source === openSource);
  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-1.5" aria-label="Sources" role="group" data-testid="citations">
        {reports.map((r) => {
          const isOpen = r.source === openSource;
          return (
            <button
              key={r.source}
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpenSource(isOpen ? null : r.source)}
              title="Show what the assistant read"
              className={cx(chipBase, "bg-sunny text-ink ring-1 ring-gold/60 hover:bg-gold-head/40", isOpen && "bg-gold-head/60", focusRing)}
            >
              <ReportIcon width={14} height={14} className="shrink-0 text-bronze-deep" />
              <span className="truncate">{r.source}</span>
              {r.sample ? <span className="shrink-0 font-normal text-muted">· sample</span> : null}
            </button>
          );
        })}
      </div>
      {opened ? <SourceViewer citation={opened} onClose={() => setOpenSource(null)} /> : null}
    </div>
  );
}

/** The route's own words (the budget or rate-limit reply arrives as JSON), else a plain fallback. */
export function errorText(raw: string | undefined): string {
  const fallback = "The assistant could not answer just now. Please try again in a minute.";
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as { message?: unknown };
    return typeof parsed.message === "string" && parsed.message ? parsed.message : fallback;
  } catch {
    return raw.length < 300 ? raw : fallback;
  }
}

function readFlag(key: string, fallback: boolean) {
  try {
    const v = window.localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}
function writeFlag(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function Markdown({ text }: { text: string }) {
  return (
    <div className="text-[15px] leading-relaxed text-pretty [&_a]:font-semibold [&_a]:text-bronze-deep [&_a]:underline [&_code]:rounded [&_code]:bg-white/70 [&_code]:px-1 [&_h1]:mt-3 [&_h1]:text-lg [&_h1]:font-bold [&_h2]:mt-3 [&_h2]:text-base [&_h2]:font-bold [&_h3]:mt-2 [&_h3]:font-bold [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-white/70 [&_pre]:p-3 [&_table]:my-2 [&_table]:w-full [&_table]:text-sm [&_td]:border-t [&_td]:border-line/50 [&_td]:px-2 [&_td]:py-1 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

function Thinking({ text, running }: { text: string; running: boolean }) {
  if (!text.trim()) return null;
  return (
    <details className="group/think my-1 rounded-xl text-sm text-muted">
      <summary className={cx("inline-flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-lg px-1 font-semibold hover:text-ink", focusRing)}>
        <BrainIcon width={16} height={16} />
        {running ? "Thinking…" : "Thought it through"}
        <ChevronIcon width={14} height={14} className="transition-transform group-open/think:rotate-180" />
      </summary>
      <p className="m-0 mt-1 border-l-2 border-line pl-3 whitespace-pre-wrap">{text}</p>
    </details>
  );
}

function Message({ message, running }: { message: UIMessage; running: boolean }) {
  if (message.role === "user") {
    const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
    return (
      <div className="flex flex-col items-end gap-1 py-2" data-testid="user-message">
        <p className="m-0 max-w-[88%] rounded-2xl rounded-br-md bg-ink px-3.5 py-2 text-[15px] whitespace-pre-wrap text-white">{text}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-1 py-2" data-testid="assistant-message">
      <div className="w-full max-w-full min-w-0">
        {message.parts.map((p, i) => {
          if (p.type === "reasoning") return <Thinking key={i} text={p.text} running={running && p.state !== "done"} />;
          if (p.type === "text") return <Markdown key={i} text={p.text} />;
          if (p.type.startsWith("tool-")) {
            const name = p.type.slice(5);
            const state = (p as { state?: string }).state;
            // A drafted note is a card the person checks and sends themselves (as in the Hub); anything else is a chip.
            const output = (p as { output?: unknown }).output;
            if (name === "draftNote" && state === "output-available" && isNoteDraft(output)) {
              return <NoteCard key={i} part={{ toolCallId: (p as { toolCallId?: string }).toolCallId, result: output }} />;
            }
            // The Hub's ToolChip (MessageParts.tsx): running, done or failed, in the Hub's words.
            const running = state !== "output-available" && state !== "output-error";
            const failed = state === "output-error";
            const args = (p as { input?: unknown }).input;
            const label = failed ? `Couldn't finish: ${toolLabel(name, args, true).toLowerCase()}` : toolLabel(name, args, !running);
            return (
              <div key={i} role="status" data-testid="tool-chip" className={cx(chipBase, "my-1 mr-1.5 bg-white/55 text-ink ring-1 ring-white/70", failed && "text-warn-ink ring-warn")}>
                {running ? <span aria-hidden className="size-2 shrink-0 rounded-full bg-gold motion-safe:animate-pulse" /> : failed ? null : <CheckIcon width={14} height={14} className="shrink-0 text-bronze-deep" />}
                <span className="truncate">{label}</span>
              </div>
            );
          }
          return null;
        })}
        {!running && <Citations message={message} />}
      </div>
    </div>
  );
}

function Chat({ meetingKey, scope, deep, onDeepChange }: { meetingKey: string; scope: string; deep: boolean; onDeepChange: (v: boolean) => void }) {
  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/l10/assistant" }), []);
  // The conversation on screen and its history entry, as in the Hub (saved after every answer).
  const [initial] = useState(() => loadConversation(scope));
  const [chatId] = useState(() => currentChatId(scope));
  const { messages, sendMessage, status, stop, error } = useChat({
    transport,
    messages: initial,
    onFinish: ({ messages: all }) => {
      saveConversation(all, scope);
      saveToHistory(chatId, all, scope);
    },
  });
  const [draft, setDraft] = useState("");
  const running = status === "submitted" || status === "streaming";
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    viewport.current?.scrollTo?.({ top: viewport.current.scrollHeight });
  }, [messages]);

  function send(text: string) {
    const t = text.trim();
    if (!t || running) return;
    // Deep think and the meeting go with each message, so a switch applies to the next one.
    void sendMessage({ text: t }, { body: { deep, key: meetingKey } });
    setDraft("");
  }
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    send(draft);
  }
  function onInputKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(draft);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={viewport} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 sm:px-5" aria-label="Conversation">
        {messages.length === 0 ? (
          <div className="flex min-h-full flex-col justify-end gap-4 py-4" data-testid="assistant-empty">
            <div className="flex flex-col gap-2">
              <span aria-hidden className="inline-flex size-11 items-center justify-center rounded-2xl bg-ink text-gold-head">
                <SparkleIcon width={22} height={22} />
              </span>
              <h3 className="m-0 text-xl font-bold tracking-tight text-balance">What are we thinking through?</h3>
              <p className="m-0 max-w-[40ch] text-sm text-pretty text-muted">Ask about this meeting, or bring a messy problem and think out loud.</p>
            </div>
            <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Suggested prompts">
              {L10_SUGGESTIONS.map((p) => (
                <li key={p}>
                  <button type="button" onClick={() => send(p)} className={cx("glass-tile min-h-11 w-full px-3.5 py-2.5 text-left text-sm font-medium text-pretty hover:bg-white/90", focusRing)}>
                    {p}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div aria-live="polite" aria-relevant="additions">
            {messages.map((m, i) => (
              <Message key={m.id} message={m} running={running && i === messages.length - 1} />
            ))}
            {status === "submitted" && (
              <span role="status" aria-label="Assistant is working" className="my-2 inline-flex gap-1">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="size-1.5 rounded-full bg-bronze motion-safe:animate-pulse" style={{ animationDelay: `${i * 150}ms` }} />
                ))}
              </span>
            )}
            {error && (
              <p role="alert" className="glass-tile my-2 px-3.5 py-2 text-sm font-semibold text-[#8a1c1c]">
                {errorText(error.message)}
              </p>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1.5 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4 sm:pb-3">
        <form onSubmit={onSubmit} className="glass-tile flex flex-col gap-1.5 p-2 focus-within:ring-2 focus-within:ring-bronze">
          <textarea
            aria-label="Message the Leadership Assistant"
            name="message"
            autoComplete="off"
            placeholder="Ask anything about this meeting…"
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onInputKey}
            className="max-h-48 min-h-11 w-full resize-none bg-transparent px-2 py-2.5 text-[15px] outline-none placeholder:text-muted"
          />
          <div className="flex items-center justify-between">
            <button
              type="button"
              role="switch"
              aria-checked={deep}
              onClick={() => onDeepChange(!deep)}
              title="Deep think uses the larger model at higher effort: slower and about twice the cost"
              className={cx("mr-auto ml-1 inline-flex min-h-11 items-center gap-2 rounded-xl px-2.5 text-xs font-semibold hover:bg-white/70", focusRing)}
            >
              <span aria-hidden className={cx("relative h-5 w-9 rounded-full transition-colors", deep ? "bg-ink" : "bg-field")}>
                <span className={cx("absolute top-0.5 left-0.5 size-4 rounded-full bg-white transition-transform", deep && "translate-x-4 bg-gold-head")} />
              </span>
              Deep think
            </button>
            {running ? (
              <button type="button" onClick={() => void stop()} aria-label="Stop generating" className={cx("inline-flex size-11 items-center justify-center rounded-xl bg-ink text-gold-head hover:bg-nav-active", focusRing)}>
                <StopIcon />
              </button>
            ) : (
              <button type="submit" disabled={!draft.trim()} aria-label="Send message" className={cx("inline-flex size-11 items-center justify-center rounded-xl bg-ink text-gold-head hover:bg-nav-active disabled:cursor-not-allowed disabled:opacity-40", focusRing)}>
                <SendIcon />
              </button>
            )}
          </div>
        </form>
        <p className="m-0 px-1 text-center text-[11px] text-muted">Can&apos;t change data. Reads this meeting from the Leadership Hub. Check important answers.</p>
      </div>
    </div>
  );
}

/* ── Chat history (the Hub's HistoryList, scoped) ─────────── */

function when(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function HistoryList({ scope, onOpen, onClose }: { scope: string; onOpen: (id: string) => void; onClose: () => void }) {
  const [chats, setChats] = useState<ChatSummary[]>(() => listHistory(scope));
  const current = currentChatId(scope);
  return (
    <section aria-label="Chat history" data-testid="assistant-history" className="absolute inset-0 z-20 flex flex-col bg-cream/95 backdrop-blur-xl">
      <header className="flex items-center gap-2 border-b border-line/40 px-4 py-2">
        <h3 className="m-0 flex-1 text-sm font-bold">Chat history</h3>
        <button type="button" onClick={onClose} className={cx("rounded-lg px-2.5 py-1.5 text-sm font-semibold hover:bg-white/70", focusRing)}>
          Back to chat
        </button>
      </header>
      {chats.length === 0 ? (
        <p className="m-4 text-sm text-muted">No saved chats yet. Each conversation is saved here (in this browser) after the assistant answers.</p>
      ) : (
        <ul className="m-0 min-h-0 flex-1 list-none overflow-y-auto overscroll-contain p-2">
          {chats.map((c) => (
            <li key={c.id} className="flex items-center gap-1 rounded-xl hover:bg-white/70">
              <button type="button" onClick={() => onOpen(c.id)} className={cx("min-w-0 flex-1 rounded-xl px-3 py-2 text-left", focusRing)}>
                <span className="block truncate text-sm font-semibold">{c.title}</span>
                <span className="block text-xs text-muted">
                  {when(c.updatedAt)} · {c.count} messages{c.id === current ? " · on screen" : ""}
                </span>
              </button>
              <button
                type="button"
                aria-label={`Delete chat: ${c.title}`}
                onClick={() => {
                  deleteFromHistory(c.id, scope);
                  setChats(listHistory(scope));
                }}
                className={cx("mr-1 rounded-lg px-2 py-1 text-xs font-semibold text-muted hover:text-ink", focusRing)}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function AssistantPanel({ open, onClose, meetingKey, scope }: { open: boolean; onClose: () => void; meetingKey: string; /** "<Ask Sunny user id>:<meeting key>": whose chats these are. */ scope: string }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(() => readFlag(WIDE_KEY, true));
  const [deep, setDeep] = useState(() => readFlag(DEEP_KEY, false));
  const [status, setStatus] = useState<"checking" | "online" | "offline">("checking");
  const [chatKey, setChatKey] = useState(0);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/l10/assistant", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { configured?: boolean }) => live && setStatus(j.configured ? "online" : "offline"))
      .catch(() => live && setStatus("offline"));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => writeFlag(WIDE_KEY, expanded), [expanded]);
  useEffect(() => writeFlag(DEEP_KEY, deep), [deep]);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => panelRef.current?.querySelector<HTMLElement>("textarea")?.focus(), 30);
    return () => clearTimeout(t);
  }, [open, status]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape" && !e.defaultPrevented) {
      e.stopPropagation();
      if (showHistory) return setShowHistory(false); // Esc leaves History first, then hides the panel
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const items = [...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="assistant-title"
      hidden={!open}
      onKeyDown={onKeyDown}
      data-testid="assistant-panel"
      data-wide={expanded}
      className={cx(
        "glass fixed z-50 flex flex-col overflow-hidden overscroll-contain bg-linear-to-b from-white/42 to-white/30 backdrop-blur-3xl backdrop-saturate-180 [&[hidden]]:hidden",
        "max-sm:inset-0 max-sm:h-dvh max-sm:w-full max-sm:rounded-none",
        expanded
          ? "sm:bottom-5 sm:left-1/2 sm:h-[min(820px,calc(100dvh-2.5rem))] sm:w-[min(960px,calc(100vw-2.5rem))] sm:-translate-x-1/2"
          : "sm:right-(--fab-right) sm:bottom-[calc(var(--assistant-bottom)+var(--assistant-size)+1rem)] sm:h-[min(640px,calc(100dvh-var(--assistant-bottom)-var(--assistant-size)-2.25rem))] sm:w-[420px]",
      )}
    >
      <header className="flex items-center gap-1 border-b border-line/40 py-1.5 pr-1.5 pl-4">
        <span aria-hidden className="mr-1 inline-flex size-8 shrink-0 items-center justify-center rounded-xl bg-ink text-gold-head">
          <SparkleIcon width={16} height={16} />
        </span>
        <h2 id="assistant-title" className="m-0 min-w-0 flex-1 truncate text-[15px] font-bold tracking-tight">
          Leadership Assistant
        </h2>
        {status === "online" && (
          <button type="button" onClick={() => setShowHistory((v) => !v)} aria-label="Chat history" aria-pressed={showHistory} title="Chat history" className={headerButton}>
            <HistoryIcon />
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            // A new chat: the one on screen stays in History (as in the Hub).
            setShowHistory(false);
            startNewChat(scope);
            setChatKey((k) => k + 1);
          }}
          aria-label="New chat"
          title="New chat"
          className={headerButton}
        >
          <PlusIcon />
        </button>
        <button type="button" onClick={() => setExpanded((v) => !v)} aria-label={expanded ? "Shrink panel" : "Expand panel"} aria-pressed={expanded} title={expanded ? "Shrink" : "Expand"} className={cx(headerButton, "max-sm:hidden")}>
          {expanded ? <CollapseIcon /> : <ExpandIcon />}
        </button>
        <button type="button" onClick={onClose} aria-label="Close assistant" title="Close" className={headerButton}>
          <CloseIcon />
        </button>
      </header>
      <div className="relative flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {status === "checking" ? (
            <p role="status" className="m-4 text-sm text-muted">
              Starting up…
            </p>
          ) : status === "offline" ? (
            <p role="status" data-testid="assistant-offline" className="glass-tile m-4 px-3.5 py-3 text-sm text-pretty">
              <strong>Assistant not configured.</strong> This deployment has no Anthropic API key, so the assistant is off. The meeting itself still works.
            </p>
          ) : (
            <Chat key={chatKey} meetingKey={meetingKey} scope={scope} deep={deep} onDeepChange={setDeep} />
          )}
        </div>
        {showHistory && (
          <HistoryList
            scope={scope}
            onClose={() => setShowHistory(false)}
            onOpen={(id) => {
              if (openFromHistory(id, scope)) setChatKey((k) => k + 1); // remount the chat so it loads the chosen conversation
              setShowHistory(false);
            }}
          />
        )}
      </div>
    </div>
  );
}
