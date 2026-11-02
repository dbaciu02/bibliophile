import { config } from "dotenv";

// Load api/.env if present (local runs); CI sets TEST_DATABASE_URL directly.
config({ quiet: true });
