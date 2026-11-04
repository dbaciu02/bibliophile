import { z } from "zod";

// All configuration comes from environment variables and is validated once at
// startup. A missing or malformed value stops the server immediately instead
// of failing later in a request.
const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);

const ConfigSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    GIT_SHA: z.string().min(1).default("unknown"),
    ENTRA_TENANT_ID: z.preprocess(emptyToUndefined, z.uuid().optional()),
    ENTRA_API_CLIENT_ID: z.preprocess(emptyToUndefined, z.uuid().optional()),
  })
  .refine((c) => c.NODE_ENV !== "production" || (c.ENTRA_TENANT_ID && c.ENTRA_API_CLIENT_ID), {
    message: "ENTRA_TENANT_ID and ENTRA_API_CLIENT_ID are required in production",
    path: ["ENTRA_TENANT_ID"],
  });

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    // Print which variables are wrong, never their values (they may be secrets).
    const problems = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid configuration:\n  ${problems.join("\n  ")}`);
  }
  return result.data;
}
