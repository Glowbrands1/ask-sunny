/**
 * An item's error category as one plain sentence for the admin screen. Never
 * a stack trace, a route or a code; the code itself stays under Advanced.
 */
const REASONS: [RegExp, string][] = [
  [/no_text$/, "No text could be read from this file — it looks like a scanned image. A searchable PDF (or a text version) in Woven would fix it."],
  [/not_a_file$/, "Woven sent back a page instead of the file."],
  [/not_found$/, "Woven no longer has the file for this item."],
  [/forbidden$/, "The Woven integration account is not allowed to download this file."],
  [/too_large$/, "The file is larger than Ask Sunny's upload limit."],
  [/unsupported(_format|_type)?$/, "Ask Sunny can't read this type of file."],
  [/empty_file$/, "The file Woven sent is empty."],
  [/embedding_failed$/, "Ask Sunny's indexing service failed on it this time."],
  [/(download_link_expired|download_failed|session_lost|session_expired|timeout|rate_limited)$/, "The download from Woven did not complete."],
  [/unexpected_shape$/, "The Woven page for it no longer has the layout Ask Sunny reads."],
];

export function plainErrorReason(category: string | null | undefined): string {
  const code = category ?? "";
  return REASONS.find(([pattern]) => pattern.test(code))?.[1] ?? "It could not be synced this time.";
}
