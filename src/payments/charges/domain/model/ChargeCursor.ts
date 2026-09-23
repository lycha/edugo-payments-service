/**
 * Opaque keyset cursor over `(created_at, id)` for paginating an account's
 * charges oldest-first. Pure (base64url of the two fields) — no DB/framework
 * dependency — so both the domain (encode) and the storage adapter (decode) can
 * use it without crossing the hexagonal boundary.
 */
export function encodeChargeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, 'utf8').toString('base64url');
}

export function decodeChargeCursor(cursor: string): { createdAt: Date; id: string } {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  return { createdAt: new Date(iso ?? ''), id: id ?? '' };
}
