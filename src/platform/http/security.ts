import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

// API authentication (ADR-0004). The OpenAPI contract declares a global `bearerAuth`
// (OIDC/JWT) requirement, with `security: []` on the liveness probe and the
// HMAC-verified operator webhook. We enforce it here rather than via
// fastify-openapi-glue's `securityHandlers`, because glue runs those at the
// `preHandler` stage — AFTER schema validation — so an unauthenticated call to an
// operation with required params/body would get a 400 before the 401. Running the
// check `onRequest` (before parsing and validation) makes 401 correctly precede 400.
//
// Public (non-bearer) routes — must mirror the `security: []` operations in the
// contract. Matched against the Fastify route template, not the concrete URL.
const PUBLIC_ROUTE_PREFIXES = ['/api/v1/operator-events/']; // HMAC-verified webhook (AC-14)
const PUBLIC_ROUTES = new Set<string>(['/api/v1/health']); // liveness probe

function isPublic(routeUrl: string | undefined): boolean {
  if (!routeUrl) return false;
  if (PUBLIC_ROUTES.has(routeUrl)) return true;
  return PUBLIC_ROUTE_PREFIXES.some((p) => routeUrl.startsWith(p));
}

export function registerBearerAuth(app: FastifyInstance): void {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (isPublic(request.routeOptions?.url)) return;

    const header = request.headers.authorization;
    const token = typeof header === 'string' ? /^Bearer[ \t]+(.+)$/i.exec(header)?.[1]?.trim() : undefined;
    if (!token) {
      return reply.code(401).type('application/problem+json').send({
        type: 'about:blank',
        title: 'Unauthorized',
        status: 401,
        detail: 'Missing or malformed bearer token',
      });
    }

    // Step 1 (now): token presence/shape only — makes `bearerAuth` actually enforced.
    // Step 2 (after ASM-4 is confirmed): verify the JWT against the EduGo IdP JWKS
    // (signature, issuer, audience, expiry, pinned alg) and attach the authenticated
    // actor (sub / role / acr) for RBAC (AC-48) and maker/checker (AC-23/24).
    // Until step 2 a well-formed token is accepted unverified — do NOT ship as-is.
    // TODO(ASM-4): verify `token` and populate the actor.
  });
}
