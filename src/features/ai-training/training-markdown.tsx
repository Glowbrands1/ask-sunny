"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  extractPromptQuotes,
  parseTrainingMarkdown,
  plainText,
  practiceBlockIds,
  rewriteTrainingHref,
  type MdBlock,
  type RichText,
} from "@/lib/ai-training/markdown";

/**
 * RENDERS AN AI TRAINING LESSON OR PAGE — the old app's Notion renderer, on
 * this app's tokens. With `promptCopies`, code blocks and quoted prompts inside
 * a Practice section get a Copy button, as they did there.
 */
export function TrainingMarkdown({ md, promptCopies = false }: { md: string; promptCopies?: boolean }) {
  const blocks = useMemo(() => parseTrainingMarkdown(md), [md]);
  const practice = useMemo(() => (promptCopies ? practiceBlockIds(blocks) : new Set<string>()), [blocks, promptCopies]);
  return (
    <div className="training-prose">
      <Blocks blocks={blocks} promptCopies={promptCopies} practice={practice} />
    </div>
  );
}

type Grouped = MdBlock | { type: "_list"; kind: "ul" | "ol"; id: string; items: MdBlock[] };

function groupLists(blocks: MdBlock[]): Grouped[] {
  const out: Grouped[] = [];
  let current: Extract<Grouped, { type: "_list" }> | null = null;
  for (const block of blocks) {
    const kind = block.type === "bulleted_list_item" ? "ul" : block.type === "numbered_list_item" ? "ol" : null;
    if (kind) {
      if (!current || current.kind !== kind) {
        current = { type: "_list", kind, id: `list-${block.id}`, items: [] };
        out.push(current);
      }
      current.items.push(block);
    } else {
      current = null;
      out.push(block);
    }
  }
  return out;
}

function Blocks({ blocks, promptCopies, practice }: { blocks: MdBlock[]; promptCopies: boolean; practice: Set<string> }) {
  return (
    <>
      {groupLists(blocks).map((g) => {
        if (g.type === "_list") {
          const Tag = g.kind;
          return (
            <Tag key={g.id}>
              {g.items.map((item) => (
                <li key={item.id}>
                  <Rich runs={item.text} copyQuotes={practice.has(item.id)} />
                  {item.children ? <Blocks blocks={item.children} promptCopies={promptCopies} practice={practice} /> : null}
                </li>
              ))}
            </Tag>
          );
        }
        return <Block key={g.id} block={g} promptCopies={promptCopies} practice={practice} />;
      })}
    </>
  );
}

const CALLOUT_CLASS: Record<string, string> = {
  gray_bg: "training-callout-gray",
  default: "training-callout-gray",
  brown_bg: "training-callout-brown",
  orange_bg: "training-callout-orange",
  yellow_bg: "training-callout-yellow",
  green_bg: "training-callout-green",
  blue_bg: "training-callout-blue",
  purple_bg: "training-callout-purple",
  pink_bg: "training-callout-pink",
  red_bg: "training-callout-red",
};

function Block({ block, promptCopies, practice }: { block: MdBlock; promptCopies: boolean; practice: Set<string> }) {
  const copyQuotes = practice.has(block.id);
  const children = block.children ? <Blocks blocks={block.children} promptCopies={promptCopies} practice={practice} /> : null;
  switch (block.type) {
    case "paragraph":
      return <p><Rich runs={block.text} copyQuotes={copyQuotes} /></p>;
    case "heading_1":
      return <h2 className="training-h1"><Rich runs={block.text} /></h2>;
    case "heading_2":
      return <h3 className="training-h2"><Rich runs={block.text} /></h3>;
    case "heading_3":
      return <h4 className="training-h3"><Rich runs={block.text} /></h4>;
    case "divider":
      return <hr />;
    case "quote":
      return <blockquote><Rich runs={block.text} copyQuotes={copyQuotes} /></blockquote>;
    case "callout": {
      if (!block.children?.length) return null;
      const color = (block.color ?? "default").replace(/_background$/, "_bg");
      return (
        <aside className={`training-callout ${CALLOUT_CLASS[color] ?? "training-callout-gray"}`}>
          {block.icon ? <span className="shrink-0 text-xl leading-7" aria-hidden>{block.icon}</span> : null}
          <div className="min-w-0 flex-1">{children}</div>
        </aside>
      );
    }
    case "table":
      return (
        <div className="my-5 overflow-x-auto">
          <table>
            <tbody>
              {(block.rows ?? []).map((row, r) => {
                const head = r === 0 && block.header;
                const Cell = head ? "th" : "td";
                return (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <Cell key={c}><Rich runs={cell} copyQuotes={copyQuotes} /></Cell>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
    case "code":
      if (promptCopies) {
        return (
          <div className="my-4 min-w-0 overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface-muted">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-1.5">
              <span className="text-xs font-medium text-muted-foreground">Prompt</span>
              <CopyButton text={block.code ?? ""} />
            </div>
            <pre className="m-0 whitespace-pre-wrap break-words p-4 font-mono text-sm [overflow-wrap:anywhere]">
              <code>{block.code}</code>
            </pre>
          </div>
        );
      }
      return (
        <pre className="my-4 overflow-x-auto rounded-[var(--radius-md)] bg-surface-muted p-4 text-sm">
          <code>{block.code}</code>
        </pre>
      );
    case "image":
      if (!block.url || !/^https?:\/\//i.test(block.url)) return null;
      return (
        <figure className="my-6">
          {/* eslint-disable-next-line @next/next/no-img-element -- lesson images are external, sized by the author */}
          <img src={block.url} alt={plainText(block.caption)} className="rounded-[var(--radius-md)]" />
          {block.caption?.length ? (
            <figcaption className="mt-2 text-sm text-muted-foreground"><Rich runs={block.caption} /></figcaption>
          ) : null}
        </figure>
      );
    case "toggle":
      return (
        <details className="my-2 rounded-[var(--radius-md)] border border-border bg-surface p-3">
          <summary className="cursor-pointer font-medium"><Rich runs={block.text} copyQuotes={copyQuotes} /></summary>
          {children ? <div className="mt-2">{children}</div> : null}
        </details>
      );
    case "to_do":
      return (
        <div className="my-1 flex items-start gap-2">
          <input type="checkbox" defaultChecked={block.checked} disabled className="mt-1.5" aria-label={block.checked ? "Done" : "Not done"} />
          <div className="min-w-0 flex-1">
            <Rich runs={block.text} copyQuotes={copyQuotes} />
            {children}
          </div>
        </div>
      );
    default:
      return block.text ? <p><Rich runs={block.text} /></p> : null;
  }
}

/** Only http(s), mailto and in-app links are rendered as links. */
function safeHref(href: string): string | null {
  const rewritten = rewriteTrainingHref(href);
  if (/^(https?:|mailto:)/i.test(rewritten) || rewritten.startsWith("/") || rewritten.startsWith("#")) return rewritten;
  return null;
}

function Pieces({ runs }: { runs: RichText[] }) {
  return (
    <>
      {runs.map((run, i) => {
        let node: ReactNode = run.code
          ? run.text
          : run.text.split("\n").map((part, j) => (
              <Fragment key={j}>
                {j ? <br /> : null}
                {part}
              </Fragment>
            ));
        if (run.code) node = <code>{node}</code>;
        if (run.bold) node = <strong>{node}</strong>;
        if (run.italic) node = <em>{node}</em>;
        if (run.underline) node = <u>{node}</u>;
        if (run.strikethrough) node = <s>{node}</s>;
        const href = run.href ? safeHref(run.href) : null;
        if (href) {
          const external = /^https?:/i.test(href);
          node = (
            <a href={href} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
              {node}
            </a>
          );
        }
        return <Fragment key={i}>{node}</Fragment>;
      })}
    </>
  );
}

function Rich({ runs, copyQuotes = false }: { runs: RichText[] | undefined; copyQuotes?: boolean }) {
  if (!runs) return null;
  const quotes = extractPromptQuotes(runs, copyQuotes);
  if (!quotes.length) return <Pieces runs={runs} />;
  const total = runs.reduce((n, run) => n + run.text.length, 0);
  const ends = [...quotes.map((q) => q.end), total];
  let start = 0;
  return (
    <>
      {ends.map((end, index) => {
        let offset = 0;
        const slice = runs.flatMap((run) => {
          const left = Math.max(0, start - offset);
          const right = Math.min(run.text.length, end - offset);
          offset += run.text.length;
          return right > left ? [{ ...run, text: run.text.slice(left, right) }] : [];
        });
        start = end;
        const quote = quotes[index];
        return (
          <span key={index}>
            <Pieces runs={slice} />
            {quote ? <CopyButton text={quote.text} inline /> : null}
          </span>
        );
      })}
    </>
  );
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.readOnly = true;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  try {
    area.select();
    if (!document.execCommand("copy")) throw new Error("Copy unavailable");
  } finally {
    area.remove();
  }
}

function CopyButton({ text, inline = false }: { text: string; inline?: boolean }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    clearTimeout(timer.current);
    try {
      await copyText(text);
      setState("copied");
      timer.current = setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("error");
    }
  }
  return (
    <span className={inline ? "ml-1.5 inline-flex align-middle" : "inline-flex"}>
      <Button type="button" variant="secondary" size="sm" onClick={copy} aria-label={state === "copied" ? "Copied prompt" : "Copy prompt"}>
        {state === "copied" ? <Check aria-hidden /> : <Copy aria-hidden />}
        {state === "copied" ? "Copied" : "Copy"}
      </Button>
      <span className="sr-only" role="status" aria-live="polite">
        {state === "copied" ? "Prompt copied to clipboard." : state === "error" ? "Copy unavailable. Select the prompt and copy it." : ""}
      </span>
    </span>
  );
}
