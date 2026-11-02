import { z } from "zod";

// All configuration comes from environment variables and is validated once at
// startup. A missing or malformed value stops the server immediately instead
// of failing later in a request.
const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  GIT_SHA: z.string().min(1).default("unknown"),
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
