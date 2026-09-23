import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  SERVICE_NAME: z.string().default('edugo-payments-service'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  // HMAC secret for verifying operator webhooks (ADR-0006 — Secret Manager later,
  // ASM-1). Never hardcoded; a dev/test default keeps local boot friction-free.
  OPERATOR_WEBHOOK_SECRET: z.string().min(1).default('dev-operator-webhook-secret'),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return EnvSchema.parse(source);
}
