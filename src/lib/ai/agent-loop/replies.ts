/**
 * The loop's own fixed replies, in a module with no imports, so replay cases can read them without loading the loop
 * (`form-patch-flags-off.test.ts`: chat's route is the one source that names the loop's run module).
 */
export const STEP_LIMIT_REPLY = "I couldn't finish that in the steps I have for one message. Could you tell me the one thing you want done first?";
export const LOOP_FAILED_REPLY = "Sunny could not finish that answer. Nothing was saved. Please send it again in a moment.";
