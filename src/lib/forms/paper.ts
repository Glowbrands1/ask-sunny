/**
 * THE PAPER, IN ONE PLACE, BECAUSE TWO PLACES DRIFT.
 *
 * A template version renders twice: as the document an administrator edits and
 * a manager fills on screen, and as the PDF that gets signed. Those two have to
 * be the same page. The first version of this feature had the page geometry
 * written into the PDF renderer alone, so the screen was a list of fields and
 * the question "will this fit on the page" had no answer until you downloaded
 * it.
 *
 * Everything below is in POINTS, the unit the PDF is drawn in — US Letter is
 * 612 x 792pt. The screen converts with `pxPerPt`, so a change here moves both
 * the paper and the print together and cannot move only one.
 *
 * These numbers are not arbitrary: they are the measurements taken from the
 * reference forms in Phase 0 — 54pt margins, a 10pt body, section bars 18pt
 * tall with 10.5pt bold centred white type.
 */

export const PAGE = { width: 612, height: 792 } as const;

export const MARGIN = { top: 54, bottom: 60, left: 54, right: 54 } as const;

export const CONTENT_WIDTH = PAGE.width - MARGIN.left - MARGIN.right;

/** Type sizes, in points. */
export const SIZE = {
  body: 10,
  label: 10,
  section: 10.5,
  title: 15,
  small: 8,
  footer: 7.5,
} as const;

/** Baseline-to-baseline distance for wrapped body text, in points. */
export const LEADING = 13;

/** Height of a black section bar, in points. */
export const SECTION_BAR_HEIGHT = 18;

/**
 * Points to CSS pixels at 96dpi.
 *
 * 1pt is 1/72in, a CSS px is 1/96in, so a point is 4/3 of a pixel. A Letter
 * page comes out 816 x 1056px — big enough to read and to click into, and the
 * same shape as the sheet that comes out of the printer.
 */
export const pxPerPt = 4 / 3;

/** A point measurement as CSS pixels, rounded to avoid sub-pixel seams. */
export function px(points: number): number {
  return Math.round(points * pxPerPt * 100) / 100;
}

/** The on-screen page box. */
export const PAGE_PX = { width: px(PAGE.width), height: px(PAGE.height) } as const;

export const MARGIN_PX = {
  top: px(MARGIN.top),
  bottom: px(MARGIN.bottom),
  left: px(MARGIN.left),
  right: px(MARGIN.right),
} as const;
