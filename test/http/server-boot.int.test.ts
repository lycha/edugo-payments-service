import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/platform/http/server';
import { buildContainer } from '../../src/platform/container';
import type { DB } from '#generated/platform/db/schema';

// Guards the full OpenAPI contract at the HTTP boundary. The domain tests resolve
// the use-case straight from the container and never boot Fastify, so they cannot
// catch a spec that fails to register (e.g. an ajv-incompatible schema keyword) or
// a broken handler-stub wiring. No DB is needed: health and the 501 stubs never
// resolve a DB-backed service.
describe('HTTP server boot (full contract)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer(buildContainer({} as unknown as Kysely<DB>));
    await app.ready(); // registers every route in openapi/openapi.yaml
  });

  afterAll(async () => {
    await app?.close();
  });

  it('serves the implemented health route', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('returns 501 problem+json for a contract operation with no handler yet', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${randomUUID()}/balance`,
    });
    expect(res.statusCode).toBe(501);
    expect(res.headers['content-type']).toContain('application/problem+json');
    const body = res.json();
    expect(body.status).toBe(501);
    expect(body.title).toBe('Not Implemented');
  });
});
