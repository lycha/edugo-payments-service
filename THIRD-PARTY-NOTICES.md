# Third-Party Notices

The proprietary [LICENSE](LICENSE) of this repository applies **only** to the
Author's own code. This project also uses third-party open-source components,
each of which remains the property of its respective copyright holders and is
licensed under its own terms — **not** under this repository's proprietary
license.

All direct dependencies are under permissive licenses (**MIT** or
**Apache-2.0**). The full license text of each component ships inside its own
package directory under `node_modules/<package>/` (typically `LICENSE`) after
`pnpm install`; the identifiers below reference the standard texts:

- **MIT** — https://opensource.org/licenses/MIT
- **Apache-2.0** — https://www.apache.org/licenses/LICENSE-2.0

## Runtime dependencies

| Package | License |
| --- | --- |
| `fastify` | MIT |
| `fastify-openapi-glue` | MIT |
| `kysely` | MIT |
| `awilix` | MIT |
| `pg` | MIT |
| `zod` | MIT |
| `@opentelemetry/sdk-node` | Apache-2.0 |
| `@opentelemetry/exporter-trace-otlp-http` | Apache-2.0 |
| `@opentelemetry/auto-instrumentations-node` | Apache-2.0 |

## Development / build / test dependencies

| Package | License |
| --- | --- |
| `typescript` | Apache-2.0 |
| `tsx` | MIT |
| `vitest` | MIT |
| `testcontainers` | MIT |
| `@testcontainers/postgresql` | MIT |
| `node-pg-migrate` | MIT |
| `kysely-codegen` | MIT |
| `openapi-typescript` | MIT |
| `@redocly/cli` | MIT |
| `@types/node` | MIT |
| `@types/pg` | MIT |

## Notes

- This table lists **direct** dependencies (declared in `package.json`). Each
  pulls in transitive dependencies, also predominantly MIT/Apache-2.0/ISC/BSD.
- To regenerate a complete, authoritative inventory including transitive
  packages, run:

  ```bash
  pnpm licenses list          # grouped by license
  pnpm licenses list --json   # machine-readable, for a NOTICE bundle
  ```

- Retaining these notices satisfies the attribution requirement common to the
  MIT and Apache-2.0 licenses. No third-party component here imposes copyleft
  (e.g. GPL/AGPL) obligations on the Author's own code.

_This file is informational and is not legal advice._
