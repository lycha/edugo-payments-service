// codegen:db — regenerate .generated/platform/db/schema.ts from the LIVE migrated DB
// via kysely-codegen. Run `pnpm db:migrate` first; introspection needs a real DB.
//
// Why a wrapper instead of calling kysely-codegen directly:
//   * The old `kysely-codegen --url $DATABASE_URL` form broke whenever DATABASE_URL
//     wasn't exported: the empty arg collapsed and kysely-codegen fell back to a
//     placeholder host -> "getaddrinfo ENOTFOUND base".
//   * kysely-codegen's env(...) URL mode *requires a .env file to exist* (ENOENT in
//     CI / fresh clones, where .env is gitignored and absent) — even when the real
//     DATABASE_URL env var is set.
//   * So: load .env only if it exists (local-dev convenience), then hand kysely-codegen
//     a LITERAL --url (needs no .env file). Works locally and in CI, no new dependency.
//     An explicitly exported DATABASE_URL takes precedence over .env.
//
// Dependency-free on purpose (matches scripts/gen-handler-stubs.mjs).
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const exported = process.env.DATABASE_URL; // an explicit export wins over .env
if (existsSync('.env')) process.loadEnvFile('.env');
const url = exported || process.env.DATABASE_URL;

if (!url) {
  console.error(
    'codegen:db: DATABASE_URL is not set.\n' +
      '  Put it in .env (see .env.example) or export it, then re-run.\n' +
      '  Note: codegen:db introspects a LIVE migrated database — run `pnpm db:migrate` first.',
  );
  process.exit(1);
}

// Resolve the kysely-codegen CLI from its package manifest (no hardcoded dist path).
const require = createRequire(import.meta.url);
const pkgJson = require.resolve('kysely-codegen/package.json');
const cli = join(dirname(pkgJson), require(pkgJson).bin['kysely-codegen']);

execFileSync(
  process.execPath,
  [cli, '--dialect', 'postgres', '--url', url, '--out-file', '.generated/platform/db/schema.ts'],
  { stdio: 'inherit' },
);
