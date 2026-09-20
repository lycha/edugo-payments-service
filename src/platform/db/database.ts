import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { DB } from '#generated/platform/db/schema';

export function createDb(connectionString: string): Kysely<DB> {
  const pool = new pg.Pool({ connectionString });
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}
