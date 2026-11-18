// Adds matchers like toBeInTheDocument() and toHaveFocus() to the Vitest that
// THIS package resolves. (Importing "@testing-library/jest-dom/vitest" would
// extend the copy next to jest-dom instead; if npm nests a second Vitest under
// mcp-app/node_modules, the tests would then fail to typecheck.)
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup } from "@testing-library/react";
import { afterEach, expect } from "vitest";

expect.extend(matchers);
afterEach(() => cleanup());
