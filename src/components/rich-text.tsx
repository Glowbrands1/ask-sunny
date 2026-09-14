import * as React from "react";

import { cn } from "@/lib/utils/cn";

/**
 * A deliberately small renderer for the markdown the assistant produces:
 * paragraphs, `**bold**`, `- bullets`, `1. numbered lists`, `### headings` and
 * GitHub-style pipe tables.
 *
 * ASSISTANT TEXT IS RENDERED AS REACT ELEMENTS, never with
 * `dangerouslySetInnerHTML`. That is the security property of this module and
 * the reason it is hand-written rather than delegated: every branch below
 * produces an element whose children are strings React escapes, so there is no
 * path by which a model — or anything that reached a model's output — can emit
 * markup. Adding table support did not add an HTML path, and must not.
 *
 * ============================================================================
 * WHY TABLES
 * ============================================================================
 *
 * The 14 September review, from the restricted session: "Markdown tables are
 * rendering as raw text. The salon list appeared with literal pipes —
 * `| Salon | PPTA | |---|---|` — instead of displaying as a formatted table."
 *
 * The model was already emitting them, correctly, because a ranked list of
 * salons with two figures each IS a table and asking it not to produce one
 * would make the answer worse. The gap was here: a pipe row matched none of the
 * block rules and fell through to `paragraph.push`, which renders the source
 * text. So the renderer learned the one construct it was missing.
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

/**
 * A GitHub-style delimiter row: `|---|:--:|---:|`.
 *
 * The delimiter is what distinguishes a table from a sentence containing pipes,
 * which is why it is required rather than inferred. "Revenue | PPTA | Tans"
 * typed in prose has no delimiter row under it and stays prose.
 */
const TABLE_DELIMITER = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

/** Whether a line could be a table row at all. */
function looksLikeRow(line: string): boolean {
  return line.includes("|");
}

/** Splits a pipe row into cells, tolerating the optional leading/trailing pipe. */
function splitRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);
  /*
   * `\|` IS AN ESCAPED PIPE INSIDE A CELL, not a separator — it is how a cell
   * containing a pipe is written, and splitting on it would silently shift
   * every later column by one.
   */
  return text
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, "|").trim());
}

/** Column alignment, from the delimiter row's colons. */
type ColumnAlign = "left" | "center" | "right";

function alignmentsOf(delimiter: string): ColumnAlign[] {
  return splitRow(delimiter).map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    return "left";
  });
}

const ALIGN_CLASS: Record<ColumnAlign, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

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

    /*
      ========================================================================
      THE MANAGER-READY NEXT STEP IS A CALLOUT, NOT A BOLD RUN
      ========================================================================

      The Marquee Chat artifact draws it as its own object: a yellow-tinted
      panel with a 4px yellow left edge and the label as a micro-caps eyebrow
      above the sentence. In the artifact's answered plate it is the one thing
      picked out of six paragraphs of policy prose.

      It earns that treatment because of what it IS rather than how it reads:
      every other paragraph in an answer describes what the policy says, and
      this one is the only thing the manager is being asked to DO. Left as
      `**Your manager-ready next step:**` it was the fourth bold run in the
      answer and scanned like the other three.

      MATCHED ON THE LABEL THE FRAMEWORK ALREADY EMITS, so nothing about the
      answers changed — this is a rendering rule over existing content. A
      paragraph that does not open with such a label is untouched, and the
      label is rendered from the text rather than substituted, so a reworded
      one still reads correctly rather than silently losing its heading.

      IN THE SHARED RENDERER ON PURPOSE. Chat, the Sales Totals panel and the
      Overview answer sheet all render answers from the same framework, and the
      next step means the same thing in all three.
    */
    const callout = /^\*\*([^*]*next step[^*]*?):?\*\*\s*:?\s*([\s\S]+)$/i.exec(text);
    if (callout) {
      const [, label, body] = callout;
      blocks.push(
        <div
          key={key}
          className="rounded-[var(--radius-sm)] border-l-4 border-brand-yellow bg-brand-yellow-soft px-3.5 py-2.5"
        >
          <p className="eyebrow mb-1 text-brand-yellow-soft-foreground">{label}</p>
          {/*
            THE BODY IS A SENTENCE NOW, so it starts like one. In the source
            text it is a clause following a colon — "next step: if you are
            seeing a pattern" — and once the label is lifted out into a heading
            the lowercase "if" reads as a truncation. Only the first character
            is touched, and only when it is a lowercase letter, so a body that
            opens with a name, a figure or already-correct capitalisation is
            left exactly as written.
          */}
          <p className="leading-relaxed text-foreground">
            {renderInline(
              /^[a-z]/.test(body) ? body[0].toUpperCase() + body.slice(1) : body,
              `${key}-next`,
            )}
          </p>
        </div>,
      );
      return;
    }

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

  /**
   * Renders a table and returns how many lines it consumed.
   *
   * SCROLLS RATHER THAN SQUEEZES. A salon list is fifteen rows of three or four
   * columns and the chat column is narrow; wrapping every cell turns a ranking
   * into a wall. The overflow is on the table's own wrapper, so the answer
   * around it never scrolls sideways.
   */
  const renderTable = (start: number, key: string): number => {
    const header = lines[start];
    const delimiter = lines[start + 1];
    const aligns = alignmentsOf(delimiter);
    const headerCells = splitRow(header);

    const bodyRows: string[][] = [];
    let cursor = start + 2;
    while (cursor < lines.length && looksLikeRow(lines[cursor]) && lines[cursor].trim() !== "") {
      bodyRows.push(splitRow(lines[cursor]));
      cursor += 1;
    }

    const alignOf = (column: number): ColumnAlign => aligns[column] ?? "left";

    blocks.push(
      <div key={key} className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border">
              {headerCells.map((cell, column) => (
                <th
                  key={`${key}-h-${column}`}
                  scope="col"
                  className={cn(
                    "px-2.5 py-1.5 font-semibold whitespace-nowrap text-foreground",
                    ALIGN_CLASS[alignOf(column)],
                  )}
                >
                  {renderInline(cell, `${key}-h-${column}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bodyRows.map((row, rowIndex) => (
              <tr key={`${key}-r-${rowIndex}`} className="border-b border-border-row last:border-0">
                {/*
                  PADDED TO THE HEADER'S WIDTH. A model that drops a trailing
                  empty cell produces a short row, and a short row shifts every
                  cell after it into the wrong column — which on a table of
                  salons and figures is a wrong number under a salon's name
                  rather than a cosmetic fault.
                */}
                {headerCells.map((_, column) => (
                  <td
                    key={`${key}-r-${rowIndex}-${column}`}
                    className={cn(
                      "px-2.5 py-1.5 text-foreground",
                      ALIGN_CLASS[alignOf(column)],
                      alignOf(column) === "right" && "tabular-nums",
                    )}
                  >
                    {renderInline(row[column] ?? "", `${key}-r-${rowIndex}-${column}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    );

    return cursor - start;
  };

  /* Lines a table has already consumed, so the loop does not render them twice. */
  let skipUntil = -1;

  lines.forEach((rawLine, index) => {
    if (index <= skipUntil) return;

    const line = rawLine.trimEnd();
    const key = `l${index}`;

    if (line.trim() === "") {
      flushAll(key);
      return;
    }

    /*
     * A TABLE IS A HEADER ROW WITH A DELIMITER ROW UNDER IT, and nothing else
     * counts. Requiring the delimiter is what keeps a sentence containing a
     * pipe — or a single stray `|` in a figure — from being promoted into a
     * one-column table.
     */
    if (
      looksLikeRow(line) &&
      index + 1 < lines.length &&
      TABLE_DELIMITER.test(lines[index + 1]) &&
      looksLikeRow(lines[index + 1])
    ) {
      flushAll(key);
      skipUntil = index + renderTable(index, `${key}-t`) - 1;
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
