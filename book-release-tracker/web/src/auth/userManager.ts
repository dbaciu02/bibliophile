import { UserManager, WebStorageStateStore } from "oidc-client-ts";
import type { WebConfig } from "../env";

/**
 * OAuth 2.0 / OpenID Connect login with Entra ID (F7).
 *
 * Flow: Authorization Code + PKCE.
 *   - PKCE:  oidc-client-ts creates a random code_verifier per login, sends its
 *            SHA-256 hash as code_challenge (method S256), and sends the
 *            verifier itself only to the token endpoint.
 *   - state: random value per login, checked on return (stops login CSRF).
 *   - nonce: random value per login, must come back inside the ID token
 *            (stops ID-token replay). NOTE: oidc-client-ts does NOT add a nonce
 *            for the code flow unless you pass one — see signIn() in AuthContext.
 *
 * No client secret: this is a public client (a browser can't keep a secret).
 */

export const CALLBACK_PATH = "/auth/callback";

export function apiScopes(apiClientId: string): string[] {
  const base = `api://${apiClientId}`;
  // Scopes say what this app may do for the user; the API also checks the
  // user's ROLE, so a Reader holding Releases.Write still gets 403 on writes.
  return [`${base}/Releases.Read`, `${base}/Releases.Write`, `${base}/Watchlist.ReadWrite`];
}

export function createUserManager(config: WebConfig): UserManager {
  const origin = window.location.origin;
  return new UserManager({
    authority: `https://login.microsoftonline.com/${config.tenantId}/v2.0`,
    client_id: config.clientId,
    redirect_uri: `${origin}${CALLBACK_PATH}`,
    post_logout_redirect_uri: `${origin}/`,
    response_type: "code",
    // offline_access -> refresh token, so the session renews without a redirect.
    scope: ["openid", "profile", "offline_access", ...apiScopes(config.apiClientId)].join(" "),
    // Entra's userinfo endpoint only accepts Microsoft Graph tokens, and we ask
    // for a token for OUR API, so skip it. Name/roles come from /api/me instead.
    loadUserInfo: false,
    automaticSilentRenew: true,
    // sessionStorage: tokens are gone when the tab closes and aren't shared
    // across tabs. They are still readable by scripts on this origin, which is
    // why the CSP in step 8 matters.
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
    stateStore: new WebStorageStateStore({ store: window.sessionStorage }),
  });
}

/** 32 random bytes, base64url — used for the OIDC nonce. */
export function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
