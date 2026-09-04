"use client";

import * as React from "react";

import { cn } from "@/lib/utils/cn";

/**
 * CLICK THE TEXT, TYPE.
 *
 * The whole correction this component exists for: "Policy Review Form" on the
 * page should be editable by clicking it, not by finding a "title" input in a
 * settings panel somewhere else.
 *
 * WHY `contentEditable` AND NOT AN INPUT. An input has to be sized, and sizing
 * it either breaks the layout (a fixed width where the document wants text to
 * flow) or breaks the illusion (a visible box on a printed form). A
 * contentEditable span occupies exactly the space its text occupies, so the
 * document looks like paper until you click into it.
 *
 * THE HARD PART IS NOT LOSING THE CURSOR. React re-rendering a contentEditable
 * on every keystroke throws the caret to the start, which makes typing
 * impossible. So the DOM text is written ONLY when it differs from what is
 * already there and the element is not focused, and the parent hears about
 * changes on `input` — the element is uncontrolled while you are in it and
 * controlled the moment you leave.
 *
 * `display` exists for interpolation. The stored text is `{{role}} and
 * {{roleAbbr}} will meet`; the reader should see "District Manager and DMIT
 * will meet". So a block passes the RESOLVED text as `display` and the RAW text
 * as `value`, and editing swaps to raw — because saving the resolved text would
 * silently burn one variant's wording into a document meant to read both ways.
 */
export function EditableText({
  value,
  display,
  editable,
  multiline,
  placeholder,
  onChange,
  className,
}: {
  /** The stored text, with `{{role}}` placeholders intact. */
  value: string;
  /** What a reader sees when not editing. Defaults to `value`. */
  display?: string;
  editable?: boolean;
  multiline?: boolean;
  placeholder?: string;
  onChange?: (value: string) => void;
  className?: string;
}) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const [focused, setFocused] = React.useState(false);

  // While focused the caret belongs to the browser, so the raw text is what is
  // in the element; otherwise show the interpolated reading.
  const shown = focused ? value : (display ?? value);

  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (document.activeElement === node) return;
    if (node.textContent === shown) return;
    node.textContent = shown;
  }, [shown]);

  if (!editable) {
    return <span className={className}>{shown === "" ? placeholder : shown}</span>;
  }

  return (
    <span
      ref={ref}
      role="textbox"
      aria-label={placeholder}
      aria-multiline={multiline ? true : undefined}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        setFocused(false);
        onChange?.(event.currentTarget.textContent ?? "");
      }}
      onInput={(event) => onChange?.(event.currentTarget.textContent ?? "")}
      onKeyDown={(event) => {
        // Enter commits rather than inserting a stray <div>. A paragraph that
        // needs two paragraphs is two blocks, which is what the toolbar is for.
        if (event.key === "Enter" && !multiline) {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") event.currentTarget.blur();
      }}
      onPaste={(event) => {
        // Pasting from Word brings markup with it. Only the words are wanted.
        event.preventDefault();
        const plain = event.clipboardData.getData("text/plain").replace(/\s+/g, " ");
        document.execCommand("insertText", false, plain);
      }}
      data-placeholder={placeholder}
      className={cn(
        "-mx-0.5 rounded-[3px] px-0.5 outline-none",
        "hover:bg-black/[0.045] focus:bg-[#fdf0d5] focus:ring-1 focus:ring-[#e8c88a]",
        "empty:before:text-black/30 empty:before:italic empty:before:content-[attr(data-placeholder)]",
        multiline ? "whitespace-pre-wrap" : "whitespace-pre-wrap",
        className,
      )}
    />
  );
}
