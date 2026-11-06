/**
 * Browser configuration, read from VITE_* variables at build time.
 * Everything here ends up in the public JavaScript bundle, so it must never
 * contain a secret. These Entra values are public identifiers.
 */
export interface WebConfig {
  tenantId: string;
  clientId: string; // booktracker-web
  apiClientId: string; // booktracker-api (used to name its scopes)
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ConfigResult = { ok: true; config: WebConfig } | { ok: false; missing: string[] };

export function readConfig(): ConfigResult {
  const values = {
    VITE_ENTRA_TENANT_ID: import.meta.env.VITE_ENTRA_TENANT_ID as string | undefined,
    VITE_ENTRA_CLIENT_ID: import.meta.env.VITE_ENTRA_CLIENT_ID as string | undefined,
    VITE_ENTRA_API_CLIENT_ID: import.meta.env.VITE_ENTRA_API_CLIENT_ID as string | undefined,
  };
  const missing = Object.entries(values)
    .filter(([, v]) => !v || !GUID.test(v))
    .map(([k]) => k);
  if (missing.length > 0) return { ok: false, missing };
  return {
    ok: true,
    config: {
      tenantId: values.VITE_ENTRA_TENANT_ID as string,
      clientId: values.VITE_ENTRA_CLIENT_ID as string,
      apiClientId: values.VITE_ENTRA_API_CLIENT_ID as string,
    },
  };
}
