import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AwilixContainer } from 'awilix';
import type { Cradle } from '../../../../../platform/container';
import type { components, operations } from '#generated/payments/adapter/http/incoming/openapi';
import type { ChargeStatus } from '#payments/charges/domain/model/ChargeStatus';
import { ChargeMapper } from './ChargeMapper';

type CreateChargeBody = operations['createCharge']['requestBody']['content']['application/json'];
type ListChargesQuery = { limit?: number; cursor?: string; status?: ChargeStatus };

/**
 * Incoming HTTP adapter for the charge use cases. fastify-openapi-glue binds
 * these methods to routes by operationId; requests/responses are validated
 * against the OpenAPI schemas.
 */
export function buildChargeApi(container: AwilixContainer<Cradle>) {
  return {
    async createCharge(request: FastifyRequest, reply: FastifyReply): Promise<void> {
      const idempotencyKey = String(request.headers['idempotency-key']);
      const command = ChargeMapper.toCreateChargeCommand(request.body as CreateChargeBody, idempotencyKey);

      const hub = container.resolve('paymentHub');
      const { view, replayed } = await hub.createCharge(command);

      await reply.code(replayed ? 200 : 201).send(ChargeMapper.toChargeDto(view));
    },

    async getCharge(request: FastifyRequest, reply: FastifyReply): Promise<void> {
      const { chargeId } = request.params as { chargeId: string };

      const hub = container.resolve('paymentHub');
      const view = await hub.getCharge(chargeId);

      await reply.code(200).send(ChargeMapper.toChargeDto(view));
    },

    async listCharges(request: FastifyRequest, reply: FastifyReply): Promise<void> {
      const { accountId } = request.params as { accountId: string };
      const query = request.query as ListChargesQuery;

      const hub = container.resolve('paymentHub');
      const { items, nextCursor } = await hub.listCharges(accountId, {
        limit: query.limit ?? 50,
        cursor: query.cursor,
        status: query.status,
      });

      await reply.code(200).send({ nextCursor, items: items.map((v) => ChargeMapper.toChargeDto(v)) });
    },
  };
}
