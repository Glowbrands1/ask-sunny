/**
 * "primary salon is Omaha Center": where the employee usually works, not the
 * form's salon. One copy, read by `keptSalon` (`ai/keep-filled-slots.ts`) and,
 * with PRIMARY_SALON_NOT_EDIT_ENABLED, by the salon-edit reading
 * (`ai/edit-date-rules.ts`).
 */
export const PRIMARY_SALON_STATEMENT = /\bprimary\s+salon\s+is\s+[^.\n]+/gi;
