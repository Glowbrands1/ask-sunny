import * as React from "react";

import { cn } from "@/lib/utils/cn";

/**
 * A deliberately small renderer for the light markdown the assistant produces:
 * paragraphs, `**bold**`, `- bullets`, `1. numbered lists`, and `### headings`.
 *
 * Assistant text is rendered as React elements, never with dangerouslySetInnerHTML.
 * When Claude is connected and can emit richer markdown, swap this for a full
 * markdown renderer — the call site does not change.
 */

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={`${keyPrefix}-b-${index}`} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <React.Fragment key={`${keyPrefix}-t-${index}`}>{part}</React.Fragment>;
  });
}

export function RichText({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const lines = content.split("\n");
  const blocks: React.ReactNode[] = [];

  let bullets: string[] = [];
  let ordered: string[] = [];
  let paragraph: string[] = [];

  const flushParagraph = (key: string) => {
    if (paragraph.length === 0) return;
    const text = paragraph.join(" ");
    paragraph = [];
    blocks.push(
      <p key={key} className="leading-relaxed">
        {renderInline(text, key)}
      </p>,
    );
  };

  const flushBullets = (key: string) => {
    if (bullets.length === 0) return;
    const items = bullets;
    bullets = [];
    blocks.push(
      <ul key={key} className="ml-0.5 space-y-1.5">
        {items.map((item, index) => (
          <li key={`${key}-${index}`} className="flex gap-2.5 leading-relaxed">
            <span
              aria-hidden
              className="mt-[0.55em] size-1 shrink-0 rounded-full bg-primary"
            />
            <span>{renderInline(item, `${key}-${index}`)}</span>
          </li>
        ))}
      </ul>,
    );
  };

  const flushOrdered = (key: string) => {
    if (ordered.length === 0) return;
    const items = ordered;
    ordered = [];
    blocks.push(
      <ol key={key} className="ml-0.5 space-y-1.5">
        {items.map((item, index) => (
          <li key={`${key}-${index}`} className="flex gap-2.5 leading-relaxed">
            <span className="mt-px w-4 shrink-0 text-[13px] font-semibold text-primary tabular-nums">
              {index + 1}.
            </span>
            <span>{renderInline(item, `${key}-${index}`)}</span>
          </li>
        ))}
      </ol>,
    );
  };

  const flushAll = (key: string) => {
    flushParagraph(`${key}-p`);
    flushBullets(`${key}-u`);
    flushOrdered(`${key}-o`);
  };

  lines.forEach((rawLine, index) => {
    const line = rawLine.trimEnd();
    const key = `l${index}`;

    if (line.trim() === "") {
      flushAll(key);
      return;
    }

    const heading = line.match(/^#{2,4}\s+(.*)$/);
    if (heading) {
      flushAll(key);
      blocks.push(
        <h4
          key={`${key}-h`}
          className="pt-1 text-[13px] font-semibold tracking-wide text-foreground"
        >
          {renderInline(heading[1], `${key}-h`)}
        </h4>,
      );
      return;
    }

    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      flushParagraph(`${key}-p`);
      flushOrdered(`${key}-o`);
      bullets.push(bullet[1]);
      return;
    }

    const numbered = line.match(/^\s*\d+\.\s+(.*)$/);
    if (numbered) {
      flushParagraph(`${key}-p`);
      flushBullets(`${key}-u`);
      ordered.push(numbered[1]);
      return;
    }

    flushBullets(`${key}-u`);
    flushOrdered(`${key}-o`);
    paragraph.push(line.trim());
  });

  flushAll("end");

  return (
    <div className={cn("space-y-3 text-sm text-foreground", className)}>{blocks}</div>
  );
}
