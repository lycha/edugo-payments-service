// Generates a 501 stub handler for every operationId in an OpenAPI contract, so
// that fastify-openapi-glue always resolves a handler. Spread these stubs FIRST in
// the service object (see src/platform/http/server.ts); real handlers override them.
//
// Without this, glue substitutes its own `notImplemented` handler that throws a bare
// Error at call time -> the server error handler maps it to a generic 500. The stub
// returns a correct 501 problem+json instead, and the generated OperationId union
// tells you (and the type-checker) exactly which operations the contract declares.
//
// Dependency-free on purpose: operationIds are always `operationId: <name>` lines,
// so a regex is enough and we avoid pulling in a YAML parser.
//
// Usage:  node scripts/gen-handler-stubs.mjs [specPath] [outPath]
//   defaults: openapi/openapi.yaml -> .generated/payments/adapter/http/incoming/handler-stubs.ts
//   env override: OPENAPI_SPEC / OPENAPI_STUBS_OUT

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const specPath = process.argv[2] ?? process.env.OPENAPI_SPEC ?? 'openapi/openapi.yaml';
const outPath =
  process.argv[3] ??
  process.env.OPENAPI_STUBS_OUT ??
  '.generated/payments/adapter/http/incoming/handler-stubs.ts';

let spec;
try {
  spec = readFileSync(specPath, 'utf8');
} catch (err) {
  console.error(`gen-handler-stubs: cannot read spec at ${specPath}: ${err.message}`);
  process.exit(1);
}

const ids = [
  ...new Set([...spec.matchAll(/^\s*operationId:\s*['"]?([A-Za-z0-9_]+)/gm)].map((m) => m[1])),
].sort();

if (ids.length === 0) {
  console.error(`gen-handler-stubs: no operationIds found in ${specPath}`);
  process.exit(1);
}

const stubEntries = ids
  .map(
    (id) => `  ${id}: async (_request, reply) => {
    await reply.code(501).type('application/problem+json').send({
      type: 'about:blank',
      title: 'Not Implemented',
      status: 501,
      detail: "Operation '${id}' is declared in the OpenAPI contract but has no handler yet.",
    });
  },`,
  )
  .join('\n');

const contents = `// AUTO-GENERATED from ${specPath} by scripts/gen-handler-stubs.mjs. Do not edit.
// Regenerate with: pnpm codegen:openapi
import type { RouteHandlerMethod } from 'fastify';

/** Every operationId declared in the OpenAPI contract. */
export type OperationId =
${ids.map((id) => `  | '${id}'`).join('\n')};

/**
 * A 501 stub per operationId. Spread FIRST in the service object so an
 * unimplemented operation returns a clean 501 instead of glue's generic 500;
 * real handlers spread afterwards override the stub.
 */
export const stubHandlers: Record<OperationId, RouteHandlerMethod> = {
${stubEntries}
};
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, contents);
console.log(`gen-handler-stubs: ${ids.length} stub(s) from ${specPath} -> ${outPath}`);
