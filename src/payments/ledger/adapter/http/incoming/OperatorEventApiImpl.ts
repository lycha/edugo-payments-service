import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AwilixContainer } from 'awilix';
import type { Cradle } from '../../../../../platform/container';
import type { components } from '#generated/payments/adapter/http/incoming/openapi';

type OperatorEventBody = components['schemas']['OperatorEvent'];

function problem(status: number, title: string, detail: string) {
  return { type: 'about:blank', title, status, detail };
}

/**
 * Incoming HTTP adapter for the operator webhook (fs5i). Verifies the HMAC via the
 * selected operator adapter, durably enqueues the raw event in `operator_events`
 * (deduped), and ACKs fast — no business logic, no ledger write in the request
 * (ADR-0003 §2). The relay applies the event later. Public route (HMAC, not bearer).
 */
export function buildOperatorEventApi(container: AwilixContainer<Cradle>) {
  return {
    async receiveOperatorEvent(request: FastifyRequest, reply: FastifyReply): Promise<void> {
      const operatorName = String((request.params as { operator: string }).operator);
      const operators = container.resolve('paymentOperators');
      const operator = operators.get(operatorName);
      if (!operator) {
        await reply
          .code(400)
          .type('application/problem+json')
          .send(problem(400, 'Unknown operator', `No adapter registered for operator: ${operatorName}`));
        return;
      }

      // HMAC over the RAW body (captured by the JSON content-type parser in server.ts).
      // Verify before trusting any field; an invalid signature is rejected with no
      // ledger effect and no inbox row (AC-14).
      const rawBody = (request as { rawBody?: string }).rawBody ?? '';
      const signatureHeader = request.headers['x-signature'];
      const signature = typeof signatureHeader === 'string' ? signatureHeader : undefined;
      if (!operator.verifySignature(rawBody, signature)) {
        await reply
          .code(401)
          .type('application/problem+json')
          .send(problem(401, 'Unauthorized', 'HMAC signature verification failed'));
        return;
      }

      const body = request.body as OperatorEventBody;
      const uow = container.resolve('unitOfWork');
      const result = await uow.withTransaction((repos) =>
        repos.operatorEvents.insertReceived({
          operator: operatorName,
          operatorEventId: body.operatorEventId,
          eventType: body.type,
          // The operator-specific object; interpreted later by the operator adapter.
          payload: body.payload ?? null,
          signatureVerified: true,
        }),
      );

      // 202 accepted+enqueued (new) / 200 duplicate no-op (INV-2). Contract-defined.
      await reply.code(result.duplicate ? 200 : 202).send();
    },
  };
}
