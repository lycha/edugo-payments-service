import { loadEnv } from './platform/config/env';
import { startTelemetry, stopTelemetry } from './platform/observability/telemetry';
import { createDb } from './platform/db/database';
import { buildContainer } from './platform/container';
import { buildServer } from './platform/http/server';

async function main(): Promise<void> {
  const env = loadEnv();
  startTelemetry({ serviceName: env.SERVICE_NAME, endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT });

  const db = createDb(env.DATABASE_URL);
  const container = buildContainer(db, { operatorWebhookSecret: env.OPERATOR_WEBHOOK_SECRET });
  const app = await buildServer(container);

  const shutdown = async (): Promise<void> => {
    await app.close();
    await db.destroy();
    await stopTelemetry();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
