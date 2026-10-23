/**
 * Read 1–4 star ratings into replay cases.
 *
 * This script only selects. It does not insert, update, upsert, or delete.
 * Personal data is redacted before anything is printed. A missing env
 * writes nothing.
 *
 *   npm run export:feedback-replay
 *   npm run export:feedback-replay -- --out src/lib/ai/__fixtures__/feedback-replay-cases.json
 */

import { writeFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { buildReplayCases, type FeedbackMessage, type FeedbackRating } from "../src/lib/ai/feedback-replay.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
const key = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";

if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and a secret key are required. Nothing was written.");
  process.exit(1);
}

const outFlag = process.argv.indexOf("--out");
const outPath = outFlag >= 0 ? process.argv[outFlag + 1] : "";

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});

const { data: ratingRows, error: ratingError } = await supabase
  .from("ask_sunny_feedback")
  .select("rating, activity_event_id, comment")
  .gte("rating", 1)
  .lte("rating", 4)
  .limit(200);

if (ratingError) {
  console.error(ratingError.message);
  process.exit(1);
}

const ratings: FeedbackRating[] = (ratingRows ?? []).map((row) => ({
  activityEventId: String(row.activity_event_id),
  rating: Number(row.rating),
  comment: typeof row.comment === "string" ? row.comment : "",
}));

const ids = ratings.map((row) => row.activityEventId).filter((id) => id !== "");
const answers =
  ids.length === 0
    ? []
    : (
        await supabase
          .from("chat_messages")
          .select("conversation_id, position, role, content, turn_id")
          .in("turn_id", ids)
      ).data ?? [];

const conversationIds = [...new Set(answers.map((row) => String(row.conversation_id)))];
const thread =
  conversationIds.length === 0
    ? []
    : (
        await supabase
          .from("chat_messages")
          .select("conversation_id, position, role, content, turn_id")
          .in("conversation_id", conversationIds)
      ).data ?? [];

const messages: FeedbackMessage[] = thread.map((row) => ({
  conversationId: String(row.conversation_id),
  position: Number(row.position),
  role: String(row.role),
  content: typeof row.content === "string" ? row.content : "",
  turnId: row.turn_id ? String(row.turn_id) : null,
}));

const { data: people } = await supabase
  .from("employee_access_directory")
  .select("first_name, last_name, preferred_first_name")
  .limit(5000);

const rosterNames = (people ?? []).flatMap((row) => {
  const last = typeof row.last_name === "string" ? row.last_name.trim() : "";
  const first = typeof row.first_name === "string" ? row.first_name.trim() : "";
  const preferred = typeof row.preferred_first_name === "string" ? row.preferred_first_name.trim() : "";
  return [first && last ? `${first} ${last}` : "", preferred && last ? `${preferred} ${last}` : ""].filter(Boolean);
});

const cases = buildReplayCases({ ratings, messages, rosterNames });
const json = `${JSON.stringify(cases, null, 2)}\n`;
if (outPath) writeFileSync(outPath, json);
else process.stdout.write(json);
