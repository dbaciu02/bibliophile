import { OAuthError, OAuthErrorCode, type AuthInfo, type OAuthTokenVerifier } from "@modelcontextprotocol/server";
import type { Principal, Scope, TokenVerifier } from "../auth.js";

/**
 * Authorization for the MCP server (F12).
 *
 * The MCP server is an OAuth 2.0 *resource server*, exactly like the REST API:
 * it accepts Entra ID access tokens for the booktracker-api audience and runs
 * the SAME checks (signature via JWKS, issuer, audience, expiry) through the
 * TokenVerifier from auth.ts. What's MCP-specific:
 *
 *   - Scopes are advertised and challenged in their full Entra form,
 *     `api://<api-client-id>/Releases.Read`, because that's what an MCP host
 *     has to ask Entra for. (Inside the token, `scp` holds the short form.)
 *   - Failures use the MCP authorization spec's HTTP answers:
 *       401 + WWW-Authenticate: Bearer resource_metadata="…"   no / bad token
 *       403 + WWW-Authenticate: Bearer error="insufficient_scope", scope="…"
 *                                   token lacks the scope a specific TOOL needs
 */

export function fullScope(apiAudience: string, scope: Scope): string {
  return `api://${apiAudience}/${scope}`;
}

/** Adapts the API's TokenVerifier to the MCP SDK's OAuthTokenVerifier interface. */
export function mcpTokenVerifier(verify: TokenVerifier, apiAudience: string): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      let principal: Principal;
      try {
        principal = await verify(token);
      } catch {
        // Same rule as the REST API: don't tell the caller which check failed.
        throw new OAuthError(OAuthErrorCode.InvalidToken, "The access token is invalid or expired");
      }
      return {
        token,
        clientId: principal.clientId ?? "unknown",
        scopes: principal.scopes.map((s) => `api://${apiAudience}/${s}`),
        ...(principal.expiresAt !== undefined ? { expiresAt: principal.expiresAt } : {}),
        // The tools read who the caller is from here.
        extra: { principal },
      };
    },
  };
}

/** The validated caller, as attached by mcpTokenVerifier. */
export function principalFromAuth(authInfo: AuthInfo | undefined): Principal | null {
  const p = authInfo?.extra?.principal;
  return p && typeof p === "object" && "subject" in p ? (p as Principal) : null;
}
