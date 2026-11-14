/**
 * A place in the salon where someone works ("front desk", "the back room", "bed 4", "bed #4"): never a job title
 * (WORK_AREA_NOT_A_TITLE, `ai/intent-slots.ts`), and a place phrase the Observation may lead with
 * (OBSERVATION_NO_LEADING_NAME, `ai/remap-incident.ts`). QA's Sunny 38d live check, 13 Nov 2026.
 */
export const WORK_AREA =
  /^(?:the\s+)?(?:front\s+desk|desk|back\s+room|break\s*room|stock\s*room|storage\s+room|register|cash\s+register|lobby|counter|front|floor|sales\s+floor|(?:bed|room|booth)\s*#?\s*\d+|tanning\s+room|spa\s+room|laundry(?:\s+room)?|restroom|bathroom)$/i;
