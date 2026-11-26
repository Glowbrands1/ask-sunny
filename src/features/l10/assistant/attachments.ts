/*
 * The DM L10 panel's attachments: the Leadership Hub's mechanism (src/components/assistant/attachments.ts in the Hub),
 * kept in step with it. The code lives in `lib/attachments/file-parts.ts` so the main chat reads files with the same
 * mechanism without importing the L10 assistant (`form-patch-flags-off.test.ts`: chat never reaches the panel's code).
 */
export * from "@/lib/attachments/file-parts";
