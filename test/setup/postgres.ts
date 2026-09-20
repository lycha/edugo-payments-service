import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import migrate from 'node-pg-migrate';

export interface TestDatabase {
  container: StartedPostgreSqlContainer;
  connectionString: string;
}

/** Starts a throwaway Postgres and applies the SQL migrations against it. */
export async function startTestDatabase(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const connectionString = container.getConnectionUri();

  await migrate({
    databaseUrl: connectionString,
    dir: 'db/migrations',
    direction: 'up',
    count: Infinity,
    migrationsTable: 'pgmigrations',
    log: () => {},
  });

  return { container, connectionString };
}
