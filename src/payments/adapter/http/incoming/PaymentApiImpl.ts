import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AwilixContainer } from 'awilix';
import type { Cradle } from '../../../../platform/container';
import type { components } from '#generated/payments/adapter/http/incoming/openapi';
import { PaymentMapper } from './PaymentMapper';

type RecordPaymentBody = components['schemas']['RecordPaymentRequest'];

/**
 * Incoming HTTP adapter. fastify-openapi-glue binds these methods to routes by
 * operationId; requests/responses are validated against the OpenAPI schemas.
 */
export function buildPaymentApi(container: AwilixContainer<Cradle>) {
  return {
    async recordPayment(request: FastifyRequest, reply: FastifyReply): Promise<void> {
      const idempotencyKey = String(request.headers['idempotency-key']);
      const command = PaymentMapper.toRecordCommand(request.body as RecordPaymentBody, idempotencyKey);

      const hub = container.resolve('paymentHub');
      const result = await hub.recordPayment(command);

      await reply.code(result.replayed ? 200 : 201).send(PaymentMapper.toPaymentRecorded(result));
    },
  };
}
