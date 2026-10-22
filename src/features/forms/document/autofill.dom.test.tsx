// @vitest-environment jsdom
import * as React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FIELD_RESPONSIBILITIES } from "@/lib/forms/document";
import { TEMPLATE_SEEDS } from "@/lib/forms/library";

import { BlockView } from "./block-view";
import { ResponsiveForm } from "./responsive-form";

afterEach(cleanup);

/*
 * A District Manager's Corrective Action "Other" box arrived filled with text
 * from an earlier form — the browser's own form history, keyed on a field id
 * every form of that template shares. Every typed field on every template, in
 * both renderings of a form, now turns it off. See `autofill.ts`.
 */
function typedFields(container: HTMLElement): (HTMLInputElement | HTMLTextAreaElement)[] {
  return [
    ...container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("textarea, input:not([type=checkbox])"),
  ];
}

describe("browser autofill is off on every typed form field", () => {
  it.each(TEMPLATE_SEEDS.map((seed) => [seed.key, seed] as const))("the form card: %s", (_key, seed) => {
    const { container } = render(
      <ResponsiveForm
        document={seed.document}
        variant={seed.variants[0] ?? null}
        values={{ values: {}, checked: {} }}
        onValue={() => {}}
      />,
    );
    const fields = typedFields(container);
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) expect(field.getAttribute("autocomplete"), field.id || (field.getAttribute("aria-label") ?? undefined)).toBe("off");
  });

  it.each(TEMPLATE_SEEDS.map((seed) => [seed.key, seed] as const))("the paper form: %s", (_key, seed) => {
    const { container } = render(
      <div>
        {seed.document.blocks.map((block, index) => (
          <BlockView
            key={index}
            block={block}
            mode="fill"
            variant={seed.variants[0] ?? null}
            editable={FIELD_RESPONSIBILITIES}
            onValue={() => {}}
          />
        ))}
      </div>,
    );
    for (const field of typedFields(container)) {
      expect(field.getAttribute("autocomplete"), field.id || (field.getAttribute("aria-label") ?? undefined)).toBe("off");
    }
  });

  it("covers the Corrective Action Form's Other box", () => {
    const corrective = TEMPLATE_SEEDS.find((seed) => seed.key === "dpoa")!;
    const { container } = render(
      <ResponsiveForm document={corrective.document} variant={null} values={{ values: {}, checked: {} }} onValue={() => {}} />,
    );
    const other = typedFields(container).filter((field) => /other/i.test(field.id));
    expect(other.length).toBeGreaterThan(0);
    for (const field of other) expect(field.getAttribute("autocomplete")).toBe("off");
  });
});
