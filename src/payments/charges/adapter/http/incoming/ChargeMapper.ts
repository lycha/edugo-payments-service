import type { components, operations } from '#generated/payments/adapter/http/incoming/openapi';
import type { ChargeView, CreateChargeCommand } from '#payments/application/PaymentHub';

type CreateChargeBody = operations['createCharge']['requestBody']['content']['application/json'];
type ChargeDto = components['schemas']['Charge'];
type Currency = components['schemas']['Currency'];

/** Maps between charge transport DTOs (generated from OpenAPI) and domain commands/views. */
export const ChargeMapper = {
  toCreateChargeCommand(body: CreateChargeBody, idempotencyKey: string): CreateChargeCommand {
    return {
      enrollmentId: body.enrollmentId,
      netMinor: BigInt(body.netMinor),
      currency: body.currency,
      idempotencyKey,
    };
  },

  toChargeDto(view: ChargeView): ChargeDto {
    const c = view.record;
    return {
      id: c.id,
      accountId: c.accountId,
      enrollmentId: c.enrollmentId ?? '',
      studentId: c.studentId ?? undefined,
      status: c.status,
      currency: c.currency as Currency,
      tax: {
        netMinor: Number(c.netMinor),
        taxMinor: Number(c.taxMinor),
        grossMinor: Number(c.grossMinor),
        taxRate: Number(c.taxRate),
        taxTreatment: c.taxTreatment,
        taxLegalReason: c.taxLegalReason ?? undefined,
        taxJurisdiction: c.taxJurisdiction,
      },
      amountOwedMinor: Number(view.owedMinor),
      createdAt: c.createdAt.toISOString(),
    };
  },
};
