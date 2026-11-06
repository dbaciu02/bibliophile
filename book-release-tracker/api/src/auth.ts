import type { RequestHandler } from "express";
import { createRemoteJWKSet, errors as joseErrors, jwtVerify, type JWTVerifyGetKey } from "jose";
import { HttpError } from "./errors.js";

/**
 * Server-side access-token validation (F8) and role enforcement (F9).
 *
 * Every protected request must carry `Authorization: Bearer <access token>`.
 * The token is accepted only if ALL of these hold:
 *   1. signature   — signed by a key from the provider's JWKS, algorithm RS256
 *   2. issuer      — `iss` is exactly our Entra tenant's v2.0 issuer
 *   3. audience    — `aud` is exactly our API's client id
 *   4. expiry      — `exp` is in the future (and `nbf`, if present, has passed)
 *   5. scope       — `scp` contains the scope the route needs
 *   6. role        — `roles` contains one of the roles the route allows
 *
 * 1–4 failing (or no token) -> 401: "we don't know who you are".
 * 5–6 failing              -> 403: "we know who you are, but you can't do this".
 */

export type Role = "Reader" | "Curator";

export const SCOPES = {
  releasesRead: "Releases.Read",
  releasesWrite: "Releases.Write",
  watchlist: "Watchlist.ReadWrite",
} as const;
export type Scope = (typeof SCOPES)[keyof typeof SCOPES];

/** Who is making the request, taken only from a validated token. */
export interface Principal {
  subject: string; // Entra `oid` — stable per user per tenant
  name: string;
  roles: Role[];
  scopes: string[];
}

export interface TokenVerifierOptions {
  issuer: string;
  audience: string;
  keys: JWTVerifyGetKey; // where signing keys come from (remote JWKS in prod, local in tests)
  clockToleranceSeconds?: number;
}

export type TokenVerifier = (token: string) => Promise<Principal>;

const KNOWN_ROLES: readonly Role[] = ["Reader", "Curator"];

export function entraVerifierOptions(tenantId: string, apiClientId: string): TokenVerifierOptions {
  return {
    issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
    audience: apiClientId,
    // jose caches these keys and refetches when it sees an unknown `kid`
    // (Microsoft rotates signing keys regularly).
    keys: createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`)),
  };
}

export function createTokenVerifier(opts: TokenVerifierOptions): TokenVerifier {
  return async (token) => {
    const { payload } = await jwtVerify(token, opts.keys, {
      issuer: opts.issuer,
      audience: opts.audience,
      algorithms: ["RS256"], // never accept "none" or an HMAC algorithm
      clockTolerance: opts.clockToleranceSeconds ?? 60,
      requiredClaims: ["exp", "iat"],
    });

    // Entra puts the user's object id in `oid`; `sub` differs per app.
    const subject = typeof payload.oid === "string" ? payload.oid : payload.sub;
    if (typeof subject !== "string" || subject.length === 0) {
      throw new joseErrors.JWTClaimValidationFailed('missing "oid"/"sub" claim', payload, "oid", "missing");
    }

    const rawRoles: unknown = payload.roles;
    const roles = Array.isArray(rawRoles)
      ? rawRoles.filter((r): r is Role => typeof r === "string" && (KNOWN_ROLES as readonly string[]).includes(r))
      : [];
    const scopes = typeof payload.scp === "string" ? payload.scp.split(" ").filter(Boolean) : [];
    const name = typeof payload.name === "string" ? payload.name : subject;

    return { subject, name, roles, scopes };
  };
}

/** A verifier that rejects everything — used when Entra isn't configured (local dev only). */
export const rejectAllVerifier: TokenVerifier = async () => {
  throw new Error("authentication is not configured");
};

function logTokenRejection(requestId: string | undefined, err: unknown): void {
  if (process.env.NODE_ENV === "test") return; // the tests assert on the 401 instead
  const e = err as { code?: unknown; claim?: unknown; message?: unknown };
  console.warn(
    JSON.stringify({
      level: "warn",
      msg: "token rejected",
      requestId,
      reason: typeof e.code === "string" ? e.code : "unknown", // e.g. ERR_JWT_EXPIRED
      claim: typeof e.claim === "string" ? e.claim : undefined, // e.g. "iss" or "aud"
      detail: typeof e.message === "string" ? e.message : String(err),
    }),
  );
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer ([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]*)$/.exec(header);
  return match?.[1] ?? null;
}

declare module "express-serve-static-core" {
  interface Locals {
    principal?: Principal;
  }
}

/**
 * Route guard. Example: `requireAuth(verify, { scope: SCOPES.releasesWrite, roles: ["Curator"] })`.
 * On success the validated identity is in `res.locals.principal`.
 */
export function requireAuth(verify: TokenVerifier, rule: { scope: Scope; roles: Role[] }): RequestHandler {
  return async (req, res, next) => {
    const token = bearerToken(req.get("authorization"));
    if (!token) {
      res.set("WWW-Authenticate", 'Bearer realm="api"');
      throw new HttpError(401, "unauthenticated", "A valid bearer access token is required");
    }

    let principal: Principal;
    try {
      principal = await verify(token);
    } catch (err) {
      // Don't tell the CALLER which check failed (that helps an attacker), but
      // log it server-side so a misconfiguration is quick to find. Never log
      // the token itself.
      logTokenRejection(res.locals.requestId as string | undefined, err);
      res.set("WWW-Authenticate", 'Bearer realm="api", error="invalid_token"');
      throw new HttpError(401, "unauthenticated", "The access token is invalid or expired");
    }

    if (!principal.scopes.includes(rule.scope)) {
      res.set("WWW-Authenticate", `Bearer realm="api", error="insufficient_scope", scope="${rule.scope}"`);
      throw new HttpError(403, "forbidden", `This action needs the ${rule.scope} scope`);
    }
    if (!principal.roles.some((r) => rule.roles.includes(r))) {
      throw new HttpError(403, "forbidden", `This action needs one of these roles: ${rule.roles.join(", ")}`);
    }

    res.locals.principal = principal;
    next();
  };
}

/** Use inside a handler that sits behind requireAuth. */
export function principalOf(locals: { principal?: Principal }): Principal {
  if (!locals.principal) throw new Error("principalOf() used on a route without requireAuth");
  return locals.principal;
}
