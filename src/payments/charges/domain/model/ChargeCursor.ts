/**
 * Opaque keyset cursor over `(created_at, id)` for paginating an account's
 * charges oldest-first. Pure (base64url of the two fields) — no DB/framework
 * dependency — so both the domain (encode) and the storage adapter (decode) can
 * use it without crossing the hexagonal boundary.
 */
import { InvalidCursorError } from '#payments/ledger/domain/Errors';

export function encodeChargeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, 'utf8').toString('base64url');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function decodeChargeCursor(cursor: string): { createdAt: Date; id: string } {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const createdAt = new Date(iso ?? '');
  // A malformed cursor is a bad request, not a server error.
  if (Number.isNaN(createdAt.getTime()) || !id || !UUID_RE.test(id)) {
    throw new InvalidCursorError();
  }
  return { createdAt, id };
}
