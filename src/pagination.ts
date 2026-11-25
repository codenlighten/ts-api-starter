import { HttpError } from "./http/errors.js";

// Keyset pagination over a per-table identity column (`seq`, newest first).
// The cursor is opaque to clients: base64url of the last seq on the page.
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export function encodeCursor(seq: string): string {
  return Buffer.from(seq, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | undefined): string | null {
  if (cursor === undefined) return null;
  const seq = Buffer.from(cursor, "base64url").toString("utf8");
  if (!/^[1-9]\d{0,17}$/.test(seq) || encodeCursor(seq) !== cursor) {
    throw new HttpError(400, "invalid_cursor", "The cursor is not valid. Use the nextCursor value from a previous response unchanged.");
  }
  return seq;
}

// Repositories fetch limit + 1 rows; the extra row only proves there is a next page.
export function toPage<R extends { seq: string }, T>(rows: R[], limit: number, map: (row: R) => T): Page<T> {
  const hasMore = rows.length > limit;
  const kept = hasMore ? rows.slice(0, limit) : rows;
  const last = kept[kept.length - 1];
  return { items: kept.map(map), nextCursor: hasMore && last ? encodeCursor(last.seq) : null };
}
