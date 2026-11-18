import { z } from "zod";

/**
 * The app checks every tool result it receives, the same way the website
 * checks API responses: a server/app version mismatch then shows a clear
 * error instead of a broken calendar.
 */

export const DatePrecision = z.enum(["year", "month", "day"]);
export type DatePrecision = z.infer<typeof DatePrecision>;

export const Release = z.object({
  id: z.number().int(),
  title: z.string(),
  authors: z.array(z.string()),
  releaseDate: z.iso.date(),
  datePrecision: DatePrecision,
  categories: z.array(z.string()),
  thumbnailUrl: z.string().nullable(),
});
export type Release = z.infer<typeof Release>;

export const Calendar = z.object({
  status: z.literal("ok"),
  from: z.iso.date(),
  to: z.iso.date(),
  filters: z.object({ author: z.string().nullable(), category: z.string().nullable() }),
  releases: z.array(Release),
});
export type Calendar = z.infer<typeof Calendar>;

const ConfirmationRequired = z.object({
  status: z.literal("confirmation_required"),
  question: z.string(),
  confirmationToken: z.string(),
  expiresAt: z.string(),
});
const Added = z.object({
  status: z.literal("added"),
  item: z.object({ author: z.string(), upcomingCount: z.number().int() }),
});
export const FollowResult = z.discriminatedUnion("status", [ConfirmationRequired, Added]);
export type FollowResult = z.infer<typeof FollowResult>;

/** The subset of an MCP CallToolResult the app reads. */
export interface ToolResultLike {
  isError?: boolean | undefined;
  content?: unknown;
  structuredContent?: unknown;
}

/** First text block of a result, for showing a tool's own error message. */
export function resultText(r: ToolResultLike): string {
  const blocks = Array.isArray(r.content) ? (r.content as { type?: string; text?: string }[]) : [];
  return blocks.find((b) => b.type === "text" && typeof b.text === "string")?.text ?? "";
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

export function parseResult<T>(schema: z.ZodType<T>, r: ToolResultLike): Parsed<T> {
  if (r.isError) return { ok: false, message: resultText(r) || "The server reported an error." };
  const parsed = schema.safeParse(r.structuredContent);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, message: "The server sent a reply this app doesn't understand. Try updating the app." };
}
