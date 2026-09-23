import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import type { FastifyInstance } from 'fastify';
import { startTestDatabase, type TestDatabase } from '../setup/postgres';
import { createDb } from '../../src/platform/db/database';
import { buildContainer } from '../../src/platform/container';
import { buildServer } from '../../src/platform/http/server';
import { buildPayUEvent } from '../setup/payu';
import type { DB } from '#generated/platform/db/schema';

let testDb: TestDatabase;
let db: Kysely<DB>;
let app: FastifyInstance;

beforeAll(async () => {
  testDb = await startTestDatabase();
  db = createDb(testDb.connectionString);
  app = await buildServer(buildContainer(db));
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await db?.destroy();
  await testDb?.container.stop();
});

async function post(raw: string, headers: Record<string, string>) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/operator-events/payu',
    headers: { 'content-type': 'application/json', ...headers },
    payload: raw, // send the exact signed bytes
  });
}

function countRows(operatorEventId: string) {
  return db
    .selectFrom('operator_events')
    .selectAll()
    .where('operator_event_id', '=', operatorEventId)
    .execute();
}

describe('receiveOperatorEvent (fs5i)', () => {
  it('a validly-signed event → 202, one PENDING row, and no ledger write', async () => {
    const evt = buildPayUEvent({ extOrderId: randomUUID(), amountMinor: 15_000n });
    const res = await post(evt.raw, { 'x-signature': evt.signature });

    expect(res.statusCode).toBe(202);
    const rows = await countRows(evt.operatorEventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('PENDING');
    expect(rows[0]?.signature_verified).toBe(true);
    expect(rows[0]?.payment_id).toBeNull();

    const ledger = await db.selectFrom('ledger_entries').select('id').execute();
    expect(ledger).toHaveLength(0); // ingest never writes to the ledger
  });

  it('an invalid signature → 401 and nothing inserted (AC-14)', async () => {
    const evt = buildPayUEvent({ extOrderId: randomUUID(), amountMinor: 15_000n });
    const res = await post(evt.raw, { 'x-signature': 'not-a-valid-signature' });

    expect(res.statusCode).toBe(401);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(await countRows(evt.operatorEventId)).toHaveLength(0);
  });

  it('a redelivered event → 202 then 200, exactly one row (INV-2 dedup)', async () => {
    const evt = buildPayUEvent({ extOrderId: randomUUID(), amountMinor: 15_000n });

    const first = await post(evt.raw, { 'x-signature': evt.signature });
    const second = await post(evt.raw, { 'x-signature': evt.signature });

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(200); // duplicate no-op
    expect(await countRows(evt.operatorEventId)).toHaveLength(1);
  });

  it('an unknown operator → 400', async () => {
    const evt = buildPayUEvent({ extOrderId: randomUUID(), amountMinor: 15_000n });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/operator-events/unknownop',
      headers: { 'content-type': 'application/json', 'x-signature': evt.signature },
      payload: evt.raw,
    });
    expect(res.statusCode).toBe(400);
  });
});
