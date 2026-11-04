import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWTPayload } from "jose";
import { createTokenVerifier, type TokenVerifier } from "../src/auth.js";

/**
 * Test-only token issuer. It plays the role of Entra ID: it has a signing key,
 * publishes the matching public key as a JWKS, and signs access tokens that
 * look like Entra v2 tokens. The API's real verification code checks them —
 * only the key source differs (local JWKS here, Microsoft's JWKS in prod).
 *
 * Nothing here is used outside tests.
 */

export const TEST_ISSUER = "https://login.microsoftonline.com/00000000-0000-0000-0000-000000000001/v2.0";
export const TEST_AUDIENCE = "00000000-0000-0000-0000-0000000000a1";
const KID = "test-key-1";

export interface TestIssuer {
  verifier: TokenVerifier;
  sign: (opts?: SignOptions) => Promise<string>;
  /** A second key the API does NOT trust, for the bad-signature test. */
  signWithUntrustedKey: (opts?: SignOptions) => Promise<string>;
}

export interface SignOptions {
  oid?: string;
  name?: string;
  roles?: string[];
  scp?: string;
  iss?: string;
  aud?: string;
  /** Seconds from now; negative = already expired. */
  expiresIn?: number;
  extra?: JWTPayload;
}

export const READER = {
  oid: "11111111-1111-1111-1111-111111111111",
  name: "Test Reader",
  roles: ["Reader"],
  scp: "Releases.Read Watchlist.ReadWrite",
};
export const READER_2 = {
  oid: "22222222-2222-2222-2222-222222222222",
  name: "Second Test Reader",
  roles: ["Reader"],
  scp: "Releases.Read Watchlist.ReadWrite",
};
export const CURATOR = {
  oid: "33333333-3333-3333-3333-333333333333",
  name: "Test Curator",
  roles: ["Curator"],
  scp: "Releases.Read Releases.Write Watchlist.ReadWrite",
};

async function signWith(key: CryptoKey, o: SignOptions): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: JWTPayload = {
    oid: o.oid ?? READER.oid,
    name: o.name ?? READER.name,
    roles: o.roles ?? READER.roles,
    scp: o.scp ?? READER.scp,
    ver: "2.0",
    ...o.extra,
  };
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: KID, typ: "JWT" })
    .setIssuer(o.iss ?? TEST_ISSUER)
    .setAudience(o.aud ?? TEST_AUDIENCE)
    .setSubject(`sub-${o.oid ?? READER.oid}`)
    .setIssuedAt(now - 5)
    .setExpirationTime(now + (o.expiresIn ?? 3600))
    .sign(key);
}

export async function createTestIssuer(): Promise<TestIssuer> {
  const trusted = await generateKeyPair("RS256");
  const untrusted = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(trusted.publicKey)), kid: KID, alg: "RS256", use: "sig" };

  const verifier = createTokenVerifier({
    issuer: TEST_ISSUER,
    audience: TEST_AUDIENCE,
    keys: createLocalJWKSet({ keys: [jwk] }),
    clockToleranceSeconds: 0, // makes the expiry test exact
  });

  return {
    verifier,
    sign: (opts = {}) => signWith(trusted.privateKey, opts),
    signWithUntrustedKey: (opts = {}) => signWith(untrusted.privateKey, opts),
  };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
