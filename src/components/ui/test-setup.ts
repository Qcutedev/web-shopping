// Setup for component tests (*.test.tsx, jsdom). Referenced from vitest.config.mts.
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest globals are off, so Testing Library cannot register its own cleanup.
afterEach(() => {
  cleanup();
});
