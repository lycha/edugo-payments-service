import type { components } from '#generated/payments/adapter/http/incoming/openapi';
import type { RecordPaymentCommand, RecordPaymentResult } from '#payments/application/PaymentHub';

type RecordPaymentBody = components['schemas']['RecordPaymentRequest'];
type PaymentRecordedDto = components['schemas']['PaymentRecorded'];

/** Maps between payment transport DTOs (generated from OpenAPI) and domain commands/results. */
export const PaymentMapper = {
  toRecordCommand(body: RecordPaymentBody, idempotencyKey: string): RecordPaymentCommand {
    return {
      accountId: body.accountId,
      amountMinor: BigInt(body.amountMinor),
      currency: body.currency,
      operatorReference: body.operatorReference ?? null,
      idempotencyKey,
    };
  },

  toPaymentRecorded(result: RecordPaymentResult): PaymentRecordedDto {
    return {
      paymentId: result.paymentId,
      accountId: result.accountId,
      // Safe within JS integer range for realistic balances; string-encode if
      // ever exceeding 2^53 minor units.
      balanceMinor: Number(result.balanceMinor),
      currency: result.currency,
      replayed: result.replayed,
    };
  },
};
